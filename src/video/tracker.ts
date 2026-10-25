/**
 * Following the keys through the video: a key that changes colour is pressed.
 * Each frame costs a few hundred pixel reads. Notes come out in seconds of
 * video time with the colour they were lit in, which is the hand in most videos.
 *
 * Every frame's colours are kept (a few hundred bytes a frame), and the notes
 * are worked out at the end against each key's usual colour over the whole
 * video: letters, logos and shading drawn on the keys never count as a press.
 * A white key is watched in two places, low and high between its black
 * neighbours, since some videos light only one of them.
 *
 * A key held across two notes of the same pitch stays lit, so the tracker also
 * watches the falling bars just above the keys: the gap between two bars,
 * moving down at the speed of the bars, says when the second note starts.
 */
import { chroma, dist, patch, type Frame, type RGB } from './frame';
import type { KeyboardLayout } from './keyboard';

export interface RawNote {
  pitch: number;
  /** Seconds of video time. */
  on: number;
  off: number;
  /** Mean colour of the key while it was lit. */
  color: RGB;
}

interface Point {
  key: number;
  x: number;
  y: number;
}

/** Litness above which a key turns on, and below which it turns off again. */
const ON = 1;
const OFF = 0.65;
/** A frame where more keys than this share light up at once is a fade, a cut or something drawn over the video. */
const AWAY = 0.35;
/** Seconds without a view of the keyboard after which held keys count as released. */
const HOLE = 0.5;
/** A falling bar is vivid and bright, whatever is behind it (a plain colour or a dimmed picture). */
function isBar(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) >= 50 && 0.299 * r + 0.587 * g + 0.114 * b >= 60;
}

function litness(c: RGB, base: RGB): number {
  return Math.max(dist(c, base) / 70, (chroma(c) - chroma(base)) / 50);
}

export class KeyTracker {
  private points: Point[] = [];
  /** Per key, its points. */
  private pointsOf: number[][];
  /** Each point's colour in the calibration frame: the reference while recording. */
  private base: RGB[];
  /** While recording: which keys look lit, and how many presses so far (the final count comes from finish). */
  private liveLit: boolean[];
  private presses = 0;
  private colors: Uint8Array[] = [];
  private times: number[] = [];
  private lastT = NaN;
  private firstT = NaN;
  private r: number;
  private laneH: number;
  /** First row above the keys clear of decoration (felt strip, shadow); 0 turns the bar watching off. */
  private laneStart = 0;
  private prevBars: Uint8Array[] | null = null;
  private prevT = 0;
  private speeds: number[] = [];
  /** Half-widths of falling bars seen so far, white-key lanes and black-key lanes. */
  private barHalf: [number[], number[]] = [[], []];
  private barHalfAt: [number, number];
  /** Per key: lowest bar bottom seen above the keys, as [time, height, time, height, …]. */
  private bottoms: number[][];
  frames = 0;
  skipped = 0;

  constructor(
    readonly layout: KeyboardLayout,
    calibration: Frame,
    calibrationY0 = 0,
  ) {
    this.r = Math.max(1, Math.min(3, Math.round(layout.whiteWidth * 0.12)));
    this.laneH = Math.max(0, Math.min(Math.floor(layout.top) - 1, Math.max(16, Math.round(layout.height * 0.18))));
    this.pointsOf = layout.keys.map((k, key) => {
      const ids = [this.points.push({ key, x: k.x, y: k.y }) - 1];
      if (k.x2 !== undefined && k.y2 !== undefined) ids.push(this.points.push({ key, x: k.x2, y: k.y2 }) - 1);
      return ids;
    });
    this.base = this.points.map((p) => patch(calibration, p.x, p.y - calibrationY0, this.r));
    this.liveLit = layout.keys.map(() => false);
    this.bottoms = layout.keys.map(() => []);
    this.barHalfAt = [layout.whiteWidth * 0.3, layout.whiteWidth * 0.18];
    this.calibrateLanes(calibration, calibrationY0);
  }

  /** Rows of the frame the tracker reads (inclusive): hand it just this band. */
  get band(): { top: number; bottom: number } {
    const lowest = Math.max(...this.points.map((p) => p.y));
    return {
      top: Math.max(0, Math.floor(this.layout.top) - this.laneH - 1),
      bottom: Math.min(this.layout.height - 1, Math.ceil(lowest) + this.r + 1),
    };
  }

  /** Presses seen so far (a preview: the final notes come from finish). */
  get count(): number {
    return this.presses;
  }

  /** Pitches that looked lit in the last frame. */
  lit(): number[] {
    return this.layout.keys.filter((_, i) => this.liveLit[i]).map((k) => k.pitch);
  }

