/**
 * Finding the piano in a video frame: a band of white keys with black keys in
 * groups of two and three above it, as Synthesia-style videos draw it. The
 * frame may hold more than the video (a whole browser tab); the keyboard may
 * be any width. The result says where to look at each key.
 */
import { isDarkPx, isWhitePx, luma, patch, type Frame } from './frame';

/** Semitones above C of the white keys, C D E F G A B. */
const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
/** Boundaries between white keys (counted from the left edge of C) that carry a black key: C# D# F# G# A#. */
const BLACK_AT = new Set([1, 2, 4, 5, 6]);
/** Keyboards whose range is known from the number of white keys and the first one: [whites, first white (0 = C), lowest pitch]. */
const KNOWN: [number, number, number][] = [
  [52, 5, 21], // 88 keys, A0–C8
  [45, 2, 28], // 76 keys, E1–G7
  [36, 0, 36], // 61 keys, C2–C7
  [29, 0, 36], // 49 keys, C2–C6
];

export interface VideoKey {
  pitch: number;
  black: boolean;
  /** Where to look at the key, in frame pixels: the lower part of a white key. */
  x: number;
  y: number;
  /** A white key's upper part, between its black neighbours: some videos light only that. */
  x2?: number;
  y2?: number;
}

export interface KeyboardLayout {
  /** Every key, lowest first. */
  keys: VideoKey[];
  /** Top edge of the keys: where the falling bars meet the keyboard. */
  top: number;
  /** Bottom of the white keys. */
  bottom: number;
  left: number;
  right: number;
  whiteWidth: number;
  /** True when the key count told us the octave; otherwise middle C is the C nearest the centre. */
  octaveSure: boolean;
  /** Size of the frame the coordinates refer to. */
  width: number;
  height: number;
  /** Black keys seen as dark shapes (how sure the detection is). */
  blackSeen: number;
}

