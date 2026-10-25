/**
 * Rhythm of a pass: how close the right notes came to their time. Each note
 * scores 1 when it was on time, 0 when it was far off, and in between on a
 * straight line; the pass scores the mean.
 *
 * In tempo mode a note is judged by how early or late it was played. "On
 * time" is a share of the beat, so it widens at slower tempos (the bars then
 * fall slower too), but never under FLOOR seconds, which also takes in the
 * lag of the screen and the sound.
 *
 * In learn mode the bars wait for you, so there is no time to be early or
 * late for. The gaps between notes are compared with the score's instead, at
 * your own tempo: the median over the pass. A quarter note played as long as
 * the eighths around it is off, whatever the tempo; so is a stop to look for
 * the next key.
 */

const FLOOR = 0.06; // seconds: always on time within this
const FULL = 0.08; // beats: on time within this share of the beat
const ZERO = 0.35; // beats: no credit this far off (the hit window is 0.45)
const LEAN = 0.75; // mean lateness, in on-time windows, worth a word
const GAP_FLOOR = 0.08; // seconds: a gap this close to the expected one is right
const GAP_FULL = Math.log(1.15); // a gap up to 15% longer or shorter is right
const GAP_ZERO = Math.log(1.8); // 1.8 times longer or shorter gets nothing
const GAP_MIN = 0.05; // seconds at the original tempo: shorter gaps do not set your tempo
/** fewer timed notes than this say nothing about the rhythm */
export const MIN_TIMED = 3;

export interface RhythmSummary {
  /** mean of the note scores, 0–1 */
  score: number;
  /** sum of the note scores */
  onTime: number;
  /** notes judged */
  timed: number;
  /** per bar number: summed note scores and notes judged */
  bars: Record<number, { onTime: number; timed: number }>;
  /** tempo mode: you play early (-1) or late (1) on the whole, or 0 */
  lean: -1 | 0 | 1;
  /** learn mode: your own tempo as a share of the piece's */
  pace: number | null;
}

/** How on time a note played `dev` seconds late (negative: early) is, with a beat of `beat` seconds. */
export function hitScore(dev: number, beat: number): number {
  const full = Math.max(FLOOR, FULL * beat);
  const zero = Math.max(2 * full, ZERO * beat);
  const d = Math.abs(dev);
  return d <= full ? 1 : d >= zero ? 0 : (zero - d) / (zero - full);
}

/** How right a gap is that was `played` seconds long where `expected` seconds were due. */
export function gapScore(played: number, expected: number): number {
  if (Math.abs(played - expected) <= GAP_FLOOR) return 1;
  const r = Math.abs(Math.log(played / expected));
  return r <= GAP_FULL ? 1 : r >= GAP_ZERO ? 0 : (GAP_ZERO - r) / (GAP_ZERO - GAP_FULL);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The timing of one pass, note by note, summed up on demand. */
export class RhythmTally {
  private hits: { measure: number; score: number; lean: number }[] = [];
  private gaps: { measure: number; score: number; played: number }[] = [];
  private memo: RhythmSummary | null | undefined;

  /** tempo mode: a right note played `dev` seconds late (negative: early), with a beat of `beat` seconds */
  hit(measure: number, dev: number, beat: number): void {
    this.hits.push({ measure, score: hitScore(dev, beat), lean: dev / Math.max(FLOOR, FULL * beat) });
    this.memo = undefined;
  }

  /** learn mode: a note played `played` seconds after the one before, `score` seconds after it at the piece's tempo */
  gap(measure: number, score: number, played: number): void {
    if (score <= 0 || played <= 0) return;
    this.gaps.push({ measure, score, played });
    this.memo = undefined;
  }

  get summary(): RhythmSummary | null {
    if (this.memo === undefined) this.memo = this.sum();
    return this.memo;
  }

  private sum(): RhythmSummary | null {
    const notes: { measure: number; score: number }[] = [...this.hits];
    let pace: number | null = null;
    if (this.gaps.length) {
      const set = this.gaps.filter((g) => g.score >= GAP_MIN);
      const k = median((set.length ? set : this.gaps).map((g) => g.played / g.score)); // your seconds per second of the piece
      pace = 1 / k;
      for (const g of this.gaps) notes.push({ measure: g.measure, score: gapScore(g.played, g.score * k) });
    }
    if (notes.length < MIN_TIMED) return null;
    const bars: RhythmSummary['bars'] = {};
    let onTime = 0;
    for (const n of notes) {
      onTime += n.score;
      const b = (bars[n.measure] ??= { onTime: 0, timed: 0 });
      b.onTime += n.score;
      b.timed++;
    }
    const lean = this.hits.length >= MIN_TIMED ? this.hits.reduce((s, h) => s + h.lean, 0) / this.hits.length : 0;
    return {
      score: onTime / notes.length,
      onTime,
      timed: notes.length,
      bars,
      lean: lean >= LEAN ? 1 : lean <= -LEAN ? -1 : 0,
      pace,
    };
  }
}
