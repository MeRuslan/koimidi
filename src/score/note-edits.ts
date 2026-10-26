/**
 * Notes the player changed on the waterfall: put in, taken out, moved to
 * another key or time, made longer or shorter, or given to the other hand.
 * Like the finger edits they are kept per piece as a difference from what the
 * file gives, so they survive re-opening it and switching the MIDI hand
 * split: the file's notes taken out (by pitch and onset, see noteKey) and the
 * notes put in. A file note that was moved is one of each.
 *
 * PieceEditor builds the notes from a clean copy of the file's every time
 * the edits change, which keeps undo simple: a step back restores an earlier
 * copy of the edits and builds the notes again.
 */
import { clearEdits, markUserFingers, noteKey, setFinger, type FingerEdits } from './edits';
import { autoFinger } from './fingering';
import { EPS, measureAt, type Finger, type Hand, type Score, type ScoreNote } from './model';

export interface AddedNote {
  pitch: number;
  t: number;
  dur: number;
  hand: Hand;
  /** a moved file note keeps its loudness */
  velocity?: number;
}

export interface NoteEdits {
  /** keys of the file's notes taken out, one entry per note */
  removed: string[];
  added: AddedNote[];
}

/** Everything the player changed in a piece. */
export interface PieceEdits {
  fingers: FingerEdits;
  notes: NoteEdits;
}

export function emptyNoteEdits(): NoteEdits {
  return { removed: [], added: [] };
}

export function hasNoteEdits(e: NoteEdits): boolean {
  return e.removed.length > 0 || e.added.length > 0;
}

/** A note's new place, length or hand; what is left out stays. */
export type NoteChange = Partial<Pick<ScoreNote, 'pitch' | 't' | 'dur' | 'hand'>>;

/** steps kept for undo */
const UNDO_MAX = 200;

export class PieceEditor {
  /** the file's notes as parsed, never changed */
  private readonly base: ScoreNote[];
  /** which added entry each built note comes from, and back */
  private from = new WeakMap<ScoreNote, AddedNote>();
  private made = new Map<AddedNote, ScoreNote>();
  private undos: PieceEdits[] = [];
  private redos: PieceEdits[] = [];

  /** `score` holds the file's notes; from now on it holds them with the edits applied. */
  constructor(
    readonly score: Score,
    public edits: PieceEdits,
  ) {
    this.base = score.notes.map((n) => ({ ...n }));
    this.build();
  }

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  /** Put a new note in; returns it. */
  add(a: AddedNote): ScoreNote {
    this.checkpoint();
    const entry = { ...a };
    this.edits.notes.added.push(entry);
    this.build();
    return this.made.get(entry)!;
  }

  /** Take a note out, with the finger the player gave it. */
  remove(n: ScoreNote): void {
    this.checkpoint();
    const { added, removed } = this.edits.notes;
    const a = this.from.get(n);
    if (a && added.includes(a)) added.splice(added.indexOf(a), 1);
    else removed.push(noteKey(n));
    this.build();
    this.prune();
  }

  /** Move a note, change its length or its hand; returns the note as it is now (the same one when nothing changes). */
  change(n: ScoreNote, to: NoteChange): ScoreNote {
    const next = { pitch: to.pitch ?? n.pitch, t: to.t ?? n.t, dur: to.dur ?? n.dur, hand: to.hand ?? n.hand };
    if (next.pitch === n.pitch && Math.abs(next.t - n.t) < EPS && Math.abs(next.dur - n.dur) < EPS && next.hand === n.hand) return n;
    this.checkpoint();
    const { added, removed } = this.edits.notes;
    const fingers = this.edits.fingers;
    const key = noteKey(n);
    let entry = this.from.get(n);
    if (entry && added.includes(entry)) Object.assign(entry, next);
    else {
      removed.push(key);
      entry = { ...next, ...(n.velocity !== undefined ? { velocity: n.velocity } : {}) };
      added.push(entry);
    }
    // the player's finger goes with the note
    if (n.fingerSource === 'user' && n.finger) {
      delete fingers[key];
      fingers[noteKey(next)] = n.finger;
    }
    this.normalize();
    this.build();
    this.prune();
    return this.made.get(entry) ?? this.find(next) ?? n;
  }

  /** A finger chosen by the player, or with `undefined` the suggested one back. */
  setFinger(n: ScoreNote, f: Finger | undefined): void {
    this.checkpoint();
    setFinger(this.score, n, f, this.edits.fingers);
  }

