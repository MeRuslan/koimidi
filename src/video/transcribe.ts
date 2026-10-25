/**
 * From notes in seconds to a piece in beats and bars: which hand played each
 * note (by colour), the finest pulse the notes sit on (the tatum), how many
 * tatums make a bar, and from those the time signature, the note values and
 * the tempo. Nothing here presumes a tempo: a slow tutorial is written slow.
 * The result is a standard MIDI file, so it goes through the same import as
 * any other file.
 */
import { Midi } from '@tonejs/midi';
import type { Hand } from '../score/model';
import { hueSat } from './frame';
import { median, type RawNote } from './tracker';

export interface TranscribedNote {
  pitch: number;
  /** Beats (quarter notes) from the start of the first bar. */
  t: number;
  dur: number;
  hand: Hand | null;
}

export interface Transcribed {
  notes: TranscribedNote[];
  bpm: number;
  timeSig: [number, number];
  /** 'color': hands told apart by the colour of the keys; 'none': one colour, the importer splits by pitch. */
  hands: 'color' | 'none';
  measures: number;
}

export interface TranscribeOptions {
  /** Playback speed the video was watched at (0.5 = half speed). */
  speed?: number;
  /** Force a time signature instead of guessing one. */
  timeSig?: [number, number];
  /** Move the barlines this many beats later (negative: earlier) than guessed. */
  shift?: number;
}

/* ---------- hands ---------- */

/**
 * Right or left for each note when the keys light up in two distinct hues;
 * null otherwise. Only the hue counts: many videos light white keys in a
 * lighter shade and black keys in a darker one of the same hand's colour.
 * Saturated colours say their hue more surely than pale ones, so they weigh
 * more; and two hues that also sit in two registers are two hands even when
 * the hues are a little loose.
 */
export function handsByColor(notes: RawNote[]): Hand[] | null {
  if (notes.length < 4) return null;
  const hs = notes.map((n) => hueSat(n.color));
  // keys lit in white or grey carry no hue to go by: they do not vote, and join the hand nearest in pitch
  const coloured = hs.map((h) => h.sat >= 0.15);
  if (coloured.filter(Boolean).length < notes.length * 0.8) return null;
  const pts = hs.map(({ hue }) => {
    const a = (hue * Math.PI) / 180;
    return [Math.cos(a), Math.sin(a)];
  });
  const w = hs.map((h, i) => (coloured[i] ? h.sat : 0));
  const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // two clusters, started from the two main peaks of the hue histogram, at least 30° apart
  const bins = new Float64Array(36);
  hs.forEach((h, i) => (bins[Math.floor(h.hue / 10) % 36] += w[i]));
  const smooth = Array.from(bins, (_, b) => bins[(b + 35) % 36] + bins[b] + bins[(b + 1) % 36]);
  let p0 = 0;
  for (let b = 1; b < 36; b++) if (smooth[b] > smooth[p0]) p0 = b;
  let p1 = -1;
  for (let b = 0; b < 36; b++) {
    const apart = Math.min(Math.abs(b - p0), 36 - Math.abs(b - p0));
    if (apart >= 3 && (p1 < 0 || smooth[b] > smooth[p1])) p1 = b;
  }
  if (p1 < 0 || smooth[p1] < smooth[p0] * 0.05) return null;
  const unit = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  let c0 = unit(p0 * 10 + 5);
  let c1 = unit(p1 * 10 + 5);
  let side: number[] = [];
  for (let it = 0; it < 20; it++) {
    side = pts.map((p) => (d(p, c0) <= d(p, c1) ? 0 : 1));
    const mean = (s: number) => {
      let x = 0;
      let y = 0;
      let sum = 0;
      pts.forEach((p, i) => {
        if (side[i] !== s) return;
        x += p[0] * w[i];
        y += p[1] * w[i];
        sum += w[i];
      });
      return sum ? [x / sum, y / sum] : s ? c1 : c0;
    };
    c0 = mean(0);
    c1 = mean(1);
  }
  const voters = pts.map((_, i) => i).filter((i) => coloured[i]);
  const n1 = voters.filter((i) => side[i] === 1).length;
  const n0 = voters.length - n1;
  if (!n0 || !n1) return null;
  const angle = Math.acos(Math.max(-1, Math.min(1, (c0[0] * c1[0] + c0[1] * c1[1]) / (Math.hypot(c0[0], c0[1]) * Math.hypot(c1[0], c1[1]) || 1))));
  const sep = d(c0, c1);
  let spread = 0;
  let weight = 0;
  for (const i of voters) {
    spread += w[i] * d(pts[i], side[i] ? c1 : c0);
    weight += w[i];
  }
  spread /= weight || 1;
  const meanPitch = (s: number) => voters.filter((i) => side[i] === s).reduce((a, i) => a + notes[i].pitch, 0) / (s ? n1 : n0);
  const registers = Math.abs(meanPitch(0) - meanPitch(1)) >= 7;
  // hues at least 30° apart, each with a fair share of the notes, and each cluster tight around its own
  if (angle < Math.PI / 6 || Math.min(n0, n1) < voters.length * 0.08 || spread > sep * (registers ? 0.6 : 0.35)) return null;
  const right = meanPitch(1) > meanPitch(0) ? 1 : 0;
  const split = (meanPitch(0) + meanPitch(1)) / 2;
  return notes.map((n, i) => (coloured[i] ? (side[i] === right ? 'R' : 'L') : n.pitch >= split ? 'R' : 'L'));
}

