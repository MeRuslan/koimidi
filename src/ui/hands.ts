/**
 * Two hands seen from above, as they lie on the keys: each fingertip in its
 * finger's colour with its number, so the picture is also the legend. The
 * fingers of the next notes light up; the hand the trainer plays is dashed.
 */
import { t } from '../i18n';
import type { Hand } from '../score/model';

const SVG = 'http://www.w3.org/2000/svg';
const W = 128;
const H = 158;
/** right hand: index to little finger, centre x, top y and a slight fan in degrees; all end under the palm */
const FINGERS: [number, number, number, number][] = [
  [2, 47, 30, -7],
  [3, 65.5, 15, -1],
  [4, 84, 22, 5],
  [5, 101, 40, 12],
];
const FW = 17;
const BASE = 100;
const THUMB = { x: 45, y: 120, angle: -54, len: 56 };

export interface HandState {
  /** hands the player practises */
  active: Set<Hand>;
  /** hand the trainer plays, if any */
  trainer: Hand | null;
  /** outlined bars for this hand (both hands at once: the left) */
  outlined: Hand | null;
  /** fingers to press next, per hand */
  next: { hand: Hand; finger?: number }[];
}

interface Built {
  hand: Hand;
  root: SVGSVGElement;
  caption: SVGTextElement;
  parts: Map<number, SVGElement[]>;
}

export class HandMap {
  private built: Built[] = [];
  private key = '';

  constructor(private root: HTMLElement) {}

  /** Draw the hands the piece has: left and right, or the one it uses. */
  build(hands: { R: boolean; L: boolean }): void {
    const list: Hand[] = hands.L && hands.R ? ['L', 'R'] : hands.L ? ['L'] : ['R'];
    this.built = list.map((h) => this.hand(h));
    this.root.classList.toggle('hand-one', list.length === 1);
    this.root.replaceChildren(...this.built.map((b) => b.root));
    this.key = '';
  }

  update(s: HandState): void {
    const key = JSON.stringify([[...s.active], s.trainer, s.outlined, s.next]);
    if (key === this.key) return;
    this.key = key;
    for (const b of this.built) {
      const playing = s.active.has(b.hand);
      b.root.classList.toggle('off', !playing && s.trainer !== b.hand);
      b.root.classList.toggle('trainer', s.trainer === b.hand);
      const name = t(b.hand === 'L' ? 'hand.L' : 'hand.R');
      b.caption.textContent = s.trainer === b.hand ? `${name} · ${t('hand.trainer')}` : s.outlined === b.hand ? `${name} · ${t('hand.outlined')}` : name;
      const lit = new Set(s.next.filter((n) => n.hand === b.hand && n.finger).map((n) => n.finger!));
      for (const [f, els] of b.parts) for (const node of els) node.classList.toggle('on', lit.has(f));
    }
  }

  private hand(hand: Hand): Built {
    const mirror = hand === 'L';
    const X = (x: number) => (mirror ? W - x : x);
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'hand');
    svg.setAttribute('aria-hidden', 'true');
    const add = <K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>) => {
      const node = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      parent.append(node);
      return node;
    };
    const parts = new Map<number, SVGElement[]>();
    const finger = (f: number, g: SVGGElement, tipX: number, tipY: number) => {
      g.setAttribute('style', `--c: var(--f${f})`);
      const halo = add(g, 'circle', { cx: tipX, cy: tipY, r: 9, class: 'halo' });
      const tip = add(g, 'circle', { cx: tipX, cy: tipY, r: 7.2, class: 'tip' });
      const num = add(g, 'text', { x: tipX, y: tipY + 0.5, class: 'num' });
      num.textContent = String(f);
      parts.set(f, [...(parts.get(f) ?? []), halo, tip, num]);
    };

    // thumb, then the four fingers, then the palm over their bases
    const th = add(svg, 'g', {});
    const angle = mirror ? -THUMB.angle : THUMB.angle;
    const tg = add(th, 'g', { transform: `translate(${X(THUMB.x)} ${THUMB.y}) rotate(${angle})` });
    const thumb = add(tg, 'rect', { x: -FW / 2, y: -THUMB.len + 4, width: FW, height: THUMB.len, rx: FW / 2, class: 'digit' });
    const rad = (angle * Math.PI) / 180;
    const ly = -THUMB.len + 4 + FW / 2;
    const tipX = X(THUMB.x) - ly * Math.sin(rad);
    const tipY = THUMB.y + ly * Math.cos(rad);
    parts.set(1, [thumb]);
    finger(1, th, tipX, tipY);
    for (const [f, cx, top, fan] of FINGERS) {
      const g = add(svg, 'g', {});
      const a = mirror ? -fan : fan;
      const digit = add(g, 'rect', { x: X(cx) - FW / 2, y: top, width: FW, height: BASE - top, rx: FW / 2, class: 'digit', transform: `rotate(${a} ${X(cx)} ${BASE})` });
      parts.set(f, [digit]);
      const r = (a * Math.PI) / 180;
      const len = BASE - top - FW / 2;
      finger(f, g, X(cx) + len * Math.sin(r), BASE - len * Math.cos(r));
    }
    add(svg, 'path', {
      class: 'palm',
      d: mirror
        ? `M${W - 37} 88 Q${W - 37} 78 ${W - 48} 77 L${W - 102} 80 Q${W - 113} 82 ${W - 112} 96 L${W - 107} 126 Q${W - 103} 141 ${W - 84} 141 L${W - 58} 141 Q${W - 40} 141 ${W - 37} 124 Z`
        : 'M37 88 Q37 78 48 77 L102 80 Q113 82 112 96 L107 126 Q103 141 84 141 L58 141 Q40 141 37 124 Z',
    });
    const caption = add(svg, 'text', { x: W / 2, y: H - 3, class: 'cap' });
    return { hand, root: svg, caption, parts };
  }
}