interface Run {
  a: number;
  b: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

function rowWhiteFraction(f: Frame, y: number, x0 = 0, x1 = f.width - 1): number {
  let n = 0;
  const d = f.data;
  for (let x = x0; x <= x1; x++) {
    const i = (y * f.width + x) * 4;
    if (isWhitePx(d[i], d[i + 1], d[i + 2])) n++;
  }
  return n / Math.max(1, x1 - x0 + 1);
}

/** A white key, lit or not: bright, whatever the colour. */
function isKeyPx(r: number, g: number, b: number): boolean {
  return luma(r, g, b) >= 110 || Math.max(r, g, b) >= 170;
}

/** The longest stretch of key pixels on a row, bridging the thin lines between keys and keys lit in colour. */
function whiteExtent(f: Frame, y: number): Run | null {
  const d = f.data;
  const bridge = Math.max(3, Math.round(f.width / 160));
  let best: Run | null = null;
  let start = -1;
  let lastWhite = -1;
  for (let x = 0; x <= f.width; x++) {
    const i = (y * f.width + x) * 4;
    const white = x < f.width && isKeyPx(d[i], d[i + 1], d[i + 2]);
    if (white) {
      if (start < 0 || x - lastWhite > bridge) {
        if (start >= 0 && (!best || lastWhite - start > best.b - best.a)) best = { a: start, b: lastWhite };
        start = x;
      }
      lastWhite = x;
    }
  }
  if (start >= 0 && (!best || lastWhite - start > best.b - best.a)) best = { a: start, b: lastWhite };
  return best;
}

function darkRuns(f: Frame, y: number, x0: number, x1: number, maxW: number): Run[] {
  const d = f.data;
  const runs: Run[] = [];
  let start = -1;
  for (let x = x0; x <= x1 + 1; x++) {
    const i = (y * f.width + x) * 4;
    const dark = x <= x1 && isDarkPx(d[i], d[i + 1], d[i + 2]);
    if (dark && start < 0) start = x;
    else if (!dark && start >= 0) {
      const w = x - start;
      // narrower than a black key can be: the lines between white keys, letters' strokes
      const minW = Math.max(2, Math.round(f.width / 200));
      if (w >= minW && w <= maxW && start > x0 && x <= x1) runs.push({ a: start, b: x - 1 });
      start = -1;
    }
  }
  return runs;
}

/** Runs of similar width: black keys rather than gaps or shadows. */
function consistent(runs: Run[]): Run[] {
  if (runs.length < 3) return [];
  const widths = runs.map((r) => r.b - r.a + 1).sort((a, b) => a - b);
  const med = widths[widths.length >> 1];
  return runs.filter((r) => {
    const w = r.b - r.a + 1;
    return w >= med * 0.5 && w <= med * 1.6;
  });
}

/** Pitch classes of the black keys, in order within an octave, and the boundary (counted in white keys from C) each sits on. */
const BLACK_PC = [1, 3, 6, 8, 10];
const BLACK_B = [1, 2, 4, 5, 6];

interface Octave {
  /** Octave length in pixels (seven white keys). */
  P: number;
  w: number;
  /** Centre of each black key (C#, D#, F#, G#, A#) in one octave. */
  xs: number[];
}

/**
 * The octave from the black keys alone: its length is the shift that lines
 * most black keys up with another one, and the two-and-three grouping tells
 * which is C#. Works whether the black keys sit midway between white keys
 * (most renderers) or off-centre as on a real piano.
 */
function fitOctave(centers: number[]): Octave | null {
  if (centers.length < 6) return null;
  const gaps = centers.slice(1).map((c, i) => c - centers[i]).sort((a, b) => a - b);
  const g0 = gaps[Math.floor(gaps.length * 0.2)];
  if (!(g0 > 2)) return null;
  const tol = g0 * 0.18;
  const score = (P: number) => {
    let s = 0;
    for (const c of centers) {
      let m = Infinity;
      for (const d of centers) m = Math.min(m, Math.abs(d - c - P));
      if (m < tol) s += 1 - m / tol;
    }
    return s;
  };
  let P = 0;
  let best = 0;
  for (let p = g0 * 5; p <= g0 * 8.5; p += 0.25) {
    const s = score(p);
    if (s > best + 1e-9) {
      best = s;
      P = p;
    }
  }
  if (best < 2) return null;
  // refine on the pairs an octave apart
  const pairs: number[] = [];
  for (const c of centers) for (const d of centers) if (Math.abs(d - c - P) < tol) pairs.push(d - c);
  P = pairs.reduce((a, v) => a + v, 0) / pairs.length;
  // five clusters of positions within the octave
  const ref = centers[0];
  const phases = centers.map((c) => {
    let ph = mod(c - ref, P);
    if (ph > P - g0 * 0.4) ph -= P;
    return ph;
  });
  const order = phases.map((_, i) => i).sort((a, b) => phases[a] - phases[b]);
  const clusters: number[][] = [];
  for (const i of order) {
    const last = clusters[clusters.length - 1];
    if (last && phases[i] - phases[last[last.length - 1]] < g0 * 0.4) last.push(i);
    else clusters.push([i]);
  }
  if (clusters.length !== 5) return null;
  // each cluster's centre, brought into one octave
  const pos = clusters.map((cl) => ref + cl.reduce((a, i) => a + phases[i], 0) / cl.length);
  const gap = (k: number) => (k === 4 ? pos[0] + P - pos[4] : pos[k + 1] - pos[k]);
  // C# starts the pair: small gap to D#, big to F#, small, small, big back to C#
  let cs = -1;
  let bestShape = -Infinity;
  for (let k = 0; k < 5; k++) {
    const g = (i: number) => gap((k + i) % 5);
    const shape = (g(1) + g(4)) / 2 - (g(0) + g(2) + g(3)) / 3;
    if (shape > bestShape) {
      bestShape = shape;
      cs = k;
    }
  }
  if (bestShape < g0 * 0.15) return null;
  const xs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const k = (cs + i) % 5;
    // keep the five in ascending order from C#
    xs.push(pos[k] + (k < cs ? P : 0));
  }
  return { P, w: P / 7, xs };
}