/* ---------- the tatum ---------- */

const BIN = 0.01;
/** How firmly the pulse keeps its period: higher follows the period, lower follows the notes. */
const TIGHTNESS = 60;

interface Onset {
  t: number;
  /** indexes of the notes starting together */
  idx: number[];
}

/** Notes that start within 50 ms of each other are one onset (a chord, or the two hands together). */
function onsetGroups(notes: RawNote[]): Onset[] {
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].on - notes[b].on);
  const out: Onset[] = [];
  for (const i of order) {
    const g = out[out.length - 1];
    if (g && notes[i].on - g.t <= 0.05) g.idx.push(i);
    else out.push({ t: notes[i].on, idx: [i] });
  }
  return out;
}

/**
 * The tatum: the finest pulse the notes sit on, as the longest period that
 * still explains as many of the gaps between onsets as any period does (as
 * whole multiples, up to eight), since half of it would explain them too.
 */
export function tatumPeriod(times: number[]): number {
  const iois: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const g = times[i] - times[i - 1];
    if (g >= 0.09 && g <= 3) iois.push(g);
  }
  if (iois.length < 3) return 0.5;
  // a gap is explained by a period when it is a whole number of periods, give or take a quarter of
  // one (or 40 ms, the jitter of a frame or two): a player drifts and wobbles, and the hands do not
  // land together. The longest period that explains nearly as many gaps as any period does is the
  // tatum: half of it would explain them too, and a short period explains anything, by chance
  // (a short period explains much by chance: what chance alone would explain is taken off)
  const tolerance = (tau: number, g: number) => Math.max(0.04, 0.25 * tau, 0.08 * g);
  const explained = (tau: number) => {
    let n = 0;
    let chance = 0;
    for (const g of iois) {
      const k = Math.round(g / tau);
      const tol = tolerance(tau, g);
      if (k >= 1 && k <= 8 && Math.abs(g - k * tau) <= tol) n++;
      chance += Math.min(1, (2 * tol) / tau);
    }
    return n - chance;
  };
  const scores: [number, number][] = [];
  let best = 0;
  for (let t = 0.09; t <= 1.5; t *= 1.015) {
    const n = explained(t);
    scores.push([t, n]);
    if (n > best) best = n;
  }
  let tau = 0.09;
  for (const [t, n] of scores) if (n >= 0.9 * best) tau = t;
  // refined: the gaps it explains, each divided by its multiple
  let num = 0;
  let den = 0;
  for (const g of iois) {
    const k = Math.round(g / tau);
    if (k >= 1 && k <= 8 && Math.abs(g - k * tau) <= Math.max(0.04, 0.25 * tau, 0.08 * g)) {
      num += g;
      den += k;
    }
  }
  return den ? num / den : tau;
}

