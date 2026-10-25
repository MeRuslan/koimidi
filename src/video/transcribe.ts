/**
 * From notes in seconds to a piece in beats and bars: which hand played each
 * note (by colour), where the beats fall, how the notes sit on them, and the
 * time signature. The result is a standard MIDI file, so it goes through the
 * same import as any other file.
 */
import { Midi } from '@tonejs/midi';
import type { Hand } from '../score/model';
import { hueSat } from './frame';
import { median, type RawNote } from './tracker';

export interface TranscribedNote {
  pitch: number;
  /** Beats from the start of the first bar. */
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
  const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // two clusters, started from the two most different hues
  let c1 = pts.reduce((m, p) => (d(p, pts[0]) > d(m, pts[0]) ? p : m), pts[0]);
  let c0 = pts.reduce((m, p) => (d(p, c1) > d(m, c1) ? p : m), pts[0]);
  let side: number[] = [];
  for (let it = 0; it < 20; it++) {
    side = pts.map((p) => (d(p, c0) <= d(p, c1) ? 0 : 1));
    const mean = (s: number) => {
      const ps = pts.filter((_, i) => side[i] === s && coloured[i]);
      return ps.length ? [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length] : s ? c1 : c0;
    };
    c0 = mean(0);
    c1 = mean(1);
  }
  const voters = pts.map((_, i) => i).filter((i) => coloured[i]);
  const n1 = voters.filter((i) => side[i] === 1).length;
  const n0 = voters.length - n1;
  // hues at least 30° apart, each with a fair share of the notes, and each cluster tight around its own
  const angle = Math.acos(Math.max(-1, Math.min(1, (c0[0] * c1[0] + c0[1] * c1[1]) / (Math.hypot(c0[0], c0[1]) * Math.hypot(c1[0], c1[1]) || 1))));
  const sep = d(c0, c1);
  const spread = voters.reduce((s, i) => s + d(pts[i], side[i] ? c1 : c0), 0) / voters.length;
  if (angle < Math.PI / 6 || Math.min(n0, n1) < voters.length * 0.08 || spread > sep * 0.35) return null;
  const meanPitch = (s: number) => voters.filter((i) => side[i] === s).reduce((a, i) => a + notes[i].pitch, 0) / (s ? n1 : n0);
  const right = meanPitch(1) > meanPitch(0) ? 1 : 0;
  const split = (meanPitch(0) + meanPitch(1)) / 2;
  return notes.map((n, i) => (coloured[i] ? (side[i] === right ? 'R' : 'L') : n.pitch >= split ? 'R' : 'L'));
}

/* ---------- beats ---------- */

const BIN = 0.01;
/** How firmly the beat keeps its tempo: higher follows the tempo, lower follows the notes. */
const TIGHTNESS = 60;

interface Onset {
  t: number;
  /** indexes of the notes starting together */
  idx: number[];
}

/** Notes that start within 35 ms of each other are one onset (a chord). */
function onsetGroups(notes: RawNote[]): Onset[] {
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].on - notes[b].on);
  const out: Onset[] = [];
  for (const i of order) {
    const g = out[out.length - 1];
    if (g && notes[i].on - g.t <= 0.035) g.idx.push(i);
    else out.push({ t: notes[i].on, idx: [i] });
  }
  return out;
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

