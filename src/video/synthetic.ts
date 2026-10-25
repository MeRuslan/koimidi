/**
 * Synthesia-style video frames drawn from a list of notes: falling bars
 * coloured by hand over a keyboard whose keys light up. Used by the tests and
 * the benchmark, so the recognition can be checked against pieces whose notes
 * are known, without any real video.
 */
import { isBlackKey } from '../score/model';
import type { Frame, RGB } from './frame';

export interface SynthNote {
  pitch: number;
  on: number;
  off: number;
  hand: 'R' | 'L';
}

export interface SynthOptions {
  width?: number;
  height?: number;
  /** Lowest and highest key drawn; 21–108 (88 keys) by default. */
  low?: number;
  high?: number;
  /** A red felt strip above the keys. */
  felt?: boolean;
  /** Random noise added to every channel, ± this much. */
  noise?: number;
  /** Seconds a bar takes to fall from the top of the frame to the keys. */
  fall?: number;
  /** Before this time the frame is a dark title card without a keyboard. */
  keyboardFrom?: number;
  /** Background behind the bars. */
  background?: RGB;
  /** A picture behind the bars instead of a plain colour. */
  picture?: boolean;
  /** Black keys midway between white keys (most renderers), or off-centre as on a real piano. */
  geometry?: 'centered' | 'piano';
  /** What lights up on a white key: all of it, a stripe down the middle, or only its upper part. */
  lit?: 'key' | 'stripe' | 'top';
  /** Note letters at the bottom of the white keys. */
  labels?: boolean;
  /** A translucent logo across the white keys. */
  watermark?: boolean;
  /** The note's name printed near the bottom of each bar, in dark letters. */
  barLabels?: boolean;
  /** Close-up: this many white keys fill the width, starting `shift` keys in (the end keys are cut). */
  visibleWhites?: number;
  shift?: number;
}

const PALETTE: Record<'R' | 'L', { white: RGB; black: RGB; bar: RGB }> = {
  R: { white: [126, 226, 132], black: [40, 150, 60], bar: [86, 204, 104] },
  L: { white: [124, 178, 255], black: [44, 92, 204], bar: [84, 140, 240] },
};
/** Black keys sit a little off the boundary between their white neighbours. */
const BLACK_SHIFT: Record<number, number> = { 1: -0.08, 3: 0.08, 6: -0.1, 8: 0, 10: 0.1 };
/** A real piano's black keys, from the left edge of C, in white-key widths. */
const PIANO_BLACK: Record<number, [number, number]> = {
  1: [0.6, 1.2],
  3: [1.8, 2.4],
  6: [3 + 4 / 7, 3 + 8 / 7],
  8: [3 + 12 / 7, 3 + 16 / 7],
  10: [3 + 20 / 7, 3 + 24 / 7],
};
/** Index of each white key's pitch class from C (for finding the C left of a black key). */
const WHITE_INDEX: Record<number, number> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };

export interface SyntheticVideo {
  width: number;
  height: number;
  /** Top row of the keys. */
  keyTop: number;
  /** Bars' speed in pixels per second. */
  speed: number;
  frameAt(t: number): Frame;
}