/** Onsets as a curve over time in BIN steps: a bump of width `sigma` bins per onset, scaled to unit deviation. */
function envelope(onsets: { t: number; w: number }[], origin: number, n: number, sigma: number): Float32Array {
  const env = new Float32Array(n);
  const reach = Math.ceil(sigma * 3);
  for (const o of onsets) {
    const c = (o.t - origin) / BIN;
    for (let k = Math.floor(c) - reach; k <= Math.ceil(c) + reach; k++) {
      if (k >= 0 && k < n) env[k] += o.w * Math.exp(-((k - c) ** 2) / (2 * sigma * sigma));
    }
  }
  let mean = 0;
  for (const v of env) mean += v;
  mean /= n;
  let sd = 0;
  for (const v of env) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / n) || 1;
  for (let i = 0; i < n; i++) env[i] /= sd;
  return env;
}

/** Times of a pulse of about `period` seconds through the onsets, by dynamic programming (Ellis 2007): it may drift with the player. */
export function trackPulse(onsets: { t: number; w: number }[], end: number, period: number): number[] {
  if (onsets.length < 2) {
    const t0 = onsets[0]?.t ?? 0;
    const out: number[] = [];
    for (let t = t0; t <= end + period; t += period) out.push(t);
    return out.length >= 2 ? out : [t0, t0 + period];
  }
  const origin = Math.max(0, onsets[0].t - 1);
  const n = Math.ceil((end - origin) / BIN) + 2;
  const env = envelope(onsets, origin, n, 2);
  const P = period / BIN;
  const dLo = Math.max(1, Math.round(P * 0.6));
  const dHi = Math.round(P * 1.6);
  const pen = new Float32Array(dHi + 1);
  for (let d = dLo; d <= dHi; d++) pen[d] = TIGHTNESS * Math.log(d / P) ** 2;
  const C = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let arg = -1;
    for (let d = dLo; d <= dHi && d <= t; d++) {
      const v = C[t - d] - pen[d];
      if (v > best) {
        best = v;
        arg = t - d;
      }
    }
    C[t] = env[t] + best;
    back[t] = arg;
  }
  let t = n - 1;
  for (let k = Math.max(0, n - dHi); k < n; k++) if (C[k] > C[t]) t = k;
  const beats: number[] = [];
  while (t >= 0) {
    beats.push(origin + t * BIN);
    t = back[t];
  }
  beats.reverse();
  if (beats.length < 2) beats.push(beats[0] + period);
  // cover the first and the last note
  const first = onsets[0].t;
  while (beats[0] - (beats[1] - beats[0]) * 0.5 > first) beats.unshift(beats[0] - (beats[1] - beats[0]));
  while (beats[beats.length - 1] < end) beats.push(2 * beats[beats.length - 1] - beats[beats.length - 2]);
  return beats;
}

/** Position of a time in beats (fractional index into `beats`), extrapolated beyond both ends. */
export function beatPos(t: number, beats: number[]): number {
  const n = beats.length;
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let a = 0;
  let b = n - 1;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (beats[m] <= t) a = m;
    else b = m;
  }
  return a + (t - beats[a]) / (beats[a + 1] - beats[a]);
}

/* ---------- bars ---------- */