  private calibrateLanes(f: Frame, y0: number): void {
    if (this.laneH < 12) return;
    const top = Math.round(this.layout.top);
    // rows right above the keys that look like a bar in most lanes are decoration (a felt strip, a glow)
    // (on compressed video the row between the keys and a felt strip is a blur, so look at the first few rows, not just the first)
    const barRow = (h: number) => this.layout.keys.filter((k) => isBar(...patch(f, k.x, top - h - y0, 0))).length;
    let last = 0;
    for (let h = 1; h <= Math.min(10, Math.floor(this.laneH / 4)); h++) if (barRow(h) > this.layout.keys.length * 0.5) last = h;
    const start = last + 2;
    this.laneStart = start < this.laneH * 0.5 ? start : 0;
  }

  /** Feed one frame: the whole frame, or the band from `band` starting at row y0. `t` is its video time in seconds. */
  push(f: Frame, t: number, y0 = 0): void {
    this.frames++;
    if (Number.isNaN(this.firstT)) this.firstT = t;
    const row = new Uint8Array(this.points.length * 3);
    this.points.forEach((p, i) => {
      const c = patch(f, p.x, p.y - y0, this.r);
      row[i * 3] = c[0];
      row[i * 3 + 1] = c[1];
      row[i * 3 + 2] = c[2];
    });
    this.colors.push(row);
    this.times.push(t);
    // the preview: lit against the calibration frame
    const keyLit = this.pointsOf.map((ids) => Math.max(...ids.map((i) => litness([row[i * 3], row[i * 3 + 1], row[i * 3 + 2]], this.base[i]))));
    if (keyLit.filter((v) => v > ON).length <= keyLit.length * AWAY) {
      keyLit.forEach((v, k) => {
        if (!this.liveLit[k] && v > ON) {
          this.liveLit[k] = true;
          this.presses++;
        } else if (this.liveLit[k] && v < OFF) this.liveLit[k] = false;
      });
    }
    if (this.laneStart) this.watchLanes(f, t, y0);
    this.lastT = t;
  }

  private watchLanes(f: Frame, t: number, y0: number): void {
    const top = Math.round(this.layout.top);
    const cur: Uint8Array[] = [];
    // five columns across each bar, out to near its edges: a gap between two bars crosses all of them,
    // the letter printed on a bar (a note name) only the middle ones
    const keys = this.layout.keys;
    const bar = (x: number, y: number) => {
      const p = (y * f.width + x) * 4;
      return isBar(f.data[p], f.data[p + 1], f.data[p + 2]);
    };
    for (let i = 0; i < keys.length; i++) {
      const xc = Math.round(keys[i].x);
      const hw = this.barHalfAt[keys[i].black ? 1 : 0];
      const xs = [-0.85, -0.45, 0, 0.45, 0.85].map((k) => Math.round(xc + k * hw)).filter((x) => x >= 0 && x < f.width);
      const bits = new Uint8Array(this.laneH + 1);
      for (let h = this.laneStart; h <= this.laneH; h++) {
        const y = top - h - y0;
        if (y < 0 || y >= f.height) continue;
        for (const x of xs) {
          if (bar(x, y)) {
            bits[h] = 1;
            break;
          }
        }
      }
      cur.push(bits);
      // now and then, how wide the bars are: from the middle of a bar out to its edges, on one row
      const hm = (this.laneStart + this.laneH) >> 1;
      const ym = top - hm - y0;
      if (this.frames % 4 === 0 && ym >= 0 && ym < f.height && bar(xc, ym) && bits[hm - 2] && bits[hm + 2]) {
        const lim = Math.round(this.layout.whiteWidth * 0.6);
        let l = 0;
        let r = 0;
        while (l < lim && xc - l - 1 >= 0 && bar(xc - l - 1, ym)) l++;
        while (r < lim && xc + r + 1 < f.width && bar(xc + r + 1, ym)) r++;
        if (l < lim && r < lim) {
          const k = keys[i].black ? 1 : 0;
          const list = this.barHalf[k];
          list.push(Math.min(l, r) + 0.5);
          if (list.length > 400) list.shift();
          if (list.length >= 15) this.barHalfAt[k] = median(list);
        }
      }
    }
    // a line across most lanes is decoration (a felt strip, a glow), never notes: it takes the state of the row above
    for (let h = this.laneH; h >= this.laneStart; h--) {
      let n = 0;
      for (const bits of cur) n += bits[h];
      if (n > keys.length * 0.5) for (const bits of cur) bits[h] = h < this.laneH ? bits[h + 1] : 0;
    }
    // the next bar's bottom; right at the keys the picture blurs into the keys, so a few rows up at least
    cur.forEach((bits, i) => {
      for (let h = this.laneStart + 3; h <= this.laneH; h++) {
        if (bits[h] && !bits[h - 1]) {
          this.bottoms[i].push(t, h);
          break;
        }
      }
    });
    const prev = this.prevBars;
    if (prev && t > this.prevT) this.measureSpeed(prev, cur, t - this.prevT);
    this.prevBars = cur;
    this.prevT = t;
  }

