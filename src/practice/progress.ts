/**
 * Practice progress for one piece: total practice time, a history of complete
 * passes (per bar range, mode, hand and tempo) and running counts per bar,
 * the rhythm included. Pure functions over a plain object, so it stores as is
 * in IndexedDB; passes and bars kept before the rhythm was judged simply have
 * none.
 */
import type { BarTally, HandSel, Mode, PassStats } from './engine';

/** A complete pass as kept in the history. */
export interface PassRecord extends BarTally {
  at: number;
  from: number;
  to: number;
  mode: Mode;
  hand: HandSel;
  speed: number;
  seconds: number;
  /** learn mode: your own tempo as a share of the piece's */
  pace?: number;
}

export interface PieceProgress {
  id: string;
  /** seconds practised, partial passes included */
  seconds: number;
  /** complete passes, oldest first, at most MAX_PASSES */
  passes: PassRecord[];
  /** running counts per bar number */
  bars: Record<number, BarTally>;
  updatedAt: number;
}

export const MAX_PASSES = 300;

export function emptyProgress(id: string): PieceProgress {
  return { id, seconds: 0, passes: [], bars: {}, updatedAt: 0 };
}

/** Share of notes played right: hits / (hits + wrong keys + misses); null with nothing played. */
export function accuracy(t: BarTally): number | null {
  const all = t.hits + t.wrong + t.misses;
  return all ? t.hits / all : null;
}

/** Rhythm: the mean score of the notes judged, 0–1; null when none were. */
export function rhythm(t: BarTally): number | null {
  return t.timed ? (t.onTime ?? 0) / t.timed : null;
}

/** Passes over exactly this bar range, in this mode and with this hand. */
export function samePasses(p: PieceProgress, from: number, to: number, mode: Mode, hand: HandSel): PassRecord[] {
  return p.passes.filter((r) => r.from === from && r.to === to && r.mode === mode && r.hand === hand);
}

export interface PassResult {
  /** accuracy of this pass */
  accuracy: number;
  /** best accuracy of earlier passes over the same range, mode and hand */
  previousBest: number | null;
  /** how many complete passes over this range so far, this one included */
  count: number;
  /** rhythm of this pass, when enough notes were timed */
  rhythm: number | null;
  /** tempo mode: played early (-1) or late (1) on the whole, else 0 */
  lean: -1 | 0 | 1;
  /** learn mode: your own tempo as a share of the piece's */
  pace: number | null;
}

/** Fold a pass into the progress. Complete passes enter the history and get compared with earlier ones. */
export function addPass(p: PieceProgress, s: PassStats, at = Date.now()): PassResult | null {
  p.seconds += s.seconds;
  p.updatedAt = at;
  for (const [k, b] of Object.entries(s.bars)) {
    const cur = (p.bars[+k] ??= { hits: 0, wrong: 0, misses: 0 });
    cur.hits += b.hits;
    cur.wrong += b.wrong;
    cur.misses += b.misses;
    if (b.timed) {
      cur.onTime = (cur.onTime ?? 0) + (b.onTime ?? 0);
      cur.timed = (cur.timed ?? 0) + b.timed;
    }
  }
  if (!s.complete) return null;
  const earlier = samePasses(p, s.from, s.to, s.mode, s.hand);
  const best = earlier.reduce<number | null>((m, r) => Math.max(m ?? 0, accuracy(r) ?? 0), null);
  const rec: PassRecord = { at, from: s.from, to: s.to, mode: s.mode, hand: s.hand, speed: s.speed, hits: s.hits, wrong: s.wrong, misses: s.misses, seconds: s.seconds };
  if (s.timed) Object.assign(rec, { onTime: s.onTime, timed: s.timed });
  if (s.pace !== undefined) rec.pace = s.pace;
  p.passes.push(rec);
  if (p.passes.length > MAX_PASSES) p.passes.splice(0, p.passes.length - MAX_PASSES);
  return { accuracy: accuracy(s) ?? 0, previousBest: best, count: earlier.length + 1, rhythm: rhythm(s), lean: s.lean ?? 0, pace: s.pace ?? null };
}

/** Best accuracy over complete passes of the whole piece or any range, for the library card. */
export function bestAccuracy(p: PieceProgress): number | null {
  return p.passes.reduce<number | null>((m, r) => {
    const a = accuracy(r);
    return a === null ? m : Math.max(m ?? 0, a);
  }, null);
}

/**
 * Bars that go worst, at least `minNotes` notes played in each: lowest
 * accuracy first, only those below `below`.
 */
export function weakestBars(p: PieceProgress, count = 3, minNotes = 6, below = 0.9): number[] {
  return Object.entries(p.bars)
    .map(([k, b]) => ({ bar: +k, acc: accuracy(b), n: b.hits + b.wrong + b.misses }))
    .filter((x) => x.n >= minNotes && x.acc !== null && x.acc < below)
    .sort((a, b) => a.acc! - b.acc! || a.bar - b.bar)
    .slice(0, count)
    .map((x) => x.bar);
}
