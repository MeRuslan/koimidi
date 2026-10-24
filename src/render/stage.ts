/**
 * Canvas renderer: the night pool. Bars fall towards the water line where the
 * keyboard sits; colour = finger, number on the leading edge.
 */
import { keyLabel, t, type NameStyle } from '../i18n';
import { bpmAt, isBlackKey, type Score, type ScoreNote } from '../score/model';
import type { Engine, FlashKind } from '../practice/engine';

export const FINGER_COLORS = ['', '#ff8a6b', '#ffcf5a', '#48d6c6', '#8ea8ff', '#e590ff'];
const NO_FINGER = '#9fb4c4';
const LOOKAHEAD_SEC = 5;
const UI_FONT = '"Golos Text", system-ui, sans-serif';
const DISPLAY_FONT = '"Unbounded", "Golos Text", system-ui, sans-serif';

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
  private flashes: Flash[] = [];
  private ripples: Ripple[] = [];
  private engine: Engine | null = null;
  private score: Score | null = null;
  private bodyFont = UI_FONT;

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

  /** Keyboard range: the practised notes plus some margin, at least two octaves. */
  fitRange(): void {
    if (!this.engine) return;
    const pitches = this.engine.activeNotes.map((n) => n.pitch);
    let lo = pitches.length ? Math.min(...pitches) - 2 : 55;
    let hi = pitches.length ? Math.max(...pitches) + 2 : 79;
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
    this.kbH = Math.max(84, Math.min(180, r.height * 0.26));
    this.waterY = r.height - this.kbH;
    this.whites = [];
    for (let p = this.low; p <= this.high; p++) if (!isBlackKey(p)) this.whites.push(p);
    this.wk = r.width / this.whites.length;
  }

  keyRect(p: number): KeyRect {
    if (!isBlackKey(p)) {
      const i = this.whites.indexOf(p);
      return { x: i * this.wk, w: this.wk, black: false };
    }
    const i = this.whites.indexOf(p - 1);
    const bw = this.wk * 0.6;
    return { x: (i + 1) * this.wk - bw / 2, w: bw, black: true };
  }

  /** Pitch under a canvas point, or null when the point is above the keyboard. */
  hitTest(x: number, y: number): number | null {
    if (y < this.waterY) return null;
    for (let p = this.low; p <= this.high; p++) {
      if (!isBlackKey(p)) continue;
      const k = this.keyRect(p);
      if (x >= k.x && x <= k.x + k.w && y <= this.waterY + this.kbH * 0.6) return p;
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
    const { w, h, waterY, kbH } = this;
    ctx.clearRect(0, 0, w, h);
    const e = this.engine;
    const score = this.score;
    const g = ctx.createLinearGradient(0, 0, 0, waterY);
    g.addColorStop(0, '#04111d');
    g.addColorStop(1, '#0a2a40');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, waterY);
    this.whites.forEach((p, i) => {
      if (i % 2 === 0) {
        const r = this.keyRect(p);
        ctx.fillStyle = 'rgba(95, 212, 232, 0.035)';
        ctx.fillRect(r.x, 0, r.w, waterY);
      }
    });
    if (!e || !score) {
      this.drawKeyboard(now, null, false);
      return;
    }
    const ppb = (waterY - 70) / this.visibleBeats();
    const yOf = (beat: number) => waterY - (beat - e.pos) * ppb;

    // outside the loop range: dim
    const [rs, re] = e.range;
    const yEnd = yOf(re);
    const yStart = yOf(rs);
    ctx.fillStyle = 'rgba(2, 8, 14, 0.45)';
    if (yEnd > 0) ctx.fillRect(0, 0, w, Math.min(yEnd, waterY));
    if (yStart < waterY && yStart > 0) ctx.fillRect(0, Math.max(yStart, 0), w, waterY - Math.max(yStart, 0));

    // measure lines and labels
    ctx.font = `500 12px ${this.bodyFont}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const last = score.measures.length;
    for (const m of score.measures) {
      const y = yOf(m.t);
      if (y < -20 || y > waterY) continue;
      ctx.strokeStyle = 'rgba(143, 166, 184, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(143, 166, 184, 0.75)';
      const label = `${t('hud.measure', { m: m.number, n: last }).split(' ').slice(0, 2).join(' ')}${m.section ? '  · ' + m.section : ''}`;
      ctx.fillText(label, 8, y - 5);
    }
    // range boundaries
    for (const [y, isEnd] of [[yStart, false], [yEnd, true]] as [number, boolean][]) {
      if (y < 0 || y > waterY) continue;
      if (isEnd && Math.abs(re - score.end) < 1e-6) continue;
      if (!isEnd && rs < 1e-6) continue;
      ctx.strokeStyle = 'rgba(95, 212, 232, 0.55)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // notes
    const target = e.target;
    const targetSet = new Set(target?.notes ?? []);
    const showTarget = e.mode !== 'listen';
    const notes = e.activeNotes;
    const both = e.hand === 'both';
    for (const n of notes) {
      const yb = yOf(n.t);
      const yt = yb - n.dur * ppb;
      if (yb < -10 || yt > waterY) continue;
      const r = this.keyRect(n.pitch);
      if (r.x < -r.w || r.x > w) continue;
      const inset = r.black ? 2 : 4;
      const x = r.x + inset;
      const bw = r.w - inset * 2;
      const top = Math.max(yt + 2, -10);
      const bot = Math.min(yb - 2, waterY);
      if (bot <= top) continue;
      const state = e.noteState(n);
      let col = n.finger ? FINGER_COLORS[n.finger] : NO_FINGER;
      let alpha = 1;
      if (state === 1) alpha = 0.35;
      if (state === 2) {
        col = '#5b6b78';
        alpha = 0.6;
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col;
      rr(ctx, x, top, bw, bot - top, 6);
      ctx.fill();
      if (both && n.hand === 'L') {
        ctx.fillStyle = 'rgba(7, 26, 43, 0.45)';
        ctx.fill();
      }
      if (showTarget && targetSet.has(n) && state !== 1) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      if (n.finger && bot - top > 16 && bw > 12) {
        ctx.fillStyle = 'rgba(4, 17, 29, 0.85)';
        const fs = Math.min(18, Math.max(11, bw * 0.45));
        ctx.font = `700 ${fs}px ${DISPLAY_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(n.finger), x + bw / 2, bot - 6);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
    }

    // water line + ripples
    ctx.fillStyle = 'rgba(95, 212, 232, 0.9)';
    ctx.fillRect(0, waterY - 2, w, 3);
    this.ripples = this.ripples.filter((rp) => now - rp.t0 < 700);
    for (const rp of this.ripples) {
      const k = (now - rp.t0) / 700;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = rp.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(rp.x, waterY, 10 + 60 * k, 4 + 14 * k, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const near = showTarget && target && target.t - e.pos <= 4 ? target.notes.filter((n) => e.noteState(n) !== 1) : null;
    this.drawKeyboard(now, near, showTarget);

    if (e.waiting && e.mode === 'learn' && e.playing) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = `600 14px ${this.bodyFont}`;
      ctx.textAlign = 'center';
      ctx.fillText(t('hint.waiting'), w / 2, waterY - 12);
      ctx.textAlign = 'left';
    }
    void h;
    void kbH;
  }

  private drawKeyboard(now: number, targets: ScoreNote[] | null, _showTarget: boolean): void {
    const ctx = this.ctx;
    const { waterY, kbH } = this;
    const e = this.engine;
    this.flashes = this.flashes.filter((f) => now - f.t0 < 450);
    const keyFill = (p: number, base: string) => {
      const fl = this.flashes.find((f) => f.p === p);
      if (fl) return fl.kind === 'ok' ? '#57e39b' : fl.kind === 'bad' ? '#ff5d6c' : '#5fd4e8';
      if (e?.keys.has(p)) return '#5fd4e8';
      return base;
    };
    const targetFor = (p: number) => targets?.find((n) => n.pitch === p);
    const labelSize = Math.min(13, this.wk * 0.3);
    const showLabels = this.wk >= 16;
    for (const p of this.whites) {
      const r = this.keyRect(p);
      ctx.fillStyle = keyFill(p, '#eef3f6');
      rr(ctx, r.x + 1, waterY + 2, r.w - 2, kbH - 4, 5);
      ctx.fill();
      const tn = targetFor(p);
      if (tn) {
        ctx.fillStyle = tn.finger ? FINGER_COLORS[tn.finger] : NO_FINGER;
        ctx.globalAlpha = 0.85;
        rr(ctx, r.x + 3, waterY + kbH * 0.45, r.w - 6, kbH * 0.5, 5);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (showLabels || p % 12 === 0) {
        ctx.fillStyle = '#3b5263';
        ctx.font = `500 ${labelSize}px ${this.bodyFont}`;
        ctx.textAlign = 'center';
        ctx.fillText(keyLabel(p, this.nameStyle), r.x + r.w / 2, waterY + kbH - 9);
      }
      if (tn?.finger) {
        ctx.fillStyle = '#04111d';
        ctx.font = `700 ${Math.min(22, r.w * 0.5)}px ${DISPLAY_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(tn.finger), r.x + r.w / 2, waterY + kbH * 0.72);
      }
      ctx.textAlign = 'left';
    }
    for (let p = this.low; p <= this.high; p++) {
      if (!isBlackKey(p)) continue;
      const r = this.keyRect(p);
      const bh = kbH * 0.6;
      ctx.fillStyle = keyFill(p, '#14222d');
      rr(ctx, r.x, waterY + 2, r.w, bh, 4);
      ctx.fill();
      const tn = targetFor(p);
      if (tn) {
        ctx.fillStyle = tn.finger ? FINGER_COLORS[tn.finger] : NO_FINGER;
        rr(ctx, r.x + 2, waterY + bh * 0.35, r.w - 4, bh * 0.6, 4);
        ctx.fill();
        if (tn.finger) {
          ctx.fillStyle = '#04111d';
          ctx.font = `700 ${Math.min(18, r.w * 0.55)}px ${DISPLAY_FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText(String(tn.finger), r.x + r.w / 2, waterY + bh * 0.8);
          ctx.textAlign = 'left';
        }
      }
    }
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
