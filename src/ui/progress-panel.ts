/**
 * Progress popover: practice time, mistakes per bar as a heat strip (click a
 * bar to loop it), the hardest bars, and the passes over the current bar range
 * as a small trend (right notes, and the rhythm once passes have it) with the
 * latest ones listed below.
 */
import { getLang, t, type Key } from '../i18n';
import type { Engine } from '../practice/engine';
import type { BarTally } from '../practice/engine';
import { accuracy, rhythm, samePasses, weakestBars, type PassRecord, type PieceProgress } from '../practice/progress';
import type { Score } from '../score/model';
import { $, el } from './dom';

const SVG = 'http://www.w3.org/2000/svg';
/** Error-rate buckets for the heat strip: upper bound of the share of mistakes in each step. */
const STEPS = [0, 0.05, 0.15, 0.3, 1];
const TREND_MAX = 20;

/** Heat step of a bar, 0 (few mistakes) to 4 (many), or -1 when it was not played. */
export function heatStep(b: BarTally | undefined): number {
  const acc = b ? accuracy(b) : null;
  return acc === null ? -1 : STEPS.findIndex((s) => 1 - acc <= s + 1e-9);
}

export function percent(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** "<1 min", "12 min", "1 h 05 min". */
export function practiceTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 1) return t('time.lessMin');
  if (m < 60) return t('time.min', { m });
  return t('time.hmin', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') });
}

function when(at: number): string {
  return new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(at);
}

/** A pass in the list: the tempo (in learn mode your own, once timed), right notes, the rhythm. */
function passLine(r: PassRecord): string {
  const at = { date: when(r.at), speed: percent(r.speed), acc: percent(accuracy(r) ?? 0) };
  const beat = rhythm(r);
  if (beat === null) return t('progress.pass', at);
  if (r.pace !== undefined) return t('progress.passPace', { ...at, pace: percent(r.pace), rhythm: percent(beat) });
  return t('progress.passRhythm', { ...at, rhythm: percent(beat) });
}

export class ProgressPanel {
  private root = $('progress');

  constructor(
    private loopBar: (m: number) => void,
    private reset: () => void,
  ) {}

  get open(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
    $('progressBtn').setAttribute('aria-expanded', 'false');
  }

  show(p: PieceProgress | null, e: Engine, score: Score): void {
    this.render(p, e, score);
    this.root.hidden = false;
    $('progressBtn').setAttribute('aria-expanded', 'true');
  }

