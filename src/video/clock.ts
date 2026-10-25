/**
 * Where a piece sits in its video. The recognition works in the clock of the
 * capture (seconds on the wall, or of the recorded sound); the player's clock
 * is the video's own time. The two run at the speed the video was watched at,
 * so a sample now and then of (capture time, video time) fixes the offset
 * between them. From that, and the piece's tempo, the practice screen knows
 * the second of the video for any position in beats.
 */
import { bpmAt, type Score } from '../score/model';

/** A moment seen on both clocks: `c` seconds of the capture, `v` seconds of the video. */
export interface ClockSample {
  c: number;
  v: number;
}

/** The slowest and fastest the YouTube player goes. */
export const RATE_MIN = 0.25;
export const RATE_MAX = 2;

/**
 * The video's time at capture time 0, from samples taken while the video
 * played at `rate`: the median of what each sample says, so a sample taken
 * while the player was still seeking or buffering does not count. Null with
 * fewer than three samples.
 */
export function fitOffset(samples: ClockSample[], rate: number): number | null {
  if (samples.length < 3 || !(rate > 0)) return null;
  const offsets = samples.map((s) => s.v - rate * s.c).sort((a, b) => a - b);
  const mid = offsets.length >> 1;
  return offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2;
}

/** Seconds from beat 0 to `beats` at the piece's own tempo (its tempo changes included); negative before beat 0. */
export function secondsAt(score: Pick<Score, 'tempo'>, beats: number): number {
  const [a, b] = beats >= 0 ? [0, beats] : [beats, 0];
  const cuts = [a, ...score.tempo.map((e) => e.t).filter((t) => t > a && t < b), b];
  let s = 0;
  for (let i = 0; i + 1 < cuts.length; i++) s += ((cuts[i + 1] - cuts[i]) * 60) / bpmAt(score as Score, cuts[i]);
  return beats >= 0 ? s : -s;
}

/** The second of the video that shows position `beats` of the piece, given the second of its beat 0. */
export function videoTime(start: number, score: Pick<Score, 'tempo'>, beats: number): number {
  return start + secondsAt(score, beats);
}

/** The player's rate for the trainer's speed (1 = the piece's own tempo), within what the player can do. */
export function videoRate(speed: number): number {
  return Math.min(RATE_MAX, Math.max(RATE_MIN, speed));
}
