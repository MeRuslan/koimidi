/**
 * Keyboard profile: how many keys the player's controller has. The on-screen
 * keyboard mirrors a small controller key for key, and the trainer warns when
 * a piece needs more keys than the controller has.
 *
 * Controllers shift by octaves (OCTAVE buttons), so a profile is a span of
 * keys; it is placed at whichever octave suits the piece best.
 */
export type KeyboardSize = '25' | '32' | '37' | '49' | '61' | '76' | '88';
export type KeyboardChoice = 'auto' | KeyboardSize;

export interface KeyRange {
  low: number;
  high: number;
}

export const KEYBOARD_SIZES: KeyboardSize[] = ['25', '32', '37', '49', '61', '76', '88'];

/** Usual default range of each size; the lowest key sets which note the span starts on. */
const PRESETS: Record<KeyboardSize, KeyRange> = {
  '25': { low: 48, high: 72 }, // C3–C5
  '32': { low: 48, high: 79 }, // C3–G5, e.g. Komplete Kontrol M32
  '37': { low: 48, high: 84 }, // C3–C6
  '49': { low: 36, high: 84 }, // C2–C6
  '61': { low: 36, high: 96 }, // C2–C7
  '76': { low: 28, high: 103 }, // E1–G7
  '88': { low: 21, high: 108 }, // A0–C8
};

/** Above this many keys the stage keeps fitting the piece: the whole controller would make the keys too narrow. */
export const MIRROR_MAX_KEYS = 49;

export function presetRange(size: KeyboardSize): KeyRange {
  return PRESETS[size];
}

/** Guess the key count from Web MIDI device names ("Komplete Kontrol M32", "Keystation 49 MK3", "MPK mini"). */
export function guessSize(names: string[]): KeyboardSize | null {
  for (const raw of names) {
    const name = raw.toLowerCase();
    const mpk = /mpk2(25|49|61|88)/.exec(name);
    if (mpk) return mpk[1] as KeyboardSize;
    const m = /(?<!\d)(25|32|37|49|61|76|88)(?!\d)/.exec(name);
    if (m) return m[1] as KeyboardSize;
    if (/keystep/.test(name)) return '32';
    if (/\bmini\b|minilab|nanokey|lpk25/.test(name)) return '25';
  }
  return null;
}

export interface Placement {
  /** Controller keys as placed for this piece. */
  low: number;
  high: number;
  /** Octaves the controller is shifted from its usual range. */
  shift: number;
  /** Notes that stay outside the controller even at the best octave. */
  outside: number;
  /** Keys the selection spans, lowest to highest note inclusive. */
  needs: number;
}

/** Place the controller at the octave that leaves the fewest notes outside, preferring no shift. */
export function placeRange(range: KeyRange, pitches: number[]): Placement {
  if (!pitches.length) return { ...range, shift: 0, outside: 0, needs: 0 };
  const lo = Math.min(...pitches);
  const hi = Math.max(...pitches);
  let best: Placement | null = null;
  const fixed = range.high - range.low >= 87; // a full-size keyboard has nowhere to shift
  for (const shift of fixed ? [0] : [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
    const low = range.low + 12 * shift;
    const high = range.high + 12 * shift;
    if (low < 0 || high > 127) continue;
    const outside = pitches.filter((p) => p < low || p > high).length;
    if (!best || outside < best.outside) best = { low, high, shift, outside, needs: hi - lo + 1 };
    if (outside === 0) break;
  }
  return best!;
}

/** Does a pitch span fit the controller at some octave? */
export function fits(range: KeyRange, low: number, high: number): boolean {
  return placeRange(range, [low, high]).outside === 0;
}

export function keyCount(range: KeyRange): number {
  return range.high - range.low + 1;
}