  /** How far the bars moved since the previous frame: the shift that best lines the two pictures up. */
  private measureSpeed(prev: Uint8Array[], cur: Uint8Array[], dt: number): void {
    const active: number[] = [];
    for (let i = 0; i < prev.length; i++) {
      const b = prev[i];
      for (let h = this.laneStart + 1; h <= this.laneH; h++) {
        if (b[h] !== b[h - 1]) {
          active.push(i);
          break;
        }
      }
    }
    if (!active.length) return;
    const sMax = Math.floor((this.laneH - this.laneStart) / 2);
    const m: number[] = [];
    for (let s = 0; s <= sMax; s++) {
      let mis = 0;
      let cnt = 0;
      for (const i of active) {
        const a = cur[i];
        const b = prev[i];
        for (let h = this.laneStart; h + s <= this.laneH; h++) {
          cnt++;
          if (a[h] !== b[h + s]) mis++;
        }
      }
      m.push(cnt ? mis / cnt : 1);
    }
    let best = 1;
    for (let s = 2; s <= sMax; s++) if (m[s] < m[best]) best = s;
    if (!(m[0] > 0) || m[best] > m[0] * 0.5) return;
    let s = best;
    if (best > 0 && best < sMax) {
      const den = m[best - 1] - 2 * m[best] + m[best + 1];
      if (den > 0) s += (0.5 * (m[best - 1] - m[best + 1])) / den;
    }
    this.speeds.push(s / dt);
  }

  /**
   * Bars' speed in frame pixels per second, when it could be measured. A mean, not a median: bars are
   * drawn at whole pixels, so single steps alternate between two values and only their mean is right.
   */
  get speed(): number | null {
    if (this.speeds.length < 5) return null;
    const s = [...this.speeds].sort((a, b) => a - b);
    const mid = s.slice(Math.floor(s.length * 0.1), Math.ceil(s.length * 0.9));
    return mid.reduce((a, v) => a + v, 0) / mid.length;
  }

