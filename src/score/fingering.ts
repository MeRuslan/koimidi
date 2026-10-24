/**
 * Automatic fingering: dynamic programming (Viterbi) over a Parncutt-style
 * ergonomic cost model. The state is the pair of fingers on the last two
 * notes, so the model sees both transitions and "same key two notes apart".
 * The left hand is the mirror image of the right: pitches are negated and the
 * right-hand tables reused.
 *
 * Fingers that came from the file or from the user are kept and constrain the
 * search; chords get a fixed spread and act as one event.
 */
import { groupByOnset, isBlackKey, type Finger, type Hand, type Score, type ScoreNote } from './model';

type Span = [minPrac: number, minComf: number, minRel: number, maxRel: number, maxComf: number, maxPrac: number];

/** Parncutt et al. (1997) span table for right-hand finger pairs, in semitones. */
const SPAN: Record<string, Span> = {
  '12': [-5, -3, 1, 5, 8, 10],
  '13': [-4, -2, 3, 7, 10, 12],
  '14': [-3, -1, 5, 9, 12, 14],
  '15': [-1, 1, 7, 10, 13, 15],
  '23': [1, 1, 1, 2, 3, 5],
  '24': [1, 1, 3, 4, 5, 6],
  '25': [2, 2, 5, 6, 8, 10],
  '34': [1, 1, 1, 2, 2, 4],
  '35': [1, 1, 3, 4, 5, 7],
  '45': [1, 1, 1, 2, 3, 5],
};

const FINGERS: Finger[] = [1, 2, 3, 4, 5];
const INF = 1e9;

interface Event {
  /** representative pitch (mirrored for the left hand) */
  p: number;
  /** real pitch of the representative note, for black-key checks */
  real: number;
  t: number;
  dur: number;
  allowed: Finger[];
  notes: ScoreNote[];
  /** fingers fixed for chord notes, parallel to notes */
  chordFingers?: Finger[];
}

export interface AutoFingerOptions {
  /** Replace existing automatic fingering too (file/user fingers are always kept). */
  refresh?: boolean;
}

export function autoFinger(score: Score, opts: AutoFingerOptions = {}): void {
  for (const hand of ['R', 'L'] as Hand[]) {
    const notes = score.notes.filter((n) => n.hand === hand);
    if (!notes.length) continue;
    if (!opts.refresh && notes.every((n) => n.finger)) continue;
    fingerHand(notes, hand);
  }
}

function fingerHand(notes: ScoreNote[], hand: Hand): void {
  const sign = hand === 'R' ? 1 : -1;
  const events: Event[] = groupByOnset(notes).map((g) => {
    const sorted = [...g.notes].sort((a, b) => sign * (a.pitch - b.pitch)); // low→high for RH, high→low for LH
    const rep = sorted[sorted.length - 1]; // outer (melody-side) note: top for RH, bottom for LH
    const dur = Math.max(...g.notes.map((n) => n.dur));
    if (sorted.length === 1) {
      const fixed = rep.fingerSource === 'file' || rep.fingerSource === 'user' ? rep.finger : undefined;
      return { p: sign * rep.pitch, real: rep.pitch, t: g.t, dur, allowed: fixed ? [fixed] : FINGERS, notes: sorted };
    }
    const fingers = chordFingers(sorted.map((n) => sign * n.pitch), sorted);
    return { p: sign * rep.pitch, real: rep.pitch, t: g.t, dur, allowed: [fingers[fingers.length - 1]], notes: sorted, chordFingers: fingers };
  });

  const n = events.length;
  const idx = (a: Finger, b: Finger) => (a - 1) * 5 + (b - 1);
  // cost[i][state], state = (f_{i-1}, f_i)
  const cost: Float64Array[] = [];
  const back: Int8Array[] = [];

  if (n === 1) {
    apply(events[0], best(events[0].allowed, (f) => noteCost(events[0], f)));
    return;
  }
  const c1 = new Float64Array(25).fill(INF);
  for (const fa of events[0].allowed) for (const fb of events[1].allowed) c1[idx(fa, fb)] = noteCost(events[0], fa) + trans(events[0], events[1], fa, fb) + noteCost(events[1], fb);
  cost.push(c1);
  back.push(new Int8Array(25).fill(-1));
  for (let i = 2; i < n; i++) {
    const prev = cost[cost.length - 1];
    const cur = new Float64Array(25).fill(INF);
    const bk = new Int8Array(25).fill(-1);
    const e0 = events[i - 2];
    const e1 = events[i - 1];
    const e2 = events[i];
    for (const f2 of e2.allowed) {
      const nc = noteCost(e2, f2);
      for (const f1 of e1.allowed) {
        const tc = trans(e1, e2, f1, f2);
        let bestC = INF;
        let bestF0 = -1;
        for (const f0 of e0.allowed) {
          const base = prev[idx(f0, f1)];
          if (base >= INF) continue;
          const k = e0.p === e2.p && f0 !== f2 && e1.p !== e2.p ? 2 : 0; // same key two notes apart with another finger
          const c = base + tc + k;
          if (c < bestC) {
            bestC = c;
            bestF0 = f0;
          }
        }
        if (bestF0 > 0) {
          cur[idx(f1, f2)] = bestC + nc;
          bk[idx(f1, f2)] = bestF0;
        }
      }
    }
    cost.push(cur);
    back.push(bk);
  }
  // backtrack
  const last = cost[cost.length - 1];
  let bestS = 0;
  for (let s = 1; s < 25; s++) if (last[s] < last[bestS]) bestS = s;
  const fingers: Finger[] = new Array(n);
  let f1 = (Math.floor(bestS / 5) + 1) as Finger;
  let f2 = ((bestS % 5) + 1) as Finger;
  fingers[n - 1] = f2;
  fingers[n - 2] = f1;
  for (let i = n - 1; i >= 2; i--) {
    const f0 = back[i - 1][idx(f1, f2)] as Finger;
    fingers[i - 2] = f0 > 0 ? f0 : f1;
    f2 = f1;
    f1 = fingers[i - 2];
  }
  events.forEach((e, i) => apply(e, fingers[i]));
}