/** Beat times in seconds: the tempo from the autocorrelation of the onsets, then the beats by dynamic programming (Ellis 2007). */
export function beatTimes(onsets: { t: number; w: number }[], end: number): number[] {
  if (onsets.length < 4) {
    const t0 = onsets[0]?.t ?? 0;
    const out: number[] = [];
    for (let t = t0; t <= end + 0.5; t += 0.5) out.push(t);
    return out.length >= 2 ? out : [t0, t0 + 0.5];
  }
  const origin = Math.max(0, onsets[0].t - 1);
  const n = Math.ceil((end - origin) / BIN) + 2;
  // the tempo from a blurred picture (played notes wander by tens of milliseconds), the beats from a sharper one
  const blurred = envelope(onsets, origin, n, 4);
  const env = envelope(onsets, origin, n, 2);

  // period: autocorrelation weighted towards 100 beats per minute
  const lo = Math.round(0.25 / BIN);
  const hi = Math.round(1.5 / BIN);
  const ac: number[] = [];
  for (let lag = 0; lag <= hi + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += blurred[i] * blurred[i + lag];
    ac.push(lag ? s / (n - lag) : s / n);
  }
  let bestLag = 60;
  let bestScore = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    const prior = Math.exp(-0.5 * (Math.log2(lag / 60) / 0.9) ** 2);
    const score = ac[lag] * prior;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  let P = bestLag;
  const den = ac[bestLag - 1] - 2 * ac[bestLag] + ac[bestLag + 1];
  if (den < 0) P += (0.5 * (ac[bestLag - 1] - ac[bestLag + 1])) / den;

  // beats: the chain of peaks that best keeps the period
  const dLo = Math.max(1, Math.round(P * 0.5));
  const dHi = Math.round(P * 2);
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
  if (beats.length < 2) beats.push(beats[0] + P * BIN);
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
  /** Position in beats. */
  t: number;
  /** A bass note starts here: a left-hand note, or the low note of a chord. */
  bass: boolean;
  /** Notes starting here. */
  size: number;
  /** Longest of them, in beats. */
  long: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Beats per bar (3 or 4) and where bars start (0 ≤ phase < meter). The rhythm
 * of a piece repeats bar after bar; bars start where chords, bass notes and
 * long notes start; and most pieces begin on a downbeat or just before one.
 */
export function guessMeter(onsets: OnsetInBeats[], fixed?: number): { meter: number; phase: number } {
  const accent = new Map<number, number>();
  for (const o of onsets) {
    if (Math.abs(o.t - Math.round(o.t)) > 1e-6) continue;
    const b = Math.round(o.t);
    accent.set(b, (accent.get(b) ?? 0) + 1 + 0.4 * (o.size - 1) + (o.bass ? 1 : 0) + (o.long >= 1.5 ? 0.5 : 0));
  }
  const times = onsets.map((o) => o.t);
  const first = Math.min(...times);
  const lo = Math.floor(first);
  const hi = Math.ceil(Math.max(...times));
  const meanA = [...accent.values()].reduce((a, v) => a + v, 0) / Math.max(1, accent.size) || 1;
  const phaseScore = (m: number, ph: number) => {
    let sOn = 0;
    let nOn = 0;
    let sOff = 0;
    let nOff = 0;
    for (let b = lo; b <= hi; b++) {
      const a = accent.get(b) ?? 0;
      if (mod(b - ph, m) === 0) {
        sOn += a;
        nOn++;
      } else {
        sOff += a;
        nOff++;
      }
    }
    const lead = mod(ph - first, m);
    const prior = lead < 1e-6 ? 0.35 : lead <= 1 ? 0.15 : 0;
    return ((nOn ? sOn / nOn : 0) - (nOff ? sOff / nOff : 0)) / meanA + prior;
  };
  const bestPhase = (m: number) => {
    let best = -Infinity;
    let ph = 0;
    for (let p = 0; p < m; p++) {
      const s = phaseScore(m, p);
      if (s > best) {
        best = s;
        ph = p;
      }
    }
    return { ph, s: best };
  };
  if (fixed) return { meter: fixed, phase: bestPhase(fixed).ph };
  // how often an onset has another one exactly L beats later
  const grid = new Set(times.map((t) => Math.round(t * 12)));
  const rep = (L: number) => {
    let hit = 0;
    for (const k of grid) if (grid.has(k + 12 * L)) hit++;
    return hit / grid.size;
  };
  const score = (m: number) => (rep(m) + rep(2 * m)) / 2 + 0.15 * bestPhase(m).s;
  const meter = score(3) > score(4) + 0.08 ? 3 : 4;
  return { meter, phase: bestPhase(meter).ph };
}

/* ---------- the whole way ---------- */

export function transcribe(raw: RawNote[], opts: TranscribeOptions = {}): Transcribed {
  const notes = raw.filter((n) => n.off > n.on);
  if (!notes.length) return { notes: [], bpm: 120, timeSig: opts.timeSig ?? [4, 4], hands: 'none', measures: 0 };
  const hands = handsByColor(notes);
  const groups = onsetGroups(notes);
  const end = Math.max(...notes.map((n) => n.off));
  const beats = beatTimes(
    groups.map((g) => ({ t: g.t, w: 1 + 0.5 * (g.idx.length - 1) })),
    end,
  );

  // onsets onto the grid, beat by beat: quarters of a beat, or thirds when the notes sit clearly better on them
  const pos = groups.map((g) => beatPos(g.t, beats));
  const byBeat = new Map<number, number[]>();
  pos.forEach((p, i) => {
    const b = Math.floor(p + 0.125);
    if (!byBeat.has(b)) byBeat.set(b, []);
    byBeat.get(b)!.push(i);
  });
  const snapped = new Array<number>(groups.length);
  const gridOf = new Array<number>(groups.length);
  for (const [b, idx] of byBeat) {
    const fr = idx.map((i) => pos[i] - b);
    const err = (g: number) => fr.reduce((s, f) => s + Math.abs(f - Math.round(f * g) / g), 0);
    let g = idx.length >= 2 && err(3) < err(4) * 0.6 ? 3 : 4;
    let q = fr.map((f) => Math.round(f * g) / g);
    if (new Set(q).size < q.length) {
      g *= 2;
      q = fr.map((f) => Math.round(f * g) / g);
    }
    idx.forEach((i, k) => {
      snapped[i] = b + q[k];
      gridOf[i] = g;
    });
  }
  const noteOn = new Array<number>(notes.length);
  const noteGrid = new Array<number>(notes.length);
  groups.forEach((g, gi) =>
    g.idx.forEach((i) => {
      noteOn[i] = snapped[gi];
      noteGrid[i] = gridOf[gi];
    }),
  );
  const noteDur = notes.map((n, i) => {
    const off = beatPos(n.off, beats);
    const q4 = Math.round(off * 4) / 4;
    const q3 = Math.round(off * 3) / 3;
    const q = Math.abs(off - q3) < Math.abs(off - q4) * 0.6 ? q3 : q4;
    return Math.max(1 / noteGrid[i], q - noteOn[i]);
  });

  // time signature and the first downbeat
  const firstOn = Math.min(...snapped);
  // beats split in three far more often than in two: compound time (12/8, 9/8, 6/8), a beat being a dotted quarter
  let thirds = 0;
  let halves = 0;
  for (const [b, idx] of byBeat) {
    if (!idx.some((i) => Math.abs(snapped[i] - b) > 1e-6 && Math.abs(snapped[i] - b - 1) > 1e-6)) continue;
    if (gridOf[idx[0]] % 3 === 0) thirds++;
    else halves++;
  }
  const forced = opts.timeSig;
  const compound = forced ? forced[1] === 8 && forced[0] % 3 === 0 : thirds >= 4 && thirds >= 2 * halves;
  const beatLen = compound ? 1.5 : 1;
  const { meter, phase } = guessMeter(
    groups.map((g, gi) => ({
      t: snapped[gi],
      bass: hands ? g.idx.some((i) => hands[i] === 'L') : g.idx.length > 1 && Math.min(...g.idx.map((i) => notes[i].pitch)) < 57,
      size: g.idx.length,
      long: Math.max(...g.idx.map((i) => noteDur[i])),
    })),
    forced ? (forced[0] * 4) / forced[1] / beatLen : undefined,
  );
  const ph = phase + (opts.shift ?? 0);
  const downbeat = ph + meter * Math.floor((firstOn - ph) / meter);
  const period = median(beats.slice(1).map((b, i) => b - beats[i]));
  // the piece is written in quarter notes: a compound beat is one and a half of them
  const bpm = Math.round(((60 * beatLen) / (period * (opts.speed ?? 1))) * 10) / 10;
  const out: TranscribedNote[] = notes.map((n, i) => ({ pitch: n.pitch, t: (noteOn[i] - downbeat) * beatLen, dur: noteDur[i] * beatLen, hand: hands ? hands[i] : null }));
  out.sort((a, b) => a.t - b.t || a.pitch - b.pitch);
  const last = Math.max(...out.map((n) => n.t + n.dur));
  const timeSig: [number, number] = forced ?? (compound ? [meter * 3, 8] : [meter, 4]);
  return { notes: out, bpm, timeSig, hands: hands ? 'color' : 'none', measures: Math.ceil(last / (meter * beatLen) - 1e-6) };
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
