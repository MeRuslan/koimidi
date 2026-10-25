/**
 * The strip of bars above the stage: every bar of the piece, as wide as it is
 * long, with the sections over it. Click a bar, or drag across several, to
 * practise just those; click a section's name to take the whole section. A
 * line marks where the music is, a bracket the practised bars, and a thin
 * stripe under each bar how many mistakes were made there.
 */
import { t } from '../i18n';
import type { PieceProgress } from '../practice/progress';
import type { Score } from '../score/model';
import { el } from './dom';
import { heatStep } from './progress-panel';

/** label every k-th bar so that numbers stay at least this far apart */
const MIN_LABEL_PX = 24;
const LABEL_STEPS = [1, 2, 4, 5, 10, 20, 25, 50, 100];
/** height of the band with the section names over the bars */
const SECTION_BAND = 16;

interface Cell {
  m: number;
  node: HTMLElement;
  heat: HTMLElement;
  left: number;
  width: number;
}

export class Timeline {
  private cells: Cell[] = [];
  private score: Score | null = null;
  private head = el('div', { class: 'tl-head' });
  private bracket = el('div', { class: 'tl-range' });
  private range: [number, number] = [1, 1];
  private drag: { anchor: number; pointer: number } | null = null;
  private lastX = -1;
  private curBar = 0;

  constructor(
    private root: HTMLElement,
    private onSelect: (from: number, to: number) => void,
  ) {
    new ResizeObserver(() => this.layout()).observe(root);
    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', () => this.cancel());
  }

  build(score: Score): void {
    this.score = score;
    this.cells = [];
    this.curBar = 0;
    this.lastX = -1;
    const nodes: HTMLElement[] = [];
    const last = score.measures.length ? score.measures[score.measures.length - 1].number : 1;
    for (const m of score.measures) {
      const heat = el('span', { class: 'heat' });
      const node = el('span', { class: 'tl-bar' }, [el('i'), heat]);
      node.style.flexGrow = String(Math.max(0.25, m.beats));
      if (m.section) node.dataset.sec = m.section;
      node.title = t('hud.bar', { m: m.number, n: last }) + (m.section ? ` · ${m.section}` : '');
      this.cells.push({ m: m.number, node, heat, left: 0, width: 0 });
      nodes.push(node);
    }
    this.root.replaceChildren(...nodes, this.bracket, this.head);
    this.layout();
  }

  /** Practised bars, and whether they loop. */
  setRange(from: number, to: number, loop: boolean): void {
    this.range = [from, to];
    for (const c of this.cells) {
      const inside = c.m >= from && c.m <= to;
      c.node.classList.toggle('in', inside);
      c.node.classList.toggle('out', !inside);
    }
    this.bracket.classList.toggle('off', !loop);
    this.placeBracket();
  }

  /** Mistakes per bar from the progress so far. */
  setHeat(p: PieceProgress | null): void {
    for (const c of this.cells) {
      const step = heatStep(p?.bars[c.m]);
      c.heat.className = step < 0 ? 'heat' : `heat s${step}`;
    }
  }

  /** Move the playhead to a position in beats. */
  update(pos: number): void {
    const score = this.score;
    if (!score || !this.cells.length) return;
    const ms = score.measures;
    let i = 0;
    while (i < ms.length - 1 && ms[i + 1].t <= pos + 1e-6) i++;
    const m = ms[i];
    const c = this.cells[i];
    const frac = Math.max(0, Math.min(1, (pos - m.t) / Math.max(1e-6, m.beats)));
    const x = pos < 0 ? c.left : c.left + frac * c.width;
    if (Math.abs(x - this.lastX) >= 0.5) {
      this.head.style.transform = `translateX(${x.toFixed(1)}px)`;
      this.lastX = x;
    }
    if (this.curBar !== m.number) {
      this.cells.find((q) => q.m === this.curBar)?.node.classList.remove('cur');
      c.node.classList.add('cur');
      this.curBar = m.number;
    }
  }

  /** Cell positions and which bar numbers fit, after a resize. */
  layout(): void {
    if (!this.cells.length) return;
    for (const c of this.cells) {
      c.left = c.node.offsetLeft;
      c.width = c.node.offsetWidth;
    }
    const avg = this.root.clientWidth / this.cells.length;
    const step = LABEL_STEPS.find((k) => avg * k >= MIN_LABEL_PX) ?? 200;
    for (const c of this.cells) {
      const show = c.width >= 14 && ((c.m - 1) % step === 0 || c.m === this.cells.length);
      c.node.firstElementChild!.textContent = show ? String(c.m) : '';
    }
    // section names that would run into the next one are cut short
    const secs = this.cells.filter((c) => c.node.dataset.sec);
    secs.forEach((c, i) => {
      const room = (secs[i + 1]?.left ?? this.root.clientWidth) - c.left - 4;
      c.node.style.setProperty('--sec-room', `${Math.max(0, room)}px`);
      c.node.classList.toggle('sec-tight', room < 18);
    });
    this.lastX = -1;
    this.placeBracket();
  }

  private placeBracket(): void {
    const a = this.cells.find((c) => c.m === this.range[0]);
    const b = this.cells.find((c) => c.m === this.range[1]);
    if (!a || !b) return;
    this.bracket.style.left = `${a.left}px`;
    this.bracket.style.width = `${b.left + b.width - a.left}px`;
  }

  /* ---------- picking bars with the pointer ---------- */

  private barAt(clientX: number): number {
    const r = this.root.getBoundingClientRect();
    const x = clientX - r.left;
    let best = this.cells[0];
    for (const c of this.cells) if (x >= c.left - 1) best = c;
    return best.m;
  }

  /** Bars of the section that holds bar m. */
  private sectionOf(m: number): [number, number] | null {
    const score = this.score!;
    const secs = score.measures.filter((q) => q.section);
    if (!secs.length) return null;
    let i = -1;
    secs.forEach((q, k) => q.number <= m && (i = k));
    if (i < 0) return null;
    const last = score.measures[score.measures.length - 1].number;
    return [secs[i].number, secs[i + 1] ? secs[i + 1].number - 1 : last];
  }

  private down(e: PointerEvent): void {
    if (!this.cells.length || e.button > 0) return;
    const r = this.root.getBoundingClientRect();
    const m = this.barAt(e.clientX);
    if (e.clientY - r.top < SECTION_BAND) {
      const sec = this.sectionOf(m);
      if (sec) {
        this.onSelect(sec[0], sec[1]);
        return;
      }
    }
    e.preventDefault();
    this.root.setPointerCapture(e.pointerId);
    const anchor = e.shiftKey ? this.range[0] : m;
    this.drag = { anchor, pointer: m };
    this.preview();
  }

  private move(e: PointerEvent): void {
    if (!this.drag) return;
    const m = this.barAt(e.clientX);
    if (m === this.drag.pointer) return;
    this.drag.pointer = m;
    this.preview();
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
    this.clearPreview();
    this.onSelect(Math.min(d.anchor, d.pointer), Math.max(d.anchor, d.pointer));
  }

  private cancel(): void {
    this.drag = null;
    this.clearPreview();
  }

  private preview(): void {
    const d = this.drag!;
    const lo = Math.min(d.anchor, d.pointer);
    const hi = Math.max(d.anchor, d.pointer);
    for (const c of this.cells) c.node.classList.toggle('pick', c.m >= lo && c.m <= hi);
  }

  private clearPreview(): void {
    for (const c of this.cells) c.node.classList.remove('pick');
  }
}