/** Where the thin lines between white keys are: the phase of a grid of step w that falls on the darkest pixels. */
function separatorPhase(f: Frame, y: number, a: number, b: number, w: number): { at: number; strength: number } {
  const n = b - a + 1;
  const L = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    let s = 0;
    let c = 0;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(f.height - 1, y + 1); yy++) {
      const i = (yy * f.width + a + x) * 4;
      s += luma(f.data[i], f.data[i + 1], f.data[i + 2]);
      c++;
    }
    L[x] = s / c;
  }
  const mean = L.reduce((s, v) => s + v, 0) / n;
  let at = 0;
  let strength = -Infinity;
  for (let th = 0; th < w; th += 0.25) {
    let s = 0;
    let c = 0;
    for (let x = th; x < n; x += w) {
      const xi = Math.round(x);
      let m = 255;
      for (let d = -1; d <= 1; d++) if (xi + d >= 0 && xi + d < n) m = Math.min(m, L[xi + d]);
      s += mean - m;
      c++;
    }
    if (c && s / c > strength) {
      strength = s / c;
      at = a + th;
    }
  }
  return { at, strength };
}

/** Find the keyboard in a frame, or null when there is none. */
export function detectKeyboard(f: Frame): KeyboardLayout | null {
  const H = f.height;
  // 1. bands of rows that are mostly white: the lower part of the white keys
  const frac = new Float32Array(H);
  for (let y = 0; y < H; y++) frac[y] = rowWhiteFraction(f, y);
  const bands: Run[] = [];
  for (let y = 0; y < H; y++) {
    if (frac[y] < 0.15) continue;
    const last = bands[bands.length - 1];
    if (last && y - last.b <= 2) last.b = y;
    else bands.push({ a: y, b: y });
  }
  let best: KeyboardLayout | null = null;
  for (const band of bands) {
    if (band.b - band.a < 1) continue;
    const found = keyboardAbove(f, band);
    if (found && (!best || found.blackSeen > best.blackSeen)) best = found;
  }
  return best;
}

