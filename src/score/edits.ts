/**
 * Fingers the user chose by hand. They are kept per piece as a map from a
 * note key to a finger and applied on top of whatever the importer produced;
 * the automatic fingering then works around them as fixed points.
 *
 * The key is pitch + onset, without the hand, so edits survive re-importing
 * the same file and switching the MIDI hand split.
 */
import { autoFinger } from './fingering';
import type { Finger, FingerSource, Score, ScoreNote } from './model';

export type FingerEdits = Record<string, Finger>;

/** Stable note key: MIDI pitch and onset in 1/480 of a beat. */
export function noteKey(n: Pick<ScoreNote, 'pitch' | 't'>): string {
  return `${n.pitch}@${Math.round(n.t * 480)}`;
}

/** Finger and source each note had before the user touched it, to restore on "back to suggested". */
const original = new WeakMap<ScoreNote, { finger?: Finger; source?: FingerSource }>();

function remember(n: ScoreNote): void {
  if (!original.has(n)) original.set(n, { finger: n.finger, source: n.fingerSource });
}

function restore(n: ScoreNote): void {
  const o = original.get(n);
  if (o?.source === 'file') {
    n.finger = o.finger;
    n.fingerSource = 'file';
  } else {
    n.finger = undefined;
    n.fingerSource = undefined;
  }
}

/** Put the stored fingers on their notes without refitting the rest. Returns how many applied. */
export function markUserFingers(score: Score, edits: FingerEdits): number {
  let applied = 0;
  for (const n of score.notes) {
    const f = edits[noteKey(n)];
    if (!f) continue;
    remember(n);
    n.finger = f;
    n.fingerSource = 'user';
    applied++;
  }
  return applied;
}

/** Apply stored edits to a freshly parsed score and refit the automatic fingering. Returns how many applied. */
export function applyEdits(score: Score, edits: FingerEdits): number {
  const applied = markUserFingers(score, edits);
  if (applied) autoFinger(score, { refresh: true });
  return applied;
}

/** Set one note's finger (or, with `undefined`, go back to the suggested one) and refit the rest. */
export function setFinger(score: Score, note: ScoreNote, finger: Finger | undefined, edits: FingerEdits): void {
  const key = noteKey(note);
  if (finger) {
    remember(note);
    note.finger = finger;
    note.fingerSource = 'user';
    edits[key] = finger;
  } else {
    delete edits[key];
    if (note.fingerSource === 'user') restore(note);
  }
  autoFinger(score, { refresh: true });
}

/** Drop every edit of this piece and refit. */
export function clearEdits(score: Score, edits: FingerEdits): void {
  for (const k of Object.keys(edits)) delete edits[k];
  for (const n of score.notes) if (n.fingerSource === 'user') restore(n);
  autoFinger(score, { refresh: true });
}

/** What a note's finger would be without the user's choice. */
export function suggestedSource(n: ScoreNote): FingerSource | undefined {
  return n.fingerSource === 'user' ? (original.get(n)?.source ?? 'auto') : n.fingerSource;
}
