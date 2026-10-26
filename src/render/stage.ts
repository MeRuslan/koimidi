/**
 * Canvas renderer. Bars fall in their key's lane towards a felt strip where
 * the keyboard sits; colour = finger, number at the bar's leading edge. The
 * paper behind the bars is the page's own background (the canvas leaves it
 * clear); every colour comes from the current look (see theme.ts).
 */
import { keyLabel, t, type NameStyle } from '../i18n';
import { letterFor } from '../input/keyboard';
import { keyCount, MIRROR_MAX_KEYS, placeRange, type KeyRange, type Placement } from '../input/profile';
import { bpmAt, isBlackKey, type Score, type ScoreNote } from '../score/model';
import type { Engine, FlashKind } from '../practice/engine';
import { fingerColor, palette, type Palette } from '../theme';

const LOOKAHEAD_SEC = 5;
/** height of the felt strip between the bars and the keys */
const FELT = 4;
/** keys added on each side while notes are edited, so a note can go a little beyond the piece */
const EDIT_PAD = 5;

interface Flash {
  p: number;
  kind: FlashKind;
  t0: number;
}
interface Ripple {
  x: number;
  color: string;
  t0: number;
}

export interface KeyRect {
  x: number;
  w: number;
  black: boolean;
}

export interface BarRect {
  x: number;
  w: number;
  top: number;
  bot: number;
}

export class Stage {
  private ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  kbH = 0;
  waterY = 0;
  low = 60;
  high = 84;
  whites: number[] = [];
  wk = 0;
  nameStyle: NameStyle = 'letters';
  reduceMotion = false;
  /** The player's controller (keyboard profile), or null to just fit the piece. */
  profile: KeyRange | null = null;
  /** Where the controller sits for the current piece and hand. */
  placement: Placement | null = null;
  /** Note whose finger is being edited: drawn with a dashed outline. */
  selected: ScoreNote | null = null;
  /** Notes are being edited: the bars stand still over a beat grid, without the practice marks. */
  editing = false;
  /** Where a new note would go under the pointer, while editing. */
  ghost: { pitch: number; t: number; dur: number } | null = null;
  /** Pitch of the computer's "A" key when its letters are shown on the keys (no MIDI keyboard), else null. */
  letters: number | null = null;
  private ppb = 1;
  private flashes: Flash[] = [];
  private ripples: Ripple[] = [];
  private engine: Engine | null = null;
  private score: Score | null = null;
  private pal: Palette = palette();
  private whiteFill: CanvasGradient | string = '#fff';
  private blackFill: CanvasGradient | string = '#000';

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  attach(score: Score, engine: Engine): void {
    this.score = score;
    this.engine = engine;
    this.flashes = [];
    this.ripples = [];
    this.fitRange();
    this.resize();
  }

  /** The look changed: take the new colours. */
  refreshPalette(): void {
    this.pal = palette();
    this.makeGradients();
  }

  /**
   * Keyboard range. With a small controller: exactly its keys at the octave
   * that suits the piece (plus any notes that do not fit). Otherwise the
   * practised notes plus some margin, at least two octaves.
   */
  fitRange(): void {
    if (!this.engine) return;
    const own = this.engine.activeNotes.map((n) => n.pitch);
    // the trainer's hand is shown too, but the controller is placed for the player's notes
    const pitches = [...own, ...this.engine.accompaniment.map((n) => n.pitch)];
    this.placement = this.profile ? placeRange(this.profile, own) : null;
    const pad = this.editing ? EDIT_PAD : 0;
    if (this.profile && this.placement && keyCount(this.profile) <= MIRROR_MAX_KEYS) {
      let lo = Math.min(this.placement.low, ...pitches) - pad;
      let hi = Math.max(this.placement.high, ...pitches) + pad;
      while (isBlackKey(lo)) lo--;
      while (isBlackKey(hi)) hi++;
      this.low = Math.max(0, lo);
      this.high = Math.min(127, hi);
      this.resize();
      return;
    }
    let lo = pitches.length ? Math.min(...pitches) - 2 - pad : 55;
    let hi = pitches.length ? Math.max(...pitches) + 2 + pad : 79;
    while (isBlackKey(lo)) lo--;
    while (isBlackKey(hi)) hi++;
    while (hi - lo < 24) {
      lo--;
      hi++;
      while (isBlackKey(lo)) lo--;
      while (isBlackKey(hi)) hi++;
    }
    this.low = Math.max(21, lo);
    this.high = Math.min(108, hi);
    this.resize();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width;
    this.h = r.height;
    this.whites = [];
    for (let p = this.low; p <= this.high; p++) if (!isBlackKey(p)) this.whites.push(p);
    this.wk = r.width / Math.max(1, this.whites.length);
    // keys a little longer when they are wide (few keys), as on a real keyboard
    this.kbH = Math.round(Math.max(84, Math.min(r.height * 0.27, this.wk * 4.4, 200)));
    this.waterY = r.height - this.kbH;
    this.makeGradients();
  }

