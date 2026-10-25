/**
 * Choosing the keyboard to follow from the frames seen while looking for it.
 * A keyboard is settled once it has been seen three times in the same place.
 * When a video shows two (a drawn keyboard above a filmed one, say), the one
 * whose keys light up wins. The reference frame handed to the tracker is the
 * brightest calm sighting: videos fade in, and some open on a title drawn
 * over the keys.
 */
import { chroma, luma, patch, type Frame } from './frame';
import { detectKeyboards, sameKeyboard, type KeyboardLayout } from './keyboard';

export interface FoundKeyboard {
  layout: KeyboardLayout;
  /** The frame the tracker takes its first reference colours from. */
  calib: Frame;
  /** Video time of the sighting that settled it. */
  t: number;
}

interface Group {
  layout: KeyboardLayout;
  count: number;
  /** Sightings with a key lit. */
  active: number;
  first: number;
  last: number;
  calib: Frame;
  calibScore: number;
}

/** Keys that look lit in a frame: coloured where a key should be plain (vividly so, with `vivid`: hands over a filmed piano are coloured too, but not like that). */
export function litCount(f: Frame, layout: KeyboardLayout, vivid = false): number {
  let n = 0;
  const at = vivid ? 90 : 40;
  for (const k of layout.keys) if (chroma(patch(f, k.x, k.y, 1)) > at) n++;
  return n;
}

/** Mean brightness of the white keys: low during a fade or under a title. */
function brightness(f: Frame, layout: KeyboardLayout): number {
  let s = 0;
  let n = 0;
  for (const k of layout.keys) {
    if (k.black) continue;
    s += luma(...patch(f, k.x, k.y, 1));
    n++;
  }
  return n ? s / n : 0;
}

function copy(f: Frame): Frame {
  return { width: f.width, height: f.height, data: new Uint8ClampedArray(f.data) };
}

export class KeyboardFinder {
  private groups: Group[] = [];

  /** Seconds to wait for one of two rival keyboards to light up (an intro shows neither playing) before taking the likelier. */
  constructor(private patience = 8) {}

  /** Look at a frame. The keyboard, once there is no doubt about it; null while looking. */
  offer(f: Frame, t: number): FoundKeyboard | null {
    for (const layout of detectKeyboards(f)) {
      let g = this.groups.find((x) => sameKeyboard(x.layout, layout));
      const lit = litCount(f, layout);
      const score = brightness(f, layout) - 8 * lit;
      if (!g) {
        g = { layout, count: 0, active: 0, first: t, last: t, calib: copy(f), calibScore: score };
        this.groups.push(g);
      } else if (score > g.calibScore) {
        g.calibScore = score;
        g.calib = copy(f);
        g.layout = layout;
      }
      g.count++;
      g.last = t;
      if (lit > 0 && litCount(f, layout, true) > 0) g.active++;
    }
    return this.pick(t, false);
  }

  /** The probe is over: the best keyboard seen so far, if one was seen enough. */
  settle(): FoundKeyboard | null {
    return this.pick(Infinity, true);
  }

  /** Two keyboards in sight, neither under the other, and neither has lit up yet: worth watching a while longer. */
  get rivalry(): boolean {
    const rivals = this.groups.filter((g) => g.count >= 2);
    const under = (g: Group) => rivals.some((o) => o !== g && g.layout.top > o.layout.bottom - o.layout.whiteWidth && g.layout.top < o.layout.bottom + 2 * o.layout.whiteWidth);
    const free = rivals.filter((g) => !under(g));
    return free.length > 1 && !free.some((g) => g.active >= 3);
  }

  /** Nothing seen counts any more (a new probe elsewhere in the video). */
  reset(): void {
    this.groups = [];
  }

  private pick(t: number, force: boolean): FoundKeyboard | null {
    let sure = this.groups.filter((g) => g.count >= 3);
    if (!sure.length) return null;
    // a keyboard right under another one (a filmed piano under the drawn keys) is not the one the
    // falling bars land on
    const under = (g: Group) => sure.some((o) => o !== g && g.layout.top > o.layout.bottom - o.layout.whiteWidth && g.layout.top < o.layout.bottom + 2 * o.layout.whiteWidth);
    if (sure.some((g) => !under(g))) sure = sure.filter((g) => !under(g));
    const rivals = this.groups.filter((g) => g.count >= 2 && !(sure.length && under(g) && !sure.includes(g)));
    // one keyboard: no doubt. More: wait for one of them to light up (the probe ends the wait), then take the livelier
    if (rivals.length > 1 && !force) {
      const leader = sure.reduce((a, b) => (b.first < a.first ? b : a));
      const lively = sure.filter((g) => g.active >= 3);
      const decided = lively.length === 1 && rivals.every((g) => g === lively[0] || g.active === 0);
      if (!decided && t - leader.first < this.patience) return null;
    }
    const best = [...sure].sort((a, b) => b.active - a.active || b.layout.blackSeen - a.layout.blackSeen)[0];
    return { layout: best.layout, calib: best.calib, t: best.last };
  }
}
