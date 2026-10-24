/**
 * Score model: the single representation every importer produces and the
 * practice engine, renderer and synth consume.
 *
 * Time is measured in quarter-note beats from the start of the piece.
 * Ties are merged into one note before the score is finalised.
 */

export type Hand = 'R' | 'L';
export type Finger = 1 | 2 | 3 | 4 | 5;
export type FingerSource = 'file' | 'auto' | 'user';

export interface ScoreNote {
  /** MIDI pitch 0–127, sounding pitch. */
  pitch: number;
  /** Start in beats. */
  t: number;
  /** Duration in beats, ties merged. */
  dur: number;
  hand: Hand;
  finger?: Finger;
  fingerSource?: FingerSource;
  /** 1-based measure number. */
  measure: number;
  /** 0–1, from MIDI velocity when available. */
  velocity?: number;
}

export interface Measure {
  /** 1-based number as shown to the user. */
  number: number;
  /** Start in beats. */
  t: number;
  /** Length in beats. */
  beats: number;
  /** Rehearsal mark / section label, when the source has one. */
  section?: string;
}

export interface TempoEvent {
  t: number;
  /** Quarter notes per minute. */
  bpm: number;
}

export type ScoreSource = 'library' | 'midi' | 'musicxml';

export interface Score {
  /** Stable id: library slug or content hash of the imported file. */
  id: string;
  title: string;
  composer?: string;
  timeSig: [number, number];
  tempo: TempoEvent[];
  measures: Measure[];
  notes: ScoreNote[];
  /** End of the piece in beats. */
  end: number;
  hands: { R: boolean; L: boolean };
  source: ScoreSource;
}

export const EPS = 1e-6;

export function isBlackKey(pitch: number): boolean {
  const pc = ((pitch % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

/** Lowest and highest pitch among the notes (optionally one hand); undefined for an empty selection. */
export function pitchSpan(score: Score, hand?: Hand): { low?: number; high?: number } {
  let low: number | undefined;
  let high: number | undefined;
  for (const n of score.notes) {
    if (hand && n.hand !== hand) continue;
    if (low === undefined || n.pitch < low) low = n.pitch;
    if (high === undefined || n.pitch > high) high = n.pitch;
  }
  return { low, high };
}

export function bpmAt(score: Score, t: number): number {
  let bpm = score.tempo.length ? score.tempo[0].bpm : 120;
  for (const ev of score.tempo) {
    if (ev.t <= t + EPS) bpm = ev.bpm;
    else break;
  }
  return bpm;
}

/** 1-based measure number containing beat t (clamped to the piece). */
export function measureAt(score: Score, t: number): number {
  const ms = score.measures;
  if (!ms.length) return 1;
  let m = ms[0].number;
  for (const x of ms) {
    if (x.t <= t + EPS) m = x.number;
    else break;
  }
  return m;
}

export function measureByNumber(score: Score, n: number): Measure | undefined {
  return score.measures.find((m) => m.number === n);
}

/** Beat range [start, end) covered by measures from..to inclusive. */
export function measureRange(score: Score, from: number, to: number): [number, number] {
  const ms = score.measures;
  if (!ms.length) return [0, score.end];
  const first = ms[0].number;
  const last = ms[ms.length - 1].number;
  const a = Math.min(Math.max(from, first), last);
  const b = Math.min(Math.max(to, a), last);
  const ma = measureByNumber(score, a)!;
  const mb = measureByNumber(score, b)!;
  const end = b === last ? score.end : mb.t + mb.beats;
  return [ma.t, Math.max(end, ma.t)];
}

/**
 * Build the measure list from a time-signature map.
 * `sigs` is sorted by t; the first entry must start at 0. An optional pickup
 * (anacrusis) shortens the first measure.
 */
export function buildMeasures(
  sigs: { t: number; num: number; den: number }[],
  end: number,
  pickupBeats = 0,
): Measure[] {
  const out: Measure[] = [];
  if (!sigs.length) sigs = [{ t: 0, num: 4, den: 4 }];
  let t = 0;
  let n = 1;
  let si = 0;
  const lenOf = (i: number) => (sigs[i].num * 4) / sigs[i].den;
  if (pickupBeats > EPS) {
    out.push({ number: n++, t: 0, beats: pickupBeats });
    t = pickupBeats;
  }
  let guard = 0;
  while (t < end - EPS && guard++ < 100000) {
    while (si + 1 < sigs.length && sigs[si + 1].t <= t + EPS) si++;
    let beats = lenOf(si);
    // a signature change inside the current measure cuts it short
    if (si + 1 < sigs.length && sigs[si + 1].t < t + beats - EPS) beats = sigs[si + 1].t - t;
    if (beats <= EPS) beats = lenOf(si);
    out.push({ number: n++, t, beats });
    t += beats;
  }
  if (!out.length) out.push({ number: 1, t: 0, beats: lenOf(0) });
  return out;
}

/** Sort notes, drop zero-length ones, assign measures, compute end and hands. */
export function finalizeScore(
  partial: Omit<Score, 'end' | 'hands'> & Partial<Pick<Score, 'end' | 'hands'>>,
): Score {
  const notes = partial.notes
    .filter((n) => n.dur > EPS && n.pitch >= 0 && n.pitch <= 127)
    .sort((a, b) => a.t - b.t || a.pitch - b.pitch);
  const lastNoteEnd = notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
  const lastMeasure = partial.measures.length ? partial.measures[partial.measures.length - 1] : undefined;
  const end = Math.max(partial.end ?? 0, lastNoteEnd, lastMeasure ? lastMeasure.t + lastMeasure.beats : 0);
  const score: Score = {
    ...partial,
    notes,
    end,
    hands: { R: notes.some((n) => n.hand === 'R'), L: notes.some((n) => n.hand === 'L') },
    tempo: partial.tempo.length ? [...partial.tempo].sort((a, b) => a.t - b.t) : [{ t: 0, bpm: 120 }],
  };
  // measure numbers from the measure list
  const tmp = { ...score };
  for (const n of score.notes) n.measure = measureAt(tmp, n.t);
  return score;
}

/** Notes that start together (same hand filter applied by the caller). */
export interface NoteGroup {
  t: number;
  notes: ScoreNote[];
}

export function groupByOnset(notes: ScoreNote[], tol = 0.02): NoteGroup[] {
  const sorted = [...notes].sort((a, b) => a.t - b.t || a.pitch - b.pitch);
  const groups: NoteGroup[] = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.t - n.t) <= tol) g.notes.push(n);
    else groups.push({ t: n.t, notes: [n] });
  }
  return groups;
}

export function beatsToSeconds(score: Score, t: number): number {
  let sec = 0;
  let pos = 0;
  let bpm = score.tempo[0]?.bpm ?? 120;
  for (const ev of score.tempo) {
    if (ev.t >= t) break;
    if (ev.t > pos) {
      sec += ((ev.t - pos) * 60) / bpm;
      pos = ev.t;
    }
    bpm = ev.bpm;
  }
  sec += ((t - pos) * 60) / bpm;
  return sec;
}