  private makeGradients(): void {
    const { waterY, kbH, pal } = this;
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, waterY, 0, waterY + kbH);
    g.addColorStop(0, pal.white);
    g.addColorStop(0.75, pal.white);
    g.addColorStop(1, pal.white2);
    this.whiteFill = g;
    const b = ctx.createLinearGradient(0, waterY, 0, waterY + kbH * 0.62);
    b.addColorStop(0, pal.black2);
    b.addColorStop(0.85, pal.black);
    b.addColorStop(1, pal.black);
    this.blackFill = b;
  }

  keyRect(p: number): KeyRect {
    if (!isBlackKey(p)) {
      const i = this.whites.indexOf(p);
      return { x: i * this.wk, w: this.wk, black: false };
    }
    const i = this.whites.indexOf(p - 1);
    const bw = this.wk * 0.58;
    // black keys sit a little off-centre, as on a piano: C♯/D♯ lean left and right, likewise F♯ and A♯
    const pc = p % 12;
    const lean = pc === 1 || pc === 6 ? -0.08 : pc === 3 || pc === 10 ? 0.08 : 0;
    return { x: (i + 1) * this.wk - bw / 2 + lean * bw, w: bw, black: true };
  }

  /** Is the key outside the player's controller as placed for this piece? */
  outsideController(p: number): boolean {
    const pl = this.placement;
    return !!pl && (p < pl.low || p > pl.high);
  }

  /** Where a note's bar is drawn at the given scroll, or null when off screen. */
  private barRect(n: ScoreNote, pos: number): BarRect | null {
    const yb = this.waterY - (n.t - pos) * this.ppb;
    const yt = yb - n.dur * this.ppb;
    if (yb < -10 || yt > this.waterY) return null;
    if (n.pitch < this.low || n.pitch > this.high) return null;
    const r = this.keyRect(n.pitch);
    if (r.x < -r.w || r.x > this.w) return null;
    const inset = r.black ? 1.5 : Math.min(5, Math.max(2, r.w * 0.1));
    const top = Math.max(yt + 1.5, -10);
    const bot = Math.min(yb - 1.5, this.waterY);
    if (bot <= top) return null;
    return { x: r.x + inset, w: r.w - inset * 2, top, bot };
  }

  /** The bar under a canvas point (above the keyboard), shortest first when bars overlap; while editing the trainer's hand too. */
  noteAt(x: number, y: number): ScoreNote | null {
    const e = this.engine;
    if (!e || y >= this.waterY) return null;
    let best: ScoreNote | null = null;
    let bestH = Infinity;
    for (const n of this.editing ? [...e.activeNotes, ...e.accompaniment] : e.activeNotes) {
      const r = this.barRect(n, e.pos);
      if (!r) continue;
      if (x < r.x - 3 || x > r.x + r.w + 3 || y < r.top - 3 || y > r.bot + 3) continue;
      const h = r.bot - r.top;
      if (h < bestH) {
        best = n;
        bestH = h;
      }
    }
    return best;
  }

  /** A note's bar on screen now, or null when it is not visible. */
  box(n: ScoreNote): BarRect | null {
    return this.engine ? this.barRect(n, this.engine.pos) : null;
  }

  /** Grid step in beats while editing: a sixteenth when there is room for it, coarser when the bars are short. */
  editGrid(): number {
    for (const g of [0.25, 0.5, 1, 2]) if (g * this.ppb >= 12) return g;
    return 4;
  }

  /** Pixels per beat in the last frame drawn. */
  get pxPerBeat(): number {
    return this.ppb;
  }

  /** The beat at a height above the keyboard. */
  beatAt(y: number): number {
    return (this.engine?.pos ?? 0) + (this.waterY - y) / this.ppb;
  }

  /** The key whose lane is under x, black lanes over white ones. */
  laneAt(x: number): number {
    for (let p = this.low; p <= this.high; p++) {
      if (!isBlackKey(p)) continue;
      const k = this.keyRect(p);
      if (x >= k.x && x <= k.x + k.w) return p;
    }
    return this.whites[Math.max(0, Math.min(this.whites.length - 1, Math.floor(x / this.wk)))];
  }

  /** Centre of a note's bar on screen, for anchoring the finger picker. */
  barAnchor(n: ScoreNote): { x: number; y: number } | null {
    const e = this.engine;
    const r = e ? this.barRect(n, e.pos) : null;
    return r ? { x: r.x + r.w / 2, y: Math.max(r.top, Math.min(r.bot, this.waterY - 24)) } : null;
  }

  /** Pitch under a canvas point, or null when the point is above the keyboard. */
  hitTest(x: number, y: number): number | null {
    if (y < this.waterY) return null;
    for (let p = this.low; p <= this.high; p++) {
      if (!isBlackKey(p)) continue;
      const k = this.keyRect(p);
      if (x >= k.x && x <= k.x + k.w && y <= this.waterY + FELT + this.kbH * 0.62) return p;
    }
    for (const p of this.whites) {
      const k = this.keyRect(p);
      if (x >= k.x && x < k.x + k.w) return p;
    }
    return null;
  }

  flash(p: number, kind: FlashKind): void {
    this.flashes.push({ p, kind, t0: performance.now() });
  }

  ripple(p: number, color: string): void {
    if (this.reduceMotion) return;
    if (p < this.low || p > this.high) return;
    const r = this.keyRect(p);
    this.ripples.push({ x: r.x + r.w / 2, color, t0: performance.now() });
  }

  private visibleBeats(): number {
    const e = this.engine!;
    const bpm = bpmAt(this.score!, Math.max(0, e.pos));
    return Math.min(32, Math.max(4, (LOOKAHEAD_SEC * bpm * e.speed) / 60));
  }

  draw(now: number): void {
    const ctx = this.ctx;
    const { w, waterY, pal } = this;
    ctx.clearRect(0, 0, w, this.h);
    this.drawLanes();
    const e = this.engine;
    const score = this.score;
    if (!e || !score) {
      this.drawKeyboard(now, null);
      return;
    }
    const ppb = (waterY - 64) / this.visibleBeats();
    this.ppb = ppb;
    const yOf = (beat: number) => waterY - (beat - e.pos) * ppb;
    const [rs, re] = e.range;
    const yEnd = yOf(re);
    const yStart = yOf(rs);

    // measure lines with the bar number and section
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    for (const m of score.measures) {
      const y = Math.round(yOf(m.t)) + 0.5;
      if (y < -20 || y > waterY) continue;
      ctx.strokeStyle = pal.barline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = pal.barlabel;
      ctx.font = `500 10.5px ${pal.mono}`;
      const num = String(m.number);
      ctx.fillText(num, 8, y - 5);
      if (m.section) {
        ctx.font = `${pal.displayItalic ? 'italic ' : ''}600 14px ${pal.display}`;
        ctx.fillStyle = pal.text2;
        ctx.fillText(m.section, 14 + ctx.measureText(num).width + 8, y - 5);
      }
    }

    if (this.editing) this.drawGrid(yOf);

    // the other hand, played by the trainer: plain bars underneath
    ctx.fillStyle = pal.accBar;
    for (const n of e.accompaniment) {
      const br = this.barRect(n, e.pos);
      if (!br) continue;
      rr(ctx, br.x + 1, br.top, br.w - 2, br.bot - br.top, Math.min(5, br.w / 3));
      ctx.fill();
    }

    // notes
    const target = e.target;
    const targetSet = new Set(target?.notes ?? []);
    const showTarget = e.mode !== 'listen' && !this.editing;
    const both = e.hand === 'both';
    const played = parseFloat(pal.played) || 0.28;
    for (const n of e.activeNotes) {
      const br = this.barRect(n, e.pos);
      if (!br) continue;
      const { x, w: bw, top, bot } = br;
      const h = bot - top;
      const rad = Math.min(6, bw / 2.6, h / 2);
      // while editing every bar is drawn as it is written, not as it was played
      const state = this.editing ? 0 : e.noteState(n);
      const col = state === 2 ? pal.missed : fingerColor(n.finger);
      const outlined = both && n.hand === 'L';
      ctx.globalAlpha = state === 1 ? played : 1;
      if (pal.glow && state === 0) {
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = col;
        rr(ctx, x - 3, top - 3, bw + 6, h + 6, rad + 3);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (outlined) {
        ctx.fillStyle = col;
        ctx.globalAlpha *= 0.26;
        rr(ctx, x, top, bw, h, rad);
        ctx.fill();
        ctx.globalAlpha = state === 1 ? played : 1;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        rr(ctx, x + 1, top + 1, bw - 2, h - 2, Math.max(0, rad - 1));
        ctx.stroke();
      } else {
        ctx.fillStyle = col;
        rr(ctx, x, top, bw, h, rad);
        ctx.fill();
      }
      if (showTarget && targetSet.has(n) && state !== 1) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = pal.ring;
        rr(ctx, x - 2.5, top - 2.5, bw + 5, h + 5, rad + 2);
        ctx.stroke();
      }
      if (n.finger && h > 15 && bw > 11) this.fingerChip(n.finger, x + bw / 2, bot, bw, h, outlined, col);
      if (n.fingerSource === 'user' && h > 12 && bw > 10) {
        // the player's own choice: a small dot in the corner
        ctx.fillStyle = outlined ? col : pal.onBar;
        ctx.beginPath();
        ctx.arc(x + bw - 5, top + 5, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (this.selected) this.drawSelected(this.selected);
    if (this.ghost) this.drawGhost(this.ghost, yOf);

    // outside the practised bars: a wash over everything (not while editing: every bar can be edited); the lead-in before bar 1 has nothing to dim
    ctx.fillStyle = pal.dim;
    if (!this.editing && yEnd > 0) ctx.fillRect(0, 0, w, Math.min(yEnd, waterY));
    if (!this.editing && rs > 1e-6 && yStart < waterY) ctx.fillRect(0, Math.max(yStart, 0), w, waterY - Math.max(yStart, 0));
    // range boundaries
    for (const [y, isEnd] of [[yStart, false], [yEnd, true]] as [number, boolean][]) {
      if (y < 0 || y > waterY) continue;
      if (isEnd && Math.abs(re - score.end) < 1e-6) continue;
      if (!isEnd && rs < 1e-6) continue;
      ctx.strokeStyle = pal.felt;
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // lanes outside the player's controller: shaded
    const pl = this.placement;
    if (pl && (this.low < pl.low || this.high > pl.high)) {
      ctx.fillStyle = pal.outside;
      ctx.globalAlpha = 0.5;
      const loKey = Math.max(this.low, pl.low);
      const hiKey = Math.min(this.high, pl.high);
      const left = this.keyRect(isBlackKey(loKey) ? loKey - 1 : loKey).x;
      const hk = this.keyRect(isBlackKey(hiKey) ? hiKey + 1 : hiKey);
      const right = hk.x + hk.w;
      if (left > 0) ctx.fillRect(0, 0, left, waterY);
      if (right < w) ctx.fillRect(right, 0, w - right, waterY);
      ctx.globalAlpha = 1;
    }

    const near = showTarget && target && target.t - e.pos <= 4 ? target.notes.filter((n) => e.noteState(n) !== 1) : null;
    this.drawKeyboard(now, near);

    // ripples where notes land
    this.ripples = this.ripples.filter((rp) => now - rp.t0 < 600);
    for (const rp of this.ripples) {
      // a ripple made by a key event can start a little after this frame's time
      const k = Math.max(0, (now - rp.t0) / 600);
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = rp.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(rp.x, waterY, 8 + 46 * k, 3 + 9 * k, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const count = e.countInBeat();
    if (count) {
      const k = this.reduceMotion ? 0 : count.frac;
      ctx.globalAlpha = 0.92 * (1 - 0.65 * k);
      ctx.fillStyle = count.beat === 1 ? pal.countAccent : pal.count;
      const size = Math.round(Math.min(150, waterY * 0.42) * (1 + 0.1 * (1 - k)));
      ctx.font = `${pal.displayItalic ? 'italic ' : ''}500 ${size}px ${pal.display}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(count.beat), w / 2, waterY * 0.48);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    if (e.mode === 'learn' && e.target && !e.finished && !this.editing) {
      if (!e.playing) this.pill(t('hud.pressToStart'), w / 2, waterY - 24);
      else if (e.waiting) this.pill(t('hint.waiting'), w / 2, waterY - 24);
    }
  }

  /** While editing: a faint line on every beat, and on every grid step when they are far enough apart. */
  private drawGrid(yOf: (beat: number) => number): void {
    const ctx = this.ctx;
    const { w, waterY, pal } = this;
    const score = this.score!;
    const beat = 4 / score.timeSig[1];
    const grid = this.editGrid();
    const fine = grid < beat ? grid : beat;
    ctx.strokeStyle = pal.barline;
    ctx.lineWidth = 1;
    for (const m of score.measures) {
      const y0 = yOf(m.t);
      if (y0 < 0) break;
      if (yOf(m.t + m.beats) > waterY) continue;
      for (let k = 1; k * fine < m.beats - 1e-6; k++) {
        const b = m.t + k * fine;
        const y = Math.round(yOf(b)) + 0.5;
        if (y < 0 || y > waterY) continue;
        const onBeat = Math.abs(k * fine - Math.round((k * fine) / beat) * beat) < 1e-6;
        ctx.globalAlpha = onBeat ? 0.45 : 0.2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** The note being edited: a dashed outline, and while editing a grip on the top edge to drag its length. */
  private drawSelected(n: ScoreNote): void {
    const br = this.box(n);
    if (!br) return;
    const ctx = this.ctx;
    const { x, w: bw, top, bot } = br;
    const h = bot - top;
    const rad = Math.min(6, bw / 2.6, h / 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.pal.ring;
    ctx.setLineDash([4, 3]);
    rr(ctx, x - 5, top - 5, bw + 10, h + 10, rad + 4);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!this.editing || h <= 14) return;
    // in the ink of the bar's number; an outlined bar is dark inside, so its own colour there
    const outlined = this.engine?.hand === 'both' && n.hand === 'L';
    ctx.strokeStyle = outlined ? fingerColor(n.finger) : this.pal.onBar;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    const gw = Math.min(14, bw - 8) / 2;
    ctx.beginPath();
    for (const dy of [4, 7]) {
      ctx.moveTo(x + bw / 2 - gw, top + dy);
      ctx.lineTo(x + bw / 2 + gw, top + dy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Where a click would put a new note: a dashed outline in its lane. */
  private drawGhost(g: { pitch: number; t: number; dur: number }, yOf: (beat: number) => number): void {
    if (g.pitch < this.low || g.pitch > this.high) return;
    const ctx = this.ctx;
    const r = this.keyRect(g.pitch);
    const inset = r.black ? 1.5 : Math.min(5, Math.max(2, r.w * 0.1));
    const bot = Math.min(yOf(g.t) - 1.5, this.waterY);
    const top = yOf(g.t + g.dur) + 1.5;
    if (bot <= top) return;
    const x = r.x + inset;
    const bw = r.w - inset * 2;
    const rad = Math.min(6, bw / 2.6, (bot - top) / 2);
    ctx.fillStyle = this.pal.ring;
    ctx.globalAlpha = 0.08;
    rr(ctx, x, top, bw, bot - top, rad);
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = this.pal.ring;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    rr(ctx, x + 0.75, top + 0.75, bw - 1.5, bot - top - 1.5, rad);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** Faint lanes under the black keys and a line at every C, like ruled paper. */
  private drawLanes(): void {
    const ctx = this.ctx;
    const { waterY, pal } = this;
    ctx.fillStyle = pal.lane;
    for (let p = this.low; p <= this.high; p++) {
      if (!isBlackKey(p)) continue;
      const r = this.keyRect(p);
      ctx.fillRect(r.x, 0, r.w, waterY);
    }
    ctx.fillStyle = pal.octave;
    for (const p of this.whites) {
      if (p % 12 !== 0 || p === this.low) continue;
      const r = this.keyRect(p);
      ctx.fillRect(Math.round(r.x), 0, 1, waterY);
    }
  }

  /** The finger number in a small chip at the bar's leading edge. */
  private fingerChip(f: number, cx: number, bot: number, bw: number, h: number, outlined: boolean, col: string): void {
    const ctx = this.ctx;
    const pal = this.pal;
    const fs = Math.round(Math.min(15, Math.max(10, bw * 0.4)));
    const r = Math.min(fs * 0.78, bw / 2 - 1.5, h / 2 - 1);
    const cy = bot - r - 3;
    if (outlined) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = pal.onBar;
    ctx.font = `700 ${fs}px ${pal.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(f), cx, cy + 0.5);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }

  /** A short message on a pill just above the keys, e.g. "waiting for your key"; wraps on narrow screens. */
  private pill(text: string, cx: number, bottom: number): void {
    const ctx = this.ctx;
    const pal = this.pal;
    ctx.font = `600 12.5px ${pal.ui}`;
    const max = Math.min(560, this.w - 40);
    const lines: string[] = [];
    for (const word of text.split(' ')) {
      const cur = lines[lines.length - 1];
      if (cur !== undefined && ctx.measureText(`${cur} ${word}`).width <= max) lines[lines.length - 1] = `${cur} ${word}`;
      else lines.push(word);
    }
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const lh = 17;
    const h = lines.length * lh + 8;
    const top = bottom + 12 - h;
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = pal.surface;
    rr(ctx, cx - tw / 2 - 12, top, tw + 24, h, Math.min(12, h / 2));
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, cx, top + 4 + lh * (i + 0.5) + 0.5));
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }

  private drawKeyboard(now: number, targets: ScoreNote[] | null): void {
    const ctx = this.ctx;
    const { waterY, kbH, pal, w } = this;
    const e = this.engine;
    const top = waterY + FELT;
    const keyH = kbH - FELT;
    const both = e?.hand === 'both';
    this.flashes = this.flashes.filter((f) => now - f.t0 < 450);
    /** what lights a key: a flash, a held key, a note the trainer plays */
    const lit = (p: number): string | null => {
      const fl = this.flashes.find((f) => f.p === p);
      if (fl) return fl.kind === 'ok' ? pal.ok : fl.kind === 'bad' ? pal.bad : pal.early;
      const src = e?.keys.get(p);
      if (src === 'acc') return isBlackKey(p) ? pal.accKeyBlack : pal.accKeyWhite;
      if (src === 'auto') return fingerColor(e?.keyNote.get(p)?.finger);
      if (src) return pal.press;
      return null;
    };
    const targetFor = (p: number) => targets?.find((n) => n.pitch === p);

    // the case behind the keys, and the felt strip the bars land on
    ctx.fillStyle = pal.case;
    ctx.fillRect(0, waterY, w, kbH);
    ctx.fillStyle = pal.felt;
    ctx.fillRect(0, waterY, w, FELT);

    const labelSize = Math.max(9, Math.min(12, this.wk * 0.28));
    const showLabels = this.wk >= 17;
    for (const p of this.whites) {
      const r = this.keyRect(p);
      const x = r.x + 0.5;
      const kw = r.w - 1;
      ctx.fillStyle = this.whiteFill;
      rrBottom(ctx, x, top, kw, keyH - 1, 4);
      ctx.fill();
      const on = lit(p);
      if (on) {
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = on;
        rrBottom(ctx, x, top, kw, keyH - 1, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // shadow under the felt
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(x, top, kw, 3);
      const tn = targetFor(p);
      if (tn) this.keyTarget(tn, x + 3, top + keyH * 0.5, kw - 6, keyH * 0.5 - 7, both && tn.hand === 'L', Math.min(20, r.w * 0.45), false);
      if (showLabels || p % 12 === 0) {
        // the keys are ivory in every look, so the labels take the dark ink of the bars' numbers
        ctx.fillStyle = p % 12 === 0 ? pal.onBar : pal.keyLabel;
        ctx.font = `${p % 12 === 0 ? 600 : 500} ${labelSize}px ${pal.ui}`;
        ctx.textAlign = 'center';
        const label = keyLabel(p, this.nameStyle);
        // long names (соль) are left out where they would touch the next key; C always has its name
        if (!tn && (p % 12 === 0 || ctx.measureText(label).width <= r.w - 5)) ctx.fillText(label, r.x + r.w / 2, top + keyH - 10);
        ctx.textAlign = 'left';
      }
      if (this.outsideController(p)) {
        ctx.fillStyle = pal.outside;
        rrBottom(ctx, x, top, kw, keyH - 1, 4);
        ctx.fill();
      }
    }
    for (let p = this.low; p <= this.high; p++) {
      if (!isBlackKey(p)) continue;
      const r = this.keyRect(p);
      const bh = keyH * 0.62;
      // a soft shadow on the white keys
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      rrBottom(ctx, r.x + 1, top, r.w + 2, bh + 3, 3);
      ctx.fill();
      ctx.fillStyle = this.blackFill;
      rrBottom(ctx, r.x, top, r.w, bh, 3);
      ctx.fill();
      // the front lip catches the light
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(r.x + 1.5, top + bh - 6, r.w - 3, 3);
      const on = lit(p);
      if (on) {
        ctx.fillStyle = on;
        ctx.globalAlpha = 0.9;
        rrBottom(ctx, r.x + 1, top, r.w - 2, bh - 1, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      const tn = targetFor(p);
      if (tn) this.keyTarget(tn, r.x + 2, top + bh * 0.42, r.w - 4, bh * 0.58 - 5, both && tn.hand === 'L', Math.min(16, r.w * 0.55), true);
      if (this.outsideController(p)) {
        ctx.fillStyle = pal.outside;
        rrBottom(ctx, r.x, top, r.w, bh, 3);
        ctx.fill();
      }
    }
    if (this.letters !== null) this.drawLetters(top, keyH);
  }

  /** The key to press next: a pad in the finger's colour with its number. */
  private keyTarget(n: ScoreNote, x: number, y: number, w: number, h: number, outlined: boolean, fs: number, onBlack: boolean): void {
    const ctx = this.ctx;
    const col = fingerColor(n.finger);
    ctx.fillStyle = col;
    rr(ctx, x, y, w, h, Math.min(6, w / 3));
    if (outlined) {
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else ctx.fill();
    if (n.finger) {
      // an outlined pad on a black key is dark inside: the number takes the finger's colour there
      ctx.fillStyle = outlined && onBlack ? col : this.pal.onBar;
      ctx.font = `700 ${Math.max(10, Math.round(fs))}px ${this.pal.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n.finger), x + w / 2, y + h / 2 + 0.5);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
    }
  }

  /** Which computer key plays each piano key, for playing without a MIDI keyboard. */
  private drawLetters(top: number, keyH: number): void {
    const ctx = this.ctx;
    const pal = this.pal;
    const base = this.letters!;
    const fs = Math.max(9, Math.min(11, this.wk * 0.26));
    ctx.font = `700 ${fs}px ${pal.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let p = this.low; p <= this.high; p++) {
      const letter = letterFor(p, base);
      if (!letter) continue;
      const r = this.keyRect(p);
      const black = r.black;
      const cy = black ? top + keyH * 0.62 - 14 : top + 16;
      const s = fs + 7;
      ctx.globalAlpha = black ? 0.9 : 0.75;
      ctx.strokeStyle = black ? 'rgba(255,255,255,0.45)' : pal.keyLabel;
      ctx.lineWidth = 1;
      rr(ctx, r.x + r.w / 2 - s / 2 + 0.5, cy - s / 2 + 0.5, s - 1, s - 1, 3);
      ctx.stroke();
      ctx.fillStyle = black ? 'rgba(255,255,255,0.85)' : pal.onBar;
      ctx.fillText(letter, r.x + r.w / 2, cy + 0.5);
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A key: square at the top where it meets the felt, rounded at the front. */
function rrBottom(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.closePath();
}