export function syntheticVideo(notes: SynthNote[], o: SynthOptions = {}): SyntheticVideo {
  const W = o.width ?? 640;
  const H = o.height ?? 360;
  const low = o.low ?? 21;
  const high = o.high ?? 108;
  const bg = o.background ?? [20, 22, 28];
  const whites: number[] = [];
  for (let p = low; p <= high; p++) if (!isBlackKey(p)) whites.push(p);
  const ww = W / (o.visibleWhites ?? whites.length);
  const x0 = -(o.shift ?? 0) * ww;
  const keyTop = Math.round(H * 0.82);
  const blackH = Math.round((H - keyTop) * 0.62);
  const lanes = new Map<number, { x0: number; x1: number; black: boolean }>();
  whites.forEach((p, j) => lanes.set(p, { x0: x0 + j * ww, x1: x0 + (j + 1) * ww, black: false }));
  for (let p = low; p <= high; p++) {
    if (!isBlackKey(p)) continue;
    const left = lanes.get(p - 1);
    if (!left) continue;
    if (o.geometry === 'piano') {
      // C–E split into five equal parts, F–B into seven: black keys sit off the boundaries
      const pc = p % 12;
      const c = lanes.get(p - pc)?.x0 ?? left.x0 - WHITE_INDEX[pc - 1] * ww;
      const [a, b] = PIANO_BLACK[pc];
      lanes.set(p, { x0: c + a * ww, x1: c + b * ww, black: true });
    } else {
      const c = left.x1 + (BLACK_SHIFT[p % 12] ?? 0) * ww;
      lanes.set(p, { x0: c - 0.29 * ww, x1: c + 0.29 * ww, black: true });
    }
  }
  const speed = keyTop / (o.fall ?? 3);
  let seed = 1;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  const frameAt = (t: number): Frame => {
    const data = new Uint8ClampedArray(W * H * 4);
    const rect = (x0: number, y0: number, x1: number, y1: number, c: RGB) => {
      const xa = Math.max(0, Math.round(x0));
      const xb = Math.min(W, Math.round(x1));
      const ya = Math.max(0, Math.round(y0));
      const yb = Math.min(H, Math.round(y1));
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const i = (y * W + x) * 4;
          data[i] = c[0];
          data[i + 1] = c[1];
          data[i + 2] = c[2];
          data[i + 3] = 255;
        }
      }
    };
    rect(0, 0, W, H, bg);
    if (o.picture) {
      // a soft photo-like background: slow waves of grey-green
      for (let y = 0; y < keyTop; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const v = 40 + 25 * Math.sin(x / 37 + y / 53) + 18 * Math.cos(y / 19 - x / 71);
          data[i] = v * 0.8;
          data[i + 1] = v;
          data[i + 2] = v * 0.9;
        }
      }
    }
    if (o.keyboardFrom === undefined || t >= o.keyboardFrom) {
      // octave lines in the falling area
      for (const p of whites) if (p % 12 === 0) rect(lanes.get(p)!.x0, 0, lanes.get(p)!.x0 + 1, keyTop, [34, 38, 46]);
      // bars: white-key lanes first, black-key lanes on top
      for (const black of [false, true]) {
        for (const n of notes) {
          const lane = lanes.get(n.pitch);
          if (!lane || lane.black !== black || n.off < t || n.on - t > keyTop / speed) continue;
          const bottom = keyTop - (n.on - t) * speed;
          const top = keyTop - (n.off - t) * speed;
          const inset = black ? 0 : 0.12 * ww;
          const c = PALETTE[n.hand].bar;
          const edge: RGB = [c[0] * 0.25, c[1] * 0.25, c[2] * 0.25];
          rect(lane.x0 + inset, top, lane.x1 - inset, Math.min(bottom, keyTop), edge);
          rect(lane.x0 + inset + 1, top + 1, lane.x1 - inset - 1, Math.min(bottom - 1, keyTop), c);
          if (o.barLabels && bottom - top > 16) {
            // a letter like "B": a stem and three bars, more than half the bar wide
            const xm = (lane.x0 + lane.x1) / 2;
            const half = (lane.x1 - lane.x0 - 2 * inset) * 0.3;
            const ink: RGB = [30, 34, 30];
            const yb = bottom - 4;
            const ht = Math.min(12, (bottom - top) * 0.5);
            rect(xm - half, yb - ht, xm - half + 2, yb, ink);
            for (const k of [0, 0.5, 1]) rect(xm - half, yb - ht + k * (ht - 2), xm + half, yb - ht + k * (ht - 2) + 2, ink);
          }
        }
      }
      if (o.felt) rect(0, keyTop - 3, W, keyTop, [140, 24, 36]);
      const lit = new Map<number, 'R' | 'L'>();
      for (const n of notes) if (n.on <= t && t < n.off) lit.set(n.pitch, n.hand);
      const style = o.lit ?? 'key';
      for (const p of whites) {
        const l = lanes.get(p)!;
        const h = lit.get(p);
        rect(l.x0, keyTop, l.x1, H, h && style === 'key' ? PALETTE[h].white : [236, 236, 236]);
        if (h && style === 'stripe') rect(l.x0 + 0.22 * ww, keyTop, l.x1 - 0.22 * ww, H, PALETTE[h].white);
        if (h && style === 'top') rect(l.x0, keyTop, l.x1, keyTop + blackH, PALETTE[h].white);
        rect(l.x0, keyTop, l.x0 + 1, H, [110, 110, 110]);
        if (o.labels) rect(l.x0 + 0.38 * ww, H - (H - keyTop) * 0.22, l.x1 - 0.38 * ww, H - (H - keyTop) * 0.1, [40, 40, 40]);
      }
      for (const [p, l] of lanes) {
        if (!l.black) continue;
        const h = lit.get(p);
        rect(l.x0, keyTop, l.x1, keyTop + blackH, h ? PALETTE[h].black : [18, 18, 18]);
      }
      if (o.watermark) {
        // translucent pink letters over the lower keys
        const y0 = Math.round(keyTop + (H - keyTop) * 0.74);
        const y1 = Math.round(keyTop + (H - keyTop) * 0.86);
        for (let y = y0; y < y1; y++) {
          for (let x = Math.round(W * 0.35); x < W * 0.65; x++) {
            if ((x >> 2) % 3 === 0) continue;
            const i = (y * W + x) * 4;
            data[i] = data[i] * 0.6 + 255 * 0.4;
            data[i + 1] = data[i + 1] * 0.6 + 150 * 0.4;
            data[i + 2] = data[i + 2] * 0.6 + 180 * 0.4;
          }
        }
      }
    } else {
      rect(W * 0.3, H * 0.4, W * 0.7, H * 0.5, [200, 200, 210]);
    }
    const noise = o.noise ?? 0;
    if (noise) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] += (rand() * 2 - 1) * noise;
        data[i + 1] += (rand() * 2 - 1) * noise;
        data[i + 2] += (rand() * 2 - 1) * noise;
      }
    }
    return { width: W, height: H, data };
  };
  return { width: W, height: H, keyTop, speed, frameAt };
}