function apply(e: Event, f: Finger): void {
  if (e.chordFingers) {
    e.notes.forEach((nt, k) => {
      if (nt.fingerSource === 'file' || nt.fingerSource === 'user') return;
      nt.finger = e.chordFingers![k];
      nt.fingerSource = 'auto';
    });
    return;
  }
  const nt = e.notes[0];
  if (nt.fingerSource === 'file' || nt.fingerSource === 'user') return;
  nt.finger = f;
  nt.fingerSource = 'auto';
}

function best(allowed: Finger[], f: (x: Finger) => number): Finger {
  let b = allowed[0];
  for (const x of allowed) if (f(x) < f(b)) b = x;
  return b;
}

function noteCost(e: Event, f: Finger): number {
  let c = 0;
  if (f === 4 || f === 5) c += 0.5;
  const black = isBlackKey(e.real);
  if (black && f === 1) c += 2;
  if (black && f === 5) c += 1;
  return c;
}

/** Transition cost from event a (finger fa) to event b (finger fb). Pitches already mirrored for LH. */
function trans(a: Event, b: Event, fa: Finger, fb: Finger): number {
  const gap = b.t - (a.t + a.dur);
  if (gap > 0.5) return 0; // after a rest the hand is free
  if (fa === fb) {
    if (a.p === b.p) return 0;
    return a.dur >= 1.5 ? 3 : 12; // same finger, different key
  }
  const lo = Math.min(fa, fb) as Finger;
  const hi = Math.max(fa, fb) as Finger;
  const span = SPAN[`${lo}${hi}`];
  // interval between the keys, positive when the higher-numbered finger plays the higher key
  const d = fa === lo ? b.p - a.p : a.p - b.p;
  let c = 0;
  if (d < span[1]) c += 2 * (span[1] - d);
  else if (d > span[4]) c += 2 * (d - span[4]);
  const per = lo === 1 ? 1 : 2;
  if (d < span[2]) c += per * (span[2] - d);
  else if (d > span[3]) c += per * (d - span[3]);
  if (d < span[0] || d > span[5]) c += 40;
  if (lo === 1 && d < 0) {
    const thumbReal = fa === 1 ? a.real : b.real;
    const crossingOver = fa === 1 && (fb === 2 || fb === 3);
    if (crossingOver && isBlackKey(b.real)) c += 1; // 2 or 3 crossing over the thumb onto a black key: idiomatic
    else {
      c += 1;
      if (isBlackKey(thumbReal)) c += 2;
    }
  }
  if (lo === 3 && hi === 4) c += 1;
  if (a.dur >= 3) c *= 0.5; // time to regroup after a long note
  return c;
}

/**
 * Fixed finger spread for a chord. `pitches` are mirrored (ascending means
 * outward from the thumb) and sorted ascending; returns fingers in that order,
 * thumb first.
 */
function chordFingers(pitches: number[], _notes: ScoreNote[]): Finger[] {
  const k = pitches.length;
  const span = pitches[k - 1] - pitches[0];
  if (k === 2) {
    if (span <= 2) return [1, 2];
    if (span <= 4) return [1, 3];
    if (span <= 6) return [1, 4];
    return [1, 5];
  }
  if (k === 3) {
    const a = pitches[1] - pitches[0];
    const b = pitches[2] - pitches[1];
    if (span <= 4) return [1, 2, 3];
    if (a <= 2 && b >= 3) return [1, 2, 5];
    if (a >= 5 && b <= 2) return [1, 4, 5];
    return [1, 3, 5];
  }
  if (k === 4) {
    const a = pitches[1] - pitches[0];
    return a <= 2 ? [1, 2, 3, 5] : [1, 2, 4, 5];
  }
  const out: Finger[] = [];
  for (let i = 0; i < k; i++) out.push(Math.min(5, i + 1) as Finger);
  return out;
}