  render(p: PieceProgress | null, e: Engine, score: Score): void {
    const close = el('button', { type: 'button', class: 'btn icon ghost', title: t('close'), 'aria-label': t('close') });
    close.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-close"/></svg>';
    close.addEventListener('click', () => this.close());
    const body = el('div', { class: 'sheet-body' });
    this.root.replaceChildren(el('header', { class: 'sheet-head' }, [el('h2', { text: t('progress') }), close]), body);
    const group = (title: string) => {
      const g = el('section', { class: 'group' }, [el('h3', { text: title })]);
      body.append(g);
      return g;
    };
    if (!p || (!p.passes.length && !Object.keys(p.bars).length)) {
      body.append(el('p', { class: 'prog-empty', text: t('progress.none') }));
      return;
    }
    const time = practiceTime(p.seconds);
    const total = el('p', { class: 'prog-total' }, [el('b', { text: time }), t('progress.totalSub', { n: p.passes.length })]);
    group(t('progress')).append(total);

    // mistakes per bar
    const bars = group(t('progress.bars'));
    const readout = el('p', { class: 'prog-readout', 'aria-live': 'polite' });
    const strip = el('div', { class: 'heat-grid', role: 'group', 'aria-label': t('progress.bars') });
    const [from, to] = e.rangeMeasures;
    for (const m of score.measures) {
      const b = p.bars[m.number];
      const acc = b ? accuracy(b) : null;
      const beat = b ? rhythm(b) : null;
      const n = b ? b.hits + b.wrong + b.misses : 0;
      const step = heatStep(b);
      const cell = el('button', { type: 'button', class: `cell s${step}`, text: String(m.number) });
      if (m.number >= from && m.number <= to) cell.classList.add('in');
      const label =
        acc === null
          ? t('progress.barNone', { m: m.number })
          : beat === null
            ? t('progress.bar', { m: m.number, acc: percent(acc), n })
            : t('progress.barRhythm', { m: m.number, acc: percent(acc), rhythm: percent(beat), n });
      cell.setAttribute('aria-label', label);
      const say = () => (readout.textContent = label);
      cell.addEventListener('pointerenter', say);
      cell.addEventListener('focus', say);
      cell.addEventListener('click', () => this.loopBar(m.number));
      strip.append(cell);
    }
    strip.addEventListener('pointerleave', () => (readout.textContent = ''));
    const legend = el('div', { class: 'heat-legend', 'aria-hidden': 'true' }, [
      el('span', { text: t('progress.legendFew') }),
      ...STEPS.map((_, i) => el('i', { class: `cell s${i}` })),
      el('span', { text: t('progress.legendMore') }),
      el('i', { class: 'cell s-1' }),
      el('span', { text: t('progress.legendNone') }),
    ]);
    bars.append(strip, legend, readout);

    const hardest = weakestBars(p);
    if (hardest.length) {
      const chips = el('div', { class: 'chips' });
      for (const m of hardest) {
        const c = el('button', { type: 'button', class: 'chip', text: String(m), title: t('progress.barShort', { m, acc: percent(accuracy(p.bars[m])!) }) });
        c.addEventListener('click', () => this.loopBar(m));
        chips.append(c);
      }
      bars.append(el('div', { class: 'prog-hard' }, [el('span', { class: 'label', text: t('progress.hardest') }), chips]));
    }

    // passes over the current range
    const hand = t(`hand.${e.hand}` as Key).toLowerCase();
    const range = group(t('progress.range', { from, to, mode: t(`mode.${e.mode}` as Key).toLowerCase(), hand }));
    const passes = samePasses(p, from, to, e.mode, e.hand);
    if (!passes.length) {
      range.append(el('p', { class: 'prog-empty', text: t(e.mode === 'listen' ? 'progress.listen' : 'progress.noPasses') }));
    } else {
      const recent = passes.slice(-TREND_MAX);
      const offset = passes.length - recent.length;
      const trendReadout = el('p', { class: 'prog-readout', 'aria-live': 'polite' });
      const timed = recent.some((r) => rhythm(r) !== null);
      range.append(el('p', { class: 'fine', text: t(timed ? 'progress.trendRhythm' : 'progress.trend') }));
      if (timed)
        range.append(
          el('div', { class: 'trend-legend', 'aria-hidden': 'true' }, [
            el('span', {}, [el('i', { class: 'sw notes' }), t('progress.trendNotes')]),
            el('span', {}, [el('i', { class: 'sw beat' }), t('progress.trendBeat')]),
          ]),
        );
      range.append(this.trend(recent, offset, trendReadout), trendReadout);
      const list = el('ol', { class: 'prog-list', start: String(passes.length), reversed: true });
      for (const r of passes.slice(-5).reverse()) list.append(el('li', { text: passLine(r) }));
      range.append(list);
    }

    const resetBtn = el('button', { type: 'button', class: 'ghost small', text: t('progress.reset') });
    resetBtn.addEventListener('click', () => {
      if (confirm(t('progress.resetConfirm'))) this.reset();
    });
    body.append(el('section', { class: 'group' }, [el('div', { class: 'row actions' }, [resetBtn])]));
  }