function keyboardAbove(f: Frame, band: Run): KeyboardLayout | null {
  const W = f.width;
  // the band holds the white keys from top to bottom; its whitest rows (no black keys, no letters) give its extent
  const rows: { y: number; fr: number }[] = [];
  for (let y = band.a; y <= band.b; y++) rows.push({ y, fr: rowWhiteFraction(f, y) });
  rows.sort((p, q) => q.fr - p.fr);
  let ext: Run | null = null;
  for (const { y } of rows.slice(0, Math.max(3, Math.ceil(rows.length * 0.3)))) {
    const e = whiteExtent(f, y);
    if (e && (!ext || e.b - e.a > ext.b - ext.a)) ext = e;
  }
  if (!ext || ext.b - ext.a < Math.max(80, W * 0.15)) return null;
  const span = ext.b - ext.a;
  // 2. the rows with the most black keys, inside the band or just above it
  const limit = Math.max(12, Math.round((band.b - band.a) * 0.5), Math.round(f.height * 0.06));
  const scores: { y: number; n: number; w: number }[] = [];
  for (let y = band.b; y >= Math.max(0, band.a - limit); y--) {
    if (rowWhiteFraction(f, y, ext.a, ext.b) < 0.25) {
      scores.push({ y, n: 0, w: 0 });
      continue;
    }
    const runs = consistent(darkRuns(f, y, ext.a, ext.b, span / 8));
    const ws = runs.map((r) => r.b - r.a + 1).sort((p, q) => p - q);
    scores.push({ y, n: runs.length, w: ws.length ? ws[ws.length >> 1] : 0 });
  }
  // the tallest stretch of rows with many black shapes: the black keys (letters on the keys make a short one)
  let zone: { lo: number; hi: number; size: number } | null = null;
  for (let i = 0; i < scores.length; ) {
    if (scores[i].n < 7) {
      i++;
      continue;
    }
    // a stretch of the same shapes: black keys do not change width from one row to the next
    let j = i;
    const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 0.5;
    while (j + 1 < scores.length && scores[j + 1].n >= 7 && same(scores[j + 1].w, scores[j].w)) j++;
    const ns = scores.slice(i, j + 1).map((x) => x.n).sort((p, q) => p - q);
    const size = (j - i + 1) * ns[ns.length >> 1];
    if (!zone || size > zone.size) zone = { lo: i, hi: j, size };
    i = j + 1;
  }
  if (!zone) return null;
  const zoneBottom = scores[zone.lo].y;
  const zoneTop = scores[zone.hi].y;
  if (zoneBottom - zoneTop < 2) return null;
  const yBlack = Math.round(zoneTop + (zoneBottom - zoneTop) * 0.55);
  const runs = consistent(darkRuns(f, yBlack, ext.a, ext.b, span / 8));
  const centers = runs.map((r) => (r.a + r.b) / 2);
  const oct = fitOctave(centers);
  if (!oct) return null;
  const { P, w, xs } = oct;
  if (band.b - zoneBottom < 3) return null;
  // the lower part of the white keys, nearer its top: letters and logos usually sit at the bottom
  const whiteY = Math.round(zoneBottom + (band.b - zoneBottom) * 0.35);
  // 3. white keys: equal steps of P/7, lined up on the lines between them; C begins just left of C#
  // the lines between white keys show best just below the black keys, above any letters on the keys
  const sepY = Math.min(band.b, zoneBottom + Math.max(2, Math.round((band.b - zoneBottom) * 0.15)));
  const sep = separatorPhase(f, sepY, ext.a, ext.b, w);
  const guess = xs[0] - 0.95 * w;
  const eC = sep.strength >= 12 ? sep.at + Math.round((guess - sep.at) / w) * w : guess;
  const blackAt = (b: number) => xs[BLACK_B.indexOf(mod(b, 7))] + Math.floor(b / 7) * P;
  // the black keys seen, as boundaries between white keys (j counts white keys from that C)
  const seen = new Map<number, number>();
  for (const c of centers) {
    const m = Math.round((c - xs[0]) / P);
    for (let i = 0; i < 5; i++) {
      for (const mm of [m - 1, m, m + 1]) {
        if (Math.abs(c - (xs[i] + mm * P)) < w * 0.35) seen.set(7 * mm + BLACK_B[i], c);
      }
    }
  }
  if (seen.size < 5) return null;
  const bs = [...seen.keys()].sort((a, b) => a - b);
  const centreX = (j: number) => eC + w * (j + 0.5);
  const inFrame = (j: number) => centreX(j) >= 0 && centreX(j) < f.width;
  const isWhiteKey = (j: number) => {
    if (!inFrame(j)) return false;
    const c = patch(f, centreX(j), whiteY, 1);
    return isKeyPx(c[0], c[1], c[2]);
  };
  const keyLuma = (j: number) => {
    const c = patch(f, centreX(j), whiteY, 1);
    return luma(c[0], c[1], c[2]);
  };
  const edgeAt = (x: number, ref: number) => {
    const xi = Math.round(x);
    if (xi - 1 < 0 || xi + 1 >= f.width) return true;
    for (let xx = xi - 2; xx <= xi + 2; xx++) {
      if (xx < 0 || xx >= f.width) return true;
      const i = (whiteY * f.width + xx) * 4;
      if (luma(f.data[i], f.data[i + 1], f.data[i + 2]) < ref - 25) return true;
    }
    return false;
  };
  // a key beyond the black keys seen: one with edges on both sides (white space next to the video is not a key)
  const extra = (j: number) => isWhiteKey(j) && edgeAt(eC + w * j, keyLuma(j)) && edgeAt(eC + w * (j + 1), keyLuma(j));
  let jMin = bs[0] - 1;
  let jMax = bs[bs.length - 1];
  // further out only where the pattern has no black key between a key and its neighbour
  for (let i = 0; i < 2 && !BLACK_AT.has(mod(jMin, 7)) && extra(jMin - 1); i++) jMin--;
  for (let i = 0; i < 2 && !BLACK_AT.has(mod(jMax + 1, 7)) && extra(jMax + 1); i++) jMax++;
  while (jMin <= jMax && !isWhiteKey(jMin)) jMin++;
  while (jMax >= jMin && !isWhiteKey(jMax)) jMax--;
  const whites = jMax - jMin + 1;
  if (whites < 10) return null;
  // 4. which octave: from the key count when it is a standard keyboard, else middle C nearest the centre
  const known = KNOWN.find(([n, first]) => n === whites && first === mod(jMin, 7));
  let cBase: number;
  if (known) {
    cBase = known[2] - WHITE_PC[mod(jMin, 7)] - 12 * Math.floor(jMin / 7);
  } else {
    const centre = (Math.max(0, eC + w * jMin) + Math.min(f.width, eC + w * (jMax + 1))) / 2;
    let jc = jMin;
    let bestD = Infinity;
    for (let j = jMin; j <= jMax; j++) {
      if (mod(j, 7) !== 0) continue;
      const d = Math.abs(centreX(j) - centre);
      if (d < bestD - w * 0.3) {
        bestD = d;
        jc = j;
      }
    }
    cBase = 60 - 12 * Math.floor(jc / 7);
  }
  const whitePitch = (j: number) => cBase + 12 * Math.floor(j / 7) + WHITE_PC[mod(j, 7)];
  const widths = runs.map((r) => r.b - r.a + 1).sort((a, b) => a - b);
  const half = widths[widths.length >> 1] / 2;
  const blackX = (b: number) => seen.get(b) ?? blackAt(b);
  const keys: VideoKey[] = [];
  for (let j = jMin; j <= jMax; j++) {
    // the upper part of the white key, between the black keys beside it
    let l = eC + w * j;
    let r = eC + w * (j + 1);
    if (j > jMin && BLACK_AT.has(mod(j, 7))) l = Math.max(l, blackX(j) + half + 1);
    if (j < jMax && BLACK_AT.has(mod(j + 1, 7))) r = Math.min(r, blackX(j + 1) - half - 1);
    const upper = r - l >= 3 && (l + r) / 2 >= 0 && (l + r) / 2 < f.width ? { x2: (l + r) / 2, y2: yBlack } : {};
    keys.push({ pitch: whitePitch(j), black: false, x: Math.min(f.width - 1, Math.max(0, centreX(j))), y: whiteY, ...upper });
    const b = j + 1;
    if (b <= jMax && BLACK_AT.has(mod(b, 7))) keys.push({ pitch: whitePitch(j) + 1, black: true, x: blackX(b), y: yBlack });
  }
  return {
    keys,
    top: zoneTop,
    bottom: band.b,
    left: eC + w * jMin,
    right: eC + w * (jMax + 1),
    whiteWidth: w,
    octaveSure: !!known,
    width: f.width,
    height: f.height,
    blackSeen: centers.length,
  };
}