  /** Forget the fingers the player chose. */
  clearFingers(): void {
    this.checkpoint();
    clearEdits(this.score, this.edits.fingers);
  }

  /** The notes as in the file again (fingers the player gave them stay where a note still is). */
  clearNotes(): void {
    this.checkpoint();
    this.edits.notes = emptyNoteEdits();
    this.build();
    this.prune();
  }

  undo(): boolean {
    const prev = this.undos.pop();
    if (!prev) return false;
    this.redos.push(structuredClone(this.edits));
    this.edits = prev;
    this.build();
    return true;
  }

  redo(): boolean {
    const next = this.redos.pop();
    if (!next) return false;
    this.undos.push(structuredClone(this.edits));
    this.edits = next;
    this.build();
    return true;
  }

  private checkpoint(): void {
    this.undos.push(structuredClone(this.edits));
    if (this.undos.length > UNDO_MAX) this.undos.shift();
    this.redos = [];
  }

  /** The file's notes, less the ones taken out, plus the ones put in; then the fingers. */
  private build(): void {
    const { notes, fingers } = this.edits;
    const drop = new Map<string, number>();
    for (const k of notes.removed) drop.set(k, (drop.get(k) ?? 0) + 1);
    const out: ScoreNote[] = [];
    for (const b of this.base) {
      const k = noteKey(b);
      const left = drop.get(k) ?? 0;
      if (left > 0) drop.set(k, left - 1);
      else out.push({ ...b });
    }
    this.made = new Map();
    for (const a of notes.added) {
      const n: ScoreNote = { pitch: a.pitch, t: a.t, dur: a.dur, hand: a.hand, measure: 1 };
      if (a.velocity !== undefined) n.velocity = a.velocity;
      out.push(n);
      this.made.set(a, n);
      this.from.set(n, a);
    }
    const s = this.score;
    s.notes = out.sort((a, b) => a.t - b.t || a.pitch - b.pitch);
    for (const n of s.notes) n.measure = measureAt(s, n.t);
    s.hands = { R: s.notes.some((n) => n.hand === 'R'), L: s.notes.some((n) => n.hand === 'L') };
    markUserFingers(s, fingers);
    autoFinger(s, { refresh: true });
  }

  /** A note moved back to where the file has it is no edit at all. */
  private normalize(): void {
    const { removed, added } = this.edits.notes;
    for (let i = added.length - 1; i >= 0; i--) {
      const a = added[i];
      const k = noteKey(a);
      const r = removed.indexOf(k);
      if (r < 0) continue;
      if (!this.base.some((b) => noteKey(b) === k && b.hand === a.hand && Math.abs(b.dur - a.dur) < EPS)) continue;
      removed.splice(r, 1);
      added.splice(i, 1);
    }
  }

  /** Fingers of notes that are gone. */
  private prune(): void {
    const keys = new Set(this.score.notes.map(noteKey));
    const fingers = this.edits.fingers;
    for (const k of Object.keys(fingers)) if (!keys.has(k)) delete fingers[k];
  }

  private find(n: Pick<ScoreNote, 'pitch' | 't' | 'hand'>): ScoreNote | undefined {
    return this.score.notes.find((m) => m.pitch === n.pitch && m.hand === n.hand && Math.abs(m.t - n.t) < EPS);
  }
}

/** The hand a new note most likely belongs to: the one playing nearest to it in time and pitch, else the side of middle C. */
export function guessHand(score: Score, pitch: number, t: number): Hand {
  let best: Hand = pitch < 60 ? 'L' : 'R';
  let bestD = Infinity;
  for (const n of score.notes) {
    const dt = Math.abs(n.t - t);
    if (dt > 4) continue;
    const d = Math.abs(n.pitch - pitch) + dt * 3;
    if (d < bestD) {
      bestD = d;
      best = n.hand;
    }
  }
  return best;
}

/**
 * A beat on the grid, or the onset of another note when one is within
 * `magnet` beats, so a chord lines up with notes that sit off the grid.
 */
export function snapBeat(t: number, grid: number, onsets: readonly number[], magnet: number): number {
  let best = Math.round(t / grid) * grid;
  let bestD = Math.min(magnet, grid * 0.45);
  for (const o of onsets) {
    const d = Math.abs(o - t);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/** Where a note on `pitch` starting at `t` has to end so as not to run into the next note on the same key. */
export function roomUntil(score: Score, pitch: number, t: number, skip?: ScoreNote): number {
  let end = score.end;
  for (const n of score.notes) if (n !== skip && n.pitch === pitch && n.t > t + EPS && n.t < end) end = n.t;
  return end;
}