  /**
   * Accuracy per pass, 0–100 %, as a 2px line, and the rhythm as a dashed one
   * where passes have it, each with its last value at its end; hovering a pass
   * shows it in the readout below.
   */
  private trend(recent: PassRecord[], offset: number, readout: HTMLElement): SVGSVGElement {
    const W = 300;
    const H = 64;
    const timed = recent.some((r) => rhythm(r) !== null);
    const pad = { l: 38, r: timed ? 36 : 8, t: 6, b: 6 };
    const x = (i: number) => (recent.length === 1 ? (pad.l + W - pad.r) / 2 : pad.l + (i * (W - pad.l - pad.r)) / (recent.length - 1));
    const y = (a: number) => pad.t + (1 - a) * (H - pad.t - pad.b);
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'trend');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('progress.trend'));
    const add = (tag: string, attrs: Record<string, string | number>) => {
      const node = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      svg.append(node);
      return node;
    };
    for (const a of [1, 0.5, 0]) {
      add('line', { x1: pad.l, x2: W - pad.r, y1: y(a), y2: y(a), class: 'grid' });
      add('text', { x: pad.l - 6, y: y(a) + 3.5, class: 'tick', 'text-anchor': 'end' }).textContent = percent(a);
    }
    const pts = recent.map((r, i) => [x(i), y(accuracy(r) ?? 0)] as const);
    if (pts.length > 1) add('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'line' });
    // the rhythm: runs of passes that have it (older passes do not)
    const beats = recent.map((r, i) => {
      const v = rhythm(r);
      return v === null ? null : ([x(i), y(v)] as const);
    });
    let run: (readonly [number, number])[] = [];
    for (const p of [...beats, null]) {
      if (p) run.push(p);
      else {
        if (run.length > 1) add('polyline', { points: run.map((q) => q.join(',')).join(' '), class: 'line beat' });
        else if (run.length === 1) add('circle', { cx: run[0][0], cy: run[0][1], r: 2, class: 'dot beat' });
        run = [];
      }
    }
    const last = pts[pts.length - 1];
    const lastBeat = beats[beats.length - 1];
    if (lastBeat) add('circle', { cx: lastBeat[0], cy: lastBeat[1], r: 3, class: 'end beat' });
    add('circle', { cx: last[0], cy: last[1], r: 3, class: timed ? 'end notes' : 'end' });
    if (timed) {
      // the last values at the line ends, kept apart when they are close
      const labels = [{ y: last[1], v: accuracy(recent[recent.length - 1]) ?? 0 }];
      if (lastBeat) labels.push({ y: lastBeat[1], v: rhythm(recent[recent.length - 1])! });
      if (labels.length === 2 && Math.abs(labels[0].y - labels[1].y) < 11) {
        const [hi, lo] = labels[0].y <= labels[1].y ? labels : [labels[1], labels[0]];
        const mid = (hi.y + lo.y) / 2;
        hi.y = Math.max(pad.t + 4, mid - 5.5);
        lo.y = hi.y + 11;
      }
      for (const l of labels) add('text', { x: W - pad.r + 7, y: l.y + 3.5, class: 'tick value' }).textContent = percent(l.v);
    }
    const marker = add('circle', { cx: 0, cy: 0, r: 4.5, class: timed ? 'marker notes' : 'marker' });
    marker.setAttribute('visibility', 'hidden');
    const markerBeat = add('circle', { cx: 0, cy: 0, r: 4.5, class: 'marker beat' });
    markerBeat.setAttribute('visibility', 'hidden');
    // hit targets: full-height columns, wider than the marks
    const colW = recent.length > 1 ? (W - pad.l - pad.r) / (recent.length - 1) : W - pad.l - pad.r;
    recent.forEach((r, i) => {
      const hit = add('rect', { x: x(i) - colW / 2, y: 0, width: colW, height: H, class: 'hit' });
      hit.addEventListener('pointerenter', () => {
        marker.setAttribute('cx', String(pts[i][0]));
        marker.setAttribute('cy', String(pts[i][1]));
        marker.setAttribute('visibility', 'visible');
        const b = beats[i];
        if (b) {
          markerBeat.setAttribute('cx', String(b[0]));
          markerBeat.setAttribute('cy', String(b[1]));
        }
        markerBeat.setAttribute('visibility', b ? 'visible' : 'hidden');
        const v = rhythm(r);
        const at = { n: offset + i + 1, date: when(r.at), acc: percent(accuracy(r) ?? 0), speed: percent(r.speed) };
        readout.textContent = v === null ? t('progress.point', at) : t('progress.pointRhythm', { ...at, rhythm: percent(v) });
      });
    });
    svg.addEventListener('pointerleave', () => {
      marker.setAttribute('visibility', 'hidden');
      markerBeat.setAttribute('visibility', 'hidden');
      readout.textContent = '';
    });
    return svg;
  }
}