export interface OnsetInBeats {
  /** Position in beats (or tatums). */
  t: number;
  /** A bass note starts here: a left-hand note, or the low note of a chord. */
  bass: boolean;
  /** Notes starting here. */
  size: number;
  /** Longest of them, in the same unit. */
  long: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Beats per bar and where bars start (0 ≤ phase < meter), from the unit
 * (quarter beats by default, or tatums) the onsets are counted in. The rhythm
 * of a piece repeats bar after bar; bars start where chords, bass notes and
 * long notes start; and most pieces begin on a downbeat or just before one.
 * `prior` adds to a candidate's score what is known about bars of that
 * length (by default: four beats are the commonest).
 */
export function guessMeter(
  onsets: OnsetInBeats[],
  fixed?: number,
  candidates: number[] = [3, 4],
  prior: (m: number) => number = (m) => (m === 4 ? 0.05 : 0),
  quarter: (m: number) => number = () => 1,
): { meter: number; phase: number } {
  const times = onsets.map((o) => o.t);
  const first = Math.min(...times);
  const lo = Math.floor(first);
  const hi = Math.ceil(Math.max(...times));
  // accents: chords, bass notes, and notes of a beat and a half or more
  const accentsFor = (beat: number) => {
    const accent = new Map<number, number>();
    for (const o of onsets) {
      if (Math.abs(o.t - Math.round(o.t)) > 1e-6) continue;
      const b = Math.round(o.t);
      accent.set(b, (accent.get(b) ?? 0) + 1 + 0.4 * (o.size - 1) + (o.bass ? 1 : 0) + (o.long >= 1.5 * beat ? 0.5 : 0));
    }
    const meanA = [...accent.values()].reduce((a, v) => a + v, 0) / Math.max(1, accent.size) || 1;
    return { accent, meanA };
  };
  const bestPhase = (m: number) => {
    const beat = quarter(m);
    const { accent, meanA } = accentsFor(beat);
    let best = -Infinity;
    let ph = 0;
    for (let p = 0; p < m; p++) {
      let sOn = 0;
      let nOn = 0;
      let sOff = 0;
      let nOff = 0;
      for (let b = lo; b <= hi; b++) {
        const a = accent.get(b) ?? 0;
        if (mod(b - p, m) === 0) {
          sOn += a;
          nOn++;
        } else {
          sOff += a;
          nOff++;
        }
      }
      const lead = mod(p - first, m);
      const prior = lead < 1e-6 ? 0.35 : lead <= beat ? 0.15 : 0;
      const s = ((nOn ? sOn / nOn : 0) - (nOff ? sOff / nOff : 0)) / meanA + prior;
      if (s > best) {
        best = s;
        ph = p;
      }
    }
    return { ph, s: best };
  };
  if (fixed) return { meter: fixed, phase: bestPhase(fixed).ph };
  // how often an onset has another one exactly L units later (a short piece supports short bars best)
  const grid = new Set(times.map((t) => Math.round(t * 12)));
  const rep = (L: number) => {
    let hit = 0;
    for (const k of grid) if (grid.has(k + 12 * L)) hit++;
    return hit / grid.size;
  };
  const score = (m: number) => (rep(m) + rep(2 * m)) / 2 + 0.2 * bestPhase(m).s + prior(m);
  const order = [...candidates].sort((a, b) => score(b) - score(a));
  const meter = order[0];
  return { meter, phase: bestPhase(meter).ph };
}

/**
 * Whether accents fall every third eighth of the bar rather than every
 * second: compound time. `eighth` is an eighth note in tatums.
 */
function ternary(positions: number[], weights: number[], L: number, phase: number, eighth: number): boolean {
  if (L % (3 * eighth) !== 0) return false;
  if (L % (2 * eighth) !== 0) return true;
  const a = new Float64Array(L);
  positions.forEach((p, i) => (a[mod(p - phase, L)] += weights[i]));
  const contrast = (step: number) => {
    let on = 0;
    let nOn = 0;
    let off = 0;
    let nOff = 0;
    for (let p = 0; p < L; p++) {
      if (p % step === 0) {
        on += a[p];
        nOn++;
      } else {
        off += a[p];
        nOff++;
      }
    }
    return (nOn ? on / nOn : 0) - (nOff ? off / nOff : 0);
  };
  return contrast(3 * eighth) > contrast(2 * eighth) * 1.1;
}

interface Reading {
  timeSig: [number, number];
  /** Tatums per quarter note. */
  tpq: number;
  /** What is known about such bars: a quarter note lasts about half a second, four to a bar is the commonest, two is rare. */
  prior: number;
}

/**
 * The ways a bar of L tatums can be written, best first: the tatum as a
 * quarter, an eighth or a sixteenth, and the bar as simple or compound time.
 */
function readingsOf(L: number, tau: number, compound: (eighth: number) => boolean): Reading[] {
  const out: Reading[] = [];
  for (const tpq of [1, 2, 4, 8]) {
    // a quarter note between 37 and 150 to the minute: faster, and the tatum is a shorter note value
    if (tau * tpq < 0.4 || tau * tpq > 1.6) continue;
    const quarters = L / tpq;
    const eighth = tpq / 2;
    const triple = eighth >= 1 && compound(eighth);
    let timeSig: [number, number] | null = null;
    let bonus = 0;
    if (quarters === 4) {
      timeSig = [4, 4];
      bonus = 0.03;
    } else if (quarters === 3) timeSig = triple ? [6, 8] : [3, 4];
    else if (quarters === 2) {
      timeSig = [2, 4];
      bonus = -0.2;
    } else if (quarters === 1.5 && eighth >= 1) {
      timeSig = [3, 8];
      bonus = -0.2;
    } else if (quarters === 4.5 && triple) {
      timeSig = [9, 8];
      bonus = -0.05;
    } else if (quarters === 6 && triple) {
      timeSig = [12, 8];
      bonus = -0.05;
    }
    if (!timeSig) continue;
    out.push({ timeSig, tpq, prior: bonus - 0.2 * Math.abs(Math.log2((tau * tpq) / 0.55)) });
  }
  // nothing within the usual tempos (a tatum longer than a slow quarter, say): the bar as plain beats
  if (!out.length && (L === 3 || L === 4)) out.push({ timeSig: [L, 4], tpq: 1, prior: -0.5 });
  return out.sort((a, b) => b.prior - a.prior);
}

/** A forced time signature, read so that a quarter note is between 60 and 200 to the minute if it can be. */
function forcedReading(sig: [number, number], tau: number): { L: number; tpq: number } {
  const quarters = (sig[0] * 4) / sig[1];
  if (sig[1] === 8 && sig[0] % 3 === 0) return { L: Math.round(quarters * 2), tpq: 2 };
  const options = [1, 2, 4].filter((tpq) => Number.isInteger(quarters * tpq));
  const fit = (tpq: number) => Math.abs(Math.log2((tau * tpq) / 0.5));
  const tpq = options.sort((a, b) => fit(a) - fit(b))[0] ?? 1;
  return { L: Math.round(quarters * tpq), tpq };
}

/* ---------- the whole way ---------- */

export function transcribe(raw: RawNote[], opts: TranscribeOptions = {}): Transcribed {
  const notes = raw.filter((n) => n.off > n.on);
  if (!notes.length) return { notes: [], bpm: 120, timeSig: opts.timeSig ?? [4, 4], hands: 'none', measures: 0 };
  const hands = handsByColor(notes);
  const groups = onsetGroups(notes);
  const end = Math.max(...notes.map((n) => n.off));
  const tau = tatumPeriod(groups.map((g) => g.t));
  const pulse = trackPulse(
    groups.map((g) => ({ t: g.t, w: 1 + 0.5 * (g.idx.length - 1) })),
    end,
    tau,
  );
  // every onset to its nearest tatum; a note lasts to the tatum nearest its end, at least one
  const at = groups.map((g) => Math.round(beatPos(g.t, pulse)));
  const noteOn = new Array<number>(notes.length);
  groups.forEach((g, gi) => g.idx.forEach((i) => (noteOn[i] = at[gi])));
  const noteDur = notes.map((n, i) => Math.max(1, Math.round(beatPos(n.off, pulse)) - noteOn[i]));

  // the bar: its length in tatums and where it starts
  const onsets: OnsetInBeats[] = groups.map((g, gi) => ({
    t: at[gi],
    bass: hands ? g.idx.some((i) => hands[i] === 'L') : g.idx.length > 1 && Math.min(...g.idx.map((i) => notes[i].pitch)) < 57,
    size: g.idx.length,
    long: Math.max(...g.idx.map((i) => noteDur[i])),
  }));
  const forced = opts.timeSig ? forcedReading(opts.timeSig, tau) : null;
  let L: number;
  let tpq: number;
  let timeSig: [number, number];
  let phase: number;
  if (forced) {
    L = forced.L;
    tpq = forced.tpq;
    timeSig = opts.timeSig!;
    phase = guessMeter(onsets, L, undefined, undefined, () => tpq).phase;
  } else {
    // the usual bar lengths in tatums, each in its best reading. What is known about pieces weighs
    // in: a quarter note lasts about half a second (so a bar twice the true one, which repeats just
    // as well, reads as a slow piece and loses), four to a bar is the commonest, two is rare
    const weights = onsets.map((o) => 1 + 0.4 * (o.size - 1) + (o.bass ? 1 : 0) + (o.long >= 2 ? 0.5 : 0));
    const readings = new Map<number, Reading>();
    for (const m of [3, 4, 6, 8, 9, 12, 16, 18]) {
      const ph = guessMeter(onsets, m, undefined, undefined, () => Math.max(1, m / 4)).phase;
      const best = readingsOf(m, tau, (eighth) => ternary(at, weights, m, ph, eighth))[0];
      if (best) readings.set(m, best);
    }
    const all = [...readings.keys()];
    const guessed = guessMeter(onsets, undefined, all, (m) => readings.get(m)!.prior, (m) => readings.get(m)!.tpq);
    L = guessed.meter;
    phase = guessed.phase;
    const r = readings.get(L)!;
    tpq = r.tpq;
    timeSig = r.timeSig;
  }
  const ph = phase + (opts.shift ?? 0) * tpq;
  const firstOn = Math.min(...at);
  const downbeat = ph + L * Math.floor((firstOn - ph) / L);
  const bpm = Math.round((60 / (tau * tpq * (opts.speed ?? 1))) * 10) / 10;
  const out: TranscribedNote[] = notes.map((n, i) => ({ pitch: n.pitch, t: (noteOn[i] - downbeat) / tpq, dur: noteDur[i] / tpq, hand: hands ? hands[i] : null }));
  out.sort((a, b) => a.t - b.t || a.pitch - b.pitch);
  const last = Math.max(...out.map((n) => n.t + n.dur));
  return { notes: out, bpm, timeSig, hands: hands ? 'color' : 'none', measures: Math.ceil(last / (L / tpq) - 1e-6) };
}

/**
 * Octaves to move a piece whose keyboard did not say its octave (a close-up
 * without a standard key count). In easy pieces the left hand sits around
 * the C below middle C and the whole around middle C; a piece a whole octave
 * away from that is moved, anything nearer is left as it is.
 */
export function octaveHint(notes: { pitch: number; hand: Hand | null }[]): number {
  if (!notes.length) return 0;
  const mean = (ns: { pitch: number }[]) => ns.reduce((a, n) => a + n.pitch, 0) / ns.length;
  const left = notes.filter((n) => n.hand === 'L');
  const right = notes.filter((n) => n.hand === 'R');
  // the right hand of an easy piece sits around the G above middle C, the left around the D# below it
  const offs: number[] = [];
  if (left.length >= 4) offs.push(mean(left) - 51);
  if (right.length >= 4) offs.push(mean(right) - 68);
  if (!offs.length) offs.push(mean(notes) - 60);
  const off = offs.reduce((a, v) => a + v, 0) / offs.length;
  return Math.abs(off) < 6 ? 0 : Math.max(-2, Math.min(2, -Math.round(off / 12)));
}

/** A standard MIDI file of the transcription: two tracks (right, left) when the hands are known, else one. */
export function toMidi(tr: Transcribed, title: string): Uint8Array {
  const midi = new Midi();
  midi.name = title;
  midi.header.setTempo(tr.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: tr.timeSig });
  midi.header.update();
  const ppq = midi.header.ppq;
  const track = (name: string, hand: Hand | null) => {
    const tk = midi.addTrack();
    tk.name = name;
    tk.channel = 0;
    tk.instrument.number = 0;
    for (const n of tr.notes) {
      if (hand && n.hand !== hand) continue;
      tk.addNote({ midi: n.pitch, ticks: Math.round(n.t * ppq), durationTicks: Math.max(1, Math.round(n.dur * ppq)), velocity: 0.7 });
    }
  };
  if (tr.hands === 'color') {
    track('Right hand', 'R');
    track('Left hand', 'L');
  } else track('Piano', null);
  return midi.toArray();
}