  /**
   * Stop and work out the notes: each point's usual colour is its median over
   * the frames that show the keyboard; a key is lit while any of its points
   * strays from that. Then held repeats are split and keys that never went
   * dark are dropped.
   */
  finish(): RawNote[] {
    const n = this.colors.length;
    if (!n) return [];
    const P = this.points.length;
    const at = (f: number, i: number): RGB => {
      const r = this.colors[f];
      return [r[i * 3], r[i * 3 + 1], r[i * 3 + 2]];
    };
    // frames where the keyboard is not showing (title cards, fades), by the calibration colours
    const away = new Uint8Array(n);
    for (let f = 0; f < n; f++) {
      let lit = 0;
      for (const ids of this.pointsOf) if (Math.max(...ids.map((i) => litness(at(f, i), this.base[i]))) > ON) lit++;
      if (lit > this.pointsOf.length * AWAY) away[f] = 1;
    }
    this.skipped = away.reduce((a, v) => a + v, 0);
    // each point's usual colour: per-channel medians from histograms
    const usual: RGB[] = [];
    const hist = new Uint32Array(256 * 3);
    let shown = 0;
    for (let f = 0; f < n; f++) if (!away[f]) shown++;
    for (let i = 0; i < P; i++) {
      hist.fill(0);
      for (let f = 0; f < n; f++) {
        if (away[f]) continue;
        const r = this.colors[f];
        hist[r[i * 3]]++;
        hist[256 + r[i * 3 + 1]]++;
        hist[512 + r[i * 3 + 2]]++;
      }
      const med = [0, 1, 2].map((ch) => {
        let acc = 0;
        for (let v = 0; v < 256; v++) {
          acc += hist[ch * 256 + v];
          if (acc * 2 >= shown) return v;
        }
        return 255;
      }) as RGB;
      // a key held down most of the video would make its lit colour the usual one: keep a plain calibration colour then
      usual.push(shown && !(chroma(med) > 40 && chroma(this.base[i]) < 25) ? med : this.base[i]);
    }
    // the notes, key by key, with hysteresis. A short stretch away from the keyboard (a fade) changes
    // nothing; after a longer one, or a hole in the frames (the video stalled), held keys are let go
    const notes: RawNote[] = [];
    this.pointsOf.forEach((ids, k) => {
      let lit = false;
      let seen = this.times[0];
      let on = 0;
      let sum: RGB = [0, 0, 0];
      let cnt = 0;
      const close = (t: number) => {
        if (cnt && t - on >= 0.02) notes.push({ pitch: this.layout.keys[k].pitch, on, off: t, color: sum.map((v) => v / cnt) as RGB });
      };
      for (let f = 0; f < n; f++) {
        if (away[f]) continue;
        if (lit && this.times[f] - seen > HOLE) {
          lit = false;
          close(seen);
        }
        seen = this.times[f];
        let best = 0;
        let bestC: RGB = [0, 0, 0];
        for (const i of ids) {
          const c = at(f, i);
          const v = litness(c, usual[i]);
          if (v > best) {
            best = v;
            bestC = c;
          }
        }
        // halfway since the frame before, unless there was a hole
        const t = f && this.times[f] - this.times[f - 1] <= HOLE ? (this.times[f - 1] + this.times[f]) / 2 : this.times[f];
        if (!lit && best > ON) {
          lit = true;
          on = t;
          sum = [0, 0, 0];
          cnt = 0;
        } else if (lit && best < OFF) {
          lit = false;
          close(t);
        }
        if (lit) {
          sum[0] += bestC[0];
          sum[1] += bestC[1];
          sum[2] += bestC[2];
          cnt++;
        }
      }
      if (lit) close(seen);
    });
    // a video that darkens the key between two presses of it needs no help from the bars: there, the
    // labels and rounded ends on the bars would only look like gaps
    let out = lightGaps(notes) >= 3 ? notes : this.splitRepeats(notes);
    // where presses light up in colour, a key gone grey is a caption or a logo passing over it, not a press
    const vivid = (x: RawNote) => chroma(x.color) >= 40;
    if (out.filter(vivid).length >= out.length * 0.8) out = out.filter((x) => chroma(x.color) >= 20);
    const span = this.lastT - this.firstT;
    if (span > 10) {
      const held = new Map<number, number>();
      for (const x of out) held.set(x.pitch, (held.get(x.pitch) ?? 0) + x.off - x.on);
      out = out.filter((x) => (held.get(x.pitch) ?? 0) < span * 0.6);
    }
    return out.sort((a, b) => a.on - b.on || a.pitch - b.pitch);
  }

  private splitRepeats(notes: RawNote[]): RawNote[] {
    const v = this.speed;
    if (!v) return notes;
    const starts = new Map<number, number[]>();
    this.layout.keys.forEach((k, i) => {
      const s = this.bottoms[i];
      // [arrival time, height above the keys]
      const ps: [number, number][] = [];
      for (let j = 0; j < s.length; j += 2) ps.push([s[j] + s[j + 1] / v, s[j + 1]]);
      ps.sort((a, b) => a[0] - b[0]);
      // a moving bar gives the same arrival time frame after frame; anything standing still drifts.
      // The bar's last sightings, closest to the keys, give the time best.
      const out: number[] = [];
      let g: [number, number][] = [];
      const flush = () => {
        if (g.length >= 4 && g[g.length - 1][0] - g[0][0] <= 0.08) {
          const near = [...g].sort((a, b) => a[1] - b[1]).slice(0, 2);
          out.push(near.reduce((sum, p) => sum + p[0], 0) / near.length);
        }
        g = [];
      };
      for (const p of ps) {
        if (g.length && p[0] - g[g.length - 1][0] > 0.025) flush();
        g.push(p);
      }
      flush();
      starts.set(k.pitch, out);
    });
    const out: RawNote[] = [];
    for (const n of notes) {
      // not right at either end of a note, where bars carry labels and rounded corners
      const cuts = (starts.get(n.pitch) ?? []).filter((p) => p > n.on + 0.15 && p < n.off - 0.15);
      let on = n.on;
      for (const c of cuts) {
        out.push({ ...n, on, off: c - 0.01 });
        on = c;
      }
      out.push({ ...n, on });
    }
    return out;
  }
}

/** Presses of one key that follow each other after a short dark gap (under 0.15 s). */
function lightGaps(notes: RawNote[]): number {
  const last = new Map<number, number>();
  let n = 0;
  for (const x of [...notes].sort((a, b) => a.on - b.on)) {
    const off = last.get(x.pitch);
    if (off !== undefined && x.on - off > 0 && x.on - off < 0.15) n++;
    last.set(x.pitch, x.off);
  }
  return n;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}