/** The same layout one or more octaves up (positive) or down. */
export function shiftOctave(layout: KeyboardLayout, octaves: number): KeyboardLayout {
  return { ...layout, keys: layout.keys.map((k) => ({ ...k, pitch: k.pitch + 12 * octaves })), octaveSure: false };
}

/** The layout for a frame of another size (the same picture scaled). */
export function scaleLayout(layout: KeyboardLayout, width: number, height: number): KeyboardLayout {
  const sx = width / layout.width;
  const sy = height / layout.height;
  return {
    ...layout,
    keys: layout.keys.map((k) => ({ ...k, x: k.x * sx, y: k.y * sy, ...(k.x2 !== undefined ? { x2: k.x2 * sx, y2: k.y2! * sy } : {}) })),
    top: layout.top * sy,
    bottom: layout.bottom * sy,
    left: layout.left * sx,
    right: layout.right * sx,
    whiteWidth: layout.whiteWidth * sx,
    width,
    height,
  };
}

/** Two detections describe the same keyboard: same keys within a fraction of a key. */
export function sameKeyboard(a: KeyboardLayout, b: KeyboardLayout): boolean {
  if (a.keys.length !== b.keys.length || a.keys[0].pitch !== b.keys[0].pitch) return false;
  return Math.abs(a.left - b.left) < a.whiteWidth * 0.4 && Math.abs(a.right - b.right) < a.whiteWidth * 0.4 && Math.abs(a.top - b.top) < a.whiteWidth;
}
