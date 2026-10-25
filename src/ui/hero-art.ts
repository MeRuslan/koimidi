/**
 * The picture on the home screen: the first line of Ode to Joy falling onto
 * ten white keys, with its fingering, and each key lighting up in its finger's
 * colour as its note lands. An SVG drawn in the current look's colours and
 * moved by the Web Animations API; still when the system asks for less motion.
 */
import { t } from '../i18n';

const NS = 'http://www.w3.org/2000/svg';
const W = 400;
const H = 408;
const FELT_Y = 286;
const FELT = 4;
const KW = 40;
const PPB = 46;
const BEATS = 16;
const BPM = 96;
/** C4 … E5 */
const WHITES = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76];
const BLACKS = [61, 63, 66, 68, 70, 73, 75];
/** beat, pitch, length, finger */
const TUNE: [number, number, number, number][] = [
  [0, 64, 1, 3], [1, 64, 1, 3], [2, 65, 1, 4], [3, 67, 1, 5],
  [4, 67, 1, 5], [5, 65, 1, 4], [6, 64, 1, 3], [7, 62, 1, 2],
  [8, 60, 1, 1], [9, 60, 1, 1], [10, 62, 1, 2], [11, 64, 1, 3],
  [12, 64, 1.5, 3], [13.5, 62, 0.5, 2], [14, 62, 2, 2],
];

function node<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  parent.append(n);
  return n;
}

function keyX(p: number): { x: number; w: number } {
  const i = WHITES.indexOf(p);
  if (i >= 0) return { x: i * KW, w: KW };
  const left = WHITES.indexOf(p - 1);
  const bw = KW * 0.58;
  return { x: (left + 1) * KW - bw / 2, w: bw };
}

export function heroArt(root: HTMLElement): { stop(): void } {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMax slice');
  svg.setAttribute('class', 'ha');
  const clip = node(node(svg, 'defs'), 'clipPath', { id: 'ha-roll' });
  node(clip, 'rect', { x: 0, y: 0, width: W, height: FELT_Y });

  // lanes under the black keys and a line at the second C
  for (const p of BLACKS) {
    const k = keyX(p);
    node(svg, 'rect', { x: k.x, y: 0, width: k.w, height: FELT_Y, class: 'ha-lane' });
  }
  node(svg, 'rect', { x: 7 * KW, y: 0, width: 1, height: FELT_Y, class: 'ha-oct' });

  // the falling part: two copies of the tune, one above the other, for a seamless loop
  const roll = node(node(svg, 'g', { 'clip-path': 'url(#ha-roll)' }), 'g', { class: 'ha-move' });
  for (const copy of [0, 1]) {
    for (let b = 0; b < BEATS; b += 4) {
      const y = FELT_Y - (b + copy * BEATS) * PPB + 0.5;
      node(roll, 'line', { x1: 0, x2: W, y1: y, y2: y, class: 'ha-barline' });
      node(roll, 'text', { x: 8, y: y - 6, class: 'ha-barno' }, String(b / 4 + 1));
    }
    for (const [b, p, len, f] of TUNE) {
      const k = keyX(p);
      const bottom = FELT_Y - (b + copy * BEATS) * PPB - 2;
      const h = len * PPB - 4;
      node(roll, 'rect', { x: k.x + 5, y: bottom - h, width: k.w - 10, height: h, rx: 7, class: `ha-bar f${f}` });
      node(roll, 'text', { x: k.x + k.w / 2, y: bottom - 12, class: 'ha-num' }, String(f));
    }
  }

  // keyboard: case, felt, white keys with their lights, black keys
  node(svg, 'rect', { x: 0, y: FELT_Y, width: W, height: H - FELT_Y, class: 'ha-case' });
  node(svg, 'rect', { x: 0, y: FELT_Y, width: W, height: FELT, class: 'ha-felt' });
  const lights = new Map<number, SVGGElement>();
  WHITES.forEach((p, i) => {
    const x = i * KW;
    node(svg, 'rect', { x: x + 0.5, y: FELT_Y + FELT, width: KW - 1, height: H - FELT_Y - FELT - 1, rx: 4, class: 'ha-w' });
    const tune = TUNE.find((n) => n[1] === p);
    if (tune) {
      const g = node(svg, 'g', { class: 'ha-light', opacity: 0 });
      node(g, 'rect', { x: x + 4, y: FELT_Y + 64, width: KW - 8, height: H - FELT_Y - 72, rx: 6, class: `ha-bar f${tune[3]}` });
      node(g, 'text', { x: x + KW / 2, y: FELT_Y + 64 + (H - FELT_Y - 72) / 2 + 1, class: 'ha-num big' }, String(tune[3]));
      lights.set(p, g);
    }
    if (p % 12 === 0) node(svg, 'text', { x: x + KW / 2, y: H - 12, class: 'ha-c' }, p === 60 ? 'C4' : 'C5');
  });
  for (const p of BLACKS) {
    const k = keyX(p);
    node(svg, 'rect', { x: k.x, y: FELT_Y + FELT, width: k.w, height: 70, rx: 3, class: 'ha-b' });
  }

  // a caption in the corner
  const cap = node(svg, 'g', { class: 'ha-cap' });
  node(cap, 'text', { x: W - 18, y: 32, class: 'ha-title' }, t('hero.piece'));
  node(cap, 'text', { x: W - 18, y: 50, class: 'ha-sub' }, t('hero.caption'));

  root.replaceChildren(svg);

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || typeof roll.animate !== 'function';
  if (still) {
    roll.setAttribute('transform', `translate(0 ${3.2 * PPB})`);
    lights.get(67)?.setAttribute('opacity', '1');
    return { stop() {} };
  }
  const ms = (BEATS * 60_000) / BPM;
  const anims: Animation[] = [roll.animate([{ transform: 'translateY(0px)' }, { transform: `translateY(${BEATS * PPB}px)` }], { duration: ms, iterations: Infinity, easing: 'linear' })];
  for (const [p, g] of lights) {
    const frames: Keyframe[] = [{ opacity: 0, offset: 0 }];
    for (const [b, q, len] of TUNE) {
      if (q !== p) continue;
      const a = b / BEATS;
      const z = Math.min(1, (b + len) / BEATS);
      frames.push({ opacity: 0, offset: Math.max(0, a - 0.001) }, { opacity: 1, offset: a }, { opacity: 1, offset: Math.max(a, z - 0.012) }, { opacity: 0, offset: z });
    }
    if (frames[frames.length - 1].offset !== 1) frames.push({ opacity: 0, offset: 1 });
    // offsets must not go backwards; repeated notes of a key touch end to start
    for (let i = 1; i < frames.length; i++) frames[i].offset = Math.max(frames[i].offset as number, frames[i - 1].offset as number);
    anims.push(g.animate(frames, { duration: ms, iterations: Infinity }));
  }
  return { stop: () => anims.forEach((a) => a.cancel()) };
}
