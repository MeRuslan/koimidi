/**
 * What the benchmark measures: the same recognition as the "From a video"
 * screen (the keyboard found in a few probes, the keys followed frame by
 * frame, notes to beats and bars), fed by ffmpeg exactly as the app's grabber
 * would (frames at most 960 pixels wide, only the rows the tracker reads),
 * scored against the library piece whose melody the video plays.
 *
 * The score is a fit of the library melody (the top note of each right-hand
 * onset) into the recognised melody, at whatever transposition matches most
 * notes: found notes, wrong and extra notes, hands on the found notes, the
 * rhythm (intervals between neighbouring found notes), and the bars (the bar
 * count moving together). Arrangements differ from the library, so the
 * numbers are a proxy; the alignment is written out to be looked at.
 *
 * With --audio recognition by ear is measured instead: Basic Pitch on the
 * video's sound (--piano: the app's Onsets and Frames), the hands as the
 * importer splits a one-track MIDI (below middle C to the left when the notes
 * span both registers).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { libraryScore } from '../../src/library';
import { measureAt, type Hand } from '../../src/score/model';
import type { BasicPitch } from '@spotify/basic-pitch';
import { listenWith } from '../../src/video/audio';
import { KeyboardFinder } from '../../src/video/finder';
import type { Frame } from '../../src/video/frame';
import { detectKeyboards, type KeyboardLayout } from '../../src/video/keyboard';
import { KeyTracker, playable, type RawNote } from '../../src/video/tracker';
import { octaveHint, transcribe, type Transcribed, type TranscribedNote } from '../../src/video/transcribe';
import { PIANO_RATE, type OnsetsAndFrames } from '../../src/video/onsets-frames';
import { basicPitchFromDisk, onsetsFramesFromDisk, samplesOf } from './basic-pitch-node';

/** The app's grabber scales frames to at most this wide. */
const MAX_W = 960;

interface TimedFrame extends Frame {
  t: number;
}

interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** Frame size after the grabber's scaling. */
  W: number;
  H: number;
}

function probeVideo(file: string): VideoInfo {
  const out = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`ffprobe failed on ${file}: ${out.stderr}`);
  const j = JSON.parse(out.stdout) as { streams: Record<string, unknown>[]; format: { duration?: string } };
  const s = j.streams[0] as {
    width: number;
    height: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    duration?: string;
    tags?: { rotate?: string };
    side_data_list?: { rotation?: number }[];
  };
  let w = s.width;
  let h = s.height;
  const rot = Math.abs(Number(s.tags?.rotate ?? s.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0));
  if (rot % 180 === 90) [w, h] = [h, w];
  const rate = s.avg_frame_rate && s.avg_frame_rate !== '0/0' ? s.avg_frame_rate : (s.r_frame_rate ?? '30');
  const [a, b] = rate.split('/').map(Number);
  const fps = b ? a / b : a;
  const duration = Number(s.duration ?? j.format.duration ?? 0);
  const scale = Math.min(1, MAX_W / w);
  return { width: w, height: h, fps, duration, W: Math.max(1, Math.round(w * scale)), H: Math.max(1, Math.round(h * scale)) };
}

/**
 * Frames decoded by ffmpeg from `start`, scaled like the grabber, optionally
 * only some rows (the band the tracker reads) and at a lower frame rate (the
 * probes while looking for the keyboard). Times are on the file's clock.
 */
async function* frames(file: string, v: VideoInfo, o: { start: number; span?: number; fps?: number; rows?: { top: number; height: number } }): AsyncGenerator<TimedFrame> {
  const vf = [o.fps ? `fps=${o.fps}` : '', `scale=${v.W}:${v.H}`, o.rows ? `crop=${v.W}:${o.rows.height}:0:${o.rows.top}` : ''].filter(Boolean).join(',');
  const args = ['-v', 'error', '-nostdin', '-ss', String(o.start), ...(o.span ? ['-t', String(o.span)] : []), '-i', file, '-vf', vf, ...(o.fps ? [] : ['-fps_mode', 'cfr']), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'];
  // stderr dropped: stopping early (the keyboard found) makes ffmpeg complain about a broken pipe
  const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  const width = v.W;
  const height = o.rows ? o.rows.height : v.H;
  const size = width * height * 4;
  const rate = o.fps ?? v.fps;
  let pending: Buffer[] = [];
  let len = 0;
  let i = 0;
  try {
    for await (const chunk of p.stdout as AsyncIterable<Buffer>) {
      pending.push(chunk);
      len += chunk.length;
      if (len < size) continue;
      const all = pending.length === 1 ? pending[0] : Buffer.concat(pending);
      let off = 0;
      while (off + size <= all.length) {
        yield { width, height, data: new Uint8ClampedArray(all.buffer, all.byteOffset + off, size), t: o.start + i / rate };
        i++;
        off += size;
      }
      pending = off < all.length ? [all.subarray(off)] : [];
      len = all.length - off;
    }
  } finally {
    p.kill();
  }
}

interface Found {
  layout: KeyboardLayout;
  calib: Frame;
  foundAt: number;
  probe: number;
}

/** As the app: the first seconds, then a few places further on, with the app's own finder. */
async function findKeyboard(file: string, v: VideoInfo): Promise<Found | null> {
  const probes = [0];
  if (v.duration > 30) probes.push(...[0.15, 0.35, 0.55, 0.75].map((f) => v.duration * f));
  const finder = new KeyboardFinder();
  for (let i = 0; i < probes.length; i++) {
    for await (const g of frames(file, v, { start: probes[i], span: i === 0 ? 14 : 1.5, fps: 5 })) {
      const found = finder.offer(g, g.t);
      if (found) return { layout: found.layout, calib: found.calib, foundAt: g.t, probe: i };
      // as the app: the first look lasts six seconds, or longer while two keyboards are in sight and neither has lit up
      if (i === 0 && g.t - probes[i] >= 6 && !finder.rivalry) break;
    }
    const found = finder.settle();
    if (found) return { layout: found.layout, calib: found.calib, foundAt: found.t, probe: i };
  }
  return null;
}

/** As the app: from a little before the keyboard appeared (or the start), only the tracker's rows. */
async function record(file: string, v: VideoInfo, found: Found): Promise<{ raw: RawNote[]; tracker: KeyTracker }> {
  const start = found.probe === 0 ? Math.max(0, found.foundAt - 3) : 0;
  const tracker = new KeyTracker(found.layout, found.calib);
  const band = tracker.band;
  const trace = process.env.BENCH_TRACE ? { t: -1e9 } : null;
  for await (const g of frames(file, v, { start, rows: { top: band.top, height: band.bottom - band.top + 1 } })) {
    tracker.push(g, g.t, band.top);
    if (trace && g.t - trace.t >= 2) {
      trace.t = g.t;
      console.log(`  t=${g.t.toFixed(1)} lit=${tracker.lit().length}/${found.layout.keys.length}`);
    }
  }
  return { raw: tracker.finish(), tracker };
}

/* ---------- scoring ---------- */

interface MelodyNote {
  pitch: number;
  t: number;
  hand: Hand | null;
  bar: number;
}

/** The top note of every onset. */
function skyline(notes: { pitch: number; t: number; hand: Hand | null }[], bar: (t: number) => number): MelodyNote[] {
  const sorted = [...notes].sort((a, b) => a.t - b.t || b.pitch - a.pitch);
  const out: MelodyNote[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(n.t - last.t) < 0.02) continue;
    out.push({ pitch: n.pitch, t: n.t, hand: n.hand, bar: bar(n.t) });
  }
  return out;
}

type Op = { op: '=' | '~'; i: number; j: number } | { op: '-'; i: number } | { op: '+'; j: number };

interface Fit {
  k: number;
  score: number;
  ops: Op[];
  pairs: [number, number][];
  subs: number;
  missed: number;
  extra: number;
}

/** The library melody fitted into the recognised one (its ends free), transposed by k. */
function fit(lib: number[], rec: number[], k: number): Fit {
  const m = lib.length;
  const n = rec.length;
  const MATCH = 2;
  const MIS = -1;
  const GAP = -1;
  const S = new Float64Array((m + 1) * (n + 1));
  const B = new Uint8Array((m + 1) * (n + 1));
  const at = (i: number, j: number) => i * (n + 1) + j;
  for (let i = 1; i <= m; i++) {
    S[at(i, 0)] = i * GAP;
    B[at(i, 0)] = 2;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const d = S[at(i - 1, j - 1)] + (lib[i - 1] + k === rec[j - 1] ? MATCH : MIS);
      const u = S[at(i - 1, j)] + GAP;
      const l = S[at(i, j - 1)] + GAP;
      let s = d;
      let b = 1;
      if (u > s) {
        s = u;
        b = 2;
      }
      if (l > s) {
        s = l;
        b = 3;
      }
      S[at(i, j)] = s;
      B[at(i, j)] = b;
    }
  }
  let j = 0;
  for (let jj = 1; jj <= n; jj++) if (S[at(m, jj)] > S[at(m, j)]) j = jj;
  const score = S[at(m, j)];
  const ops: Op[] = [];
  const pairs: [number, number][] = [];
  let subs = 0;
  let missed = 0;
  let extra = 0;
  let i = m;
  while (i > 0) {
    const b = B[at(i, j)];
    if (b === 1) {
      if (lib[i - 1] + k === rec[j - 1]) {
        pairs.push([i - 1, j - 1]);
        ops.push({ op: '=', i: i - 1, j: j - 1 });
      } else {
        subs++;
        ops.push({ op: '~', i: i - 1, j: j - 1 });
      }
      i--;
      j--;
    } else if (b === 2) {
      missed++;
      ops.push({ op: '-', i: i - 1 });
      i--;
    } else {
      extra++;
      ops.push({ op: '+', j: j - 1 });
      j--;
    }
  }
  ops.reverse();
  pairs.reverse();
  return { k, score, ops, pairs, subs, missed, extra };
}

function bestFit(lib: number[], rec: number[]): Fit {
  let best: Fit | null = null;
  if (!rec.length) return { k: 0, score: -lib.length, ops: lib.map((_, i) => ({ op: '-', i })), pairs: [], subs: 0, missed: lib.length, extra: 0 };
  for (let k = -36; k <= 36; k++) {
    const f = fit(lib, rec, k);
    if (!best || f.score > best.score || (f.score === best.score && Math.abs(k) < Math.abs(best.k))) best = f;
  }
  return best!;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const name = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;

export interface Metrics {
  /** Library melody notes found (share), extra notes and wrong notes within the fitted stretch (shares of the melody length). */
  found: number;
  extra: number;
  wrong: number;
  /** Melody notes found among all the notes (either hand) that went to the right hand; null when the hands were not told apart. */
  hands: number | null;
  /** Neighbouring found notes the same distance apart as in the library, at whatever note value the beat was written. */
  rhythm: number;
  /** Bar lines between neighbouring found notes: the library's found again and the found ones right, as an F-score. */
  bars: number;
  /** Semitones the recognised melody sits above the library's. */
  transposition: number;
  /** Recognised beats per library beat, by the median interval ratio (2 = beats at eighths). */
  beatFactor: number;
  libNotes: number;
  recNotes: number;
}

export function scoreAgainst(tr: Transcribed, piece: string): { metrics: Metrics; alignment: string; timing: string } {
  const s = libraryScore(piece);
  const lib = skyline(
    s.notes.filter((n) => n.hand === 'R').map((n) => ({ pitch: n.pitch, t: n.t, hand: n.hand })),
    (t) => measureAt(s, t),
  );
  const meter = (tr.timeSig[0] * 4) / tr.timeSig[1];
  const melodyNotes = tr.hands === 'color' ? tr.notes.filter((n) => n.hand === 'R') : tr.notes;
  const rec = skyline(melodyNotes, (t) => Math.floor(t / meter + 1e-6));
  const f = bestFit(
    lib.map((n) => n.pitch),
    rec.map((n) => n.pitch),
  );
  // neighbouring found notes: the same distance apart as in the library, whatever note value the
  // transcription chose for the beat (a piece written in eighths is not wrong, only written differently)
  const steps: { a: number; b: number; libCross: boolean; recCross: boolean }[] = [];
  for (let p = 0; p + 1 < f.pairs.length; p++) {
    const [i, j] = f.pairs[p];
    const [i2, j2] = f.pairs[p + 1];
    if (i2 !== i + 1 || j2 !== j + 1) continue;
    steps.push({ a: lib[i2].t - lib[i].t, b: rec[j2].t - rec[j].t, libCross: lib[i2].bar !== lib[i].bar, recCross: rec[j2].bar !== rec[j].bar });
  }
  const factor = median(steps.filter((s) => s.a > 0).map((s) => s.b / s.a)) || 1;
  const rhythmOk = steps.filter((s) => Math.abs(s.b / factor - s.a) <= 0.13 * Math.max(1, s.a)).length;
  // bar lines: those of the library found again, and those found that the library has (as an F-score)
  const both = steps.filter((s) => s.libCross && s.recCross).length;
  const libCross = steps.filter((s) => s.libCross).length;
  const recCross = steps.filter((s) => s.recCross).length;
  const barsF = both ? (2 * both) / (libCross + recCross) : 0;
  // hands: the melody fitted into the top line of all the notes, whichever hand they went to (the fit
  // above sees the right hand only), and the share of the notes found there that went to the right hand
  let hands: number | null = null;
  if (tr.hands === 'color') {
    const all = skyline(tr.notes, (t) => Math.floor(t / meter + 1e-6));
    const fa = bestFit(
      lib.map((n) => n.pitch),
      all.map((n) => n.pitch),
    );
    hands = fa.pairs.length ? fa.pairs.filter(([, j]) => all[j].hand === 'R').length / fa.pairs.length : null;
  }
  const metrics: Metrics = {
    found: f.pairs.length / lib.length,
    extra: f.extra / lib.length,
    wrong: f.subs / lib.length,
    hands,
    rhythm: steps.length ? rhythmOk / steps.length : 0,
    bars: barsF,
    transposition: f.k,
    beatFactor: factor,
    libNotes: lib.length,
    recNotes: rec.length,
  };
  const alignment = f.ops
    .map((o) => {
      if (o.op === '=') return name(lib[o.i].pitch);
      if (o.op === '~') return `[${name(lib[o.i].pitch)}>${name(rec[o.j].pitch - f.k)}]`;
      if (o.op === '-') return `-${name(lib[o.i].pitch)}`;
      return `+${name(rec[o.j].pitch - f.k)}`;
    })
    .join(' ');
  // the found notes side by side in beats, to see where the rhythm or the bars go wrong
  const timing = f.pairs
    .map(([i, j], p) => {
      const next = f.pairs[p + 1];
      const flag = next && next[0] === i + 1 && next[1] === j + 1 && Math.abs(rec[next[1]].t - rec[j].t - (lib[next[0]].t - lib[i].t)) > 0.13 ? ' <<' : '';
      return `${name(lib[i].pitch).padEnd(4)} lib ${lib[i].t.toFixed(2).padStart(6)} bar ${String(lib[i].bar).padStart(3)} | rec ${rec[j].t.toFixed(2).padStart(7)} bar ${String(rec[j].bar).padStart(3)} ${rec[j].hand ?? '-'}${flag}`;
    })
    .join('\n');
  return { metrics, alignment, timing };
}

/* ---------- one video ---------- */

export interface Entry {
  id: string;
  file: string;
  piece: string;
  title?: string;
  channel?: string;
  note?: string;
}

export interface Result {
  id: string;
  /** What was recognised: the picture (default) or the sound. */
  source?: 'video' | 'audio';
  /** By ear: seconds of sound and notes heard before transcription. */
  audio?: { seconds: number; heard: number };
  piece: string;
  title?: string;
  channel?: string;
  note?: string;
  video: { width: number; height: number; fps: number; duration: number };
  keyboard: { keys: number; low: string; high: string; octaveSure: boolean; foundAt: number; probe: number; top: number; bottom: number } | null;
  tracker: { frames: number; skipped: number; speed: number | null; raw: number; playable: boolean } | null;
  transcribed: { notes: number; bpm: number; timeSig: string; hands: string; measures: number; octave: number } | null;
  metrics: Metrics | null;
  /** By ear: every note heard against every note the picture read, where the picture is trusted. */
  notes?: NoteMetrics | null;
  alignment: string;
  seconds: number;
}

/* ---------- all the notes, against the picture ---------- */

/**
 * The melody is a proxy (arrangements differ from the library); where the
 * keys light up and the picture got the melody right, its notes are close to
 * what was played, both hands, so the sound can be checked note by note.
 */
export interface PictureRef {
  notes: { pitch: number; on: number; off: number }[];
  low: number;
  high: number;
  /** The keyboard did not show its octave: the picture's notes may sit whole octaves off. */
  octaveSure: boolean;
}

export interface NoteMetrics {
  /** Notes heard that the picture has too (the same key, onsets within NOTE_TOL once the two clocks are lined up), and notes of the picture heard. */
  precision: number;
  recall: number;
  f1: number;
  /** Shares of the notes heard that the picture lacks: an octave, two, or a twelfth (a harmonic) away from a note struck at that moment, a semitone or two away, the same key struck again while the picture holds it, anything else. */
  harmonic: number;
  near: number;
  again: number;
  other: number;
  /** Seconds the sound runs ahead of the picture, and semitones the picture was moved (a keyboard that did not show its octave). */
  lag: number;
  shift: number;
  ref: number;
  heard: number;
}

const NOTE_TOL = 0.07;
const NOTE_NAME = /^([A-G]#?)(-?\d+)$/;
const midiOf = (s: string) => {
  const m = NOTE_NAME.exec(s);
  return m ? NAMES.indexOf(m[1]) + 12 * (Number(m[2]) + 1) : NaN;
};

/** The picture's notes from its run (`summary.json` and `<id>.raw.json`), only for videos where it found ≥ 90% of the melody with ≤ 5% wrong. */
export function loadPicture(dir: string): Map<string, PictureRef> {
  const out = new Map<string, PictureRef>();
  for (const r of JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as Result[]) {
    const m = r.metrics;
    const file = join(dir, `${r.id}.raw.json`);
    if (!m || !r.keyboard || !r.transcribed || r.tracker?.playable === false || m.found < 0.9 || m.wrong > 0.05 || !existsSync(file)) continue;
    const shift = 12 * (r.transcribed.octave ?? 0);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as RawNote[];
    out.set(r.id, { notes: raw.map((n) => ({ pitch: n.pitch + shift, on: n.on, off: n.off })), low: midiOf(r.keyboard.low) + shift, high: midiOf(r.keyboard.high) + shift, octaveSure: r.keyboard.octaveSure });
  }
  return out;
}

/** Pairs of the same key within the tolerance, earliest first; `match[j]` is the reference note for heard note j, or -1. */
function matchNotes(ref: { pitch: number; on: number }[], est: { pitch: number; on: number }[], lag: number): Int32Array {
  const match = new Int32Array(est.length).fill(-1);
  const byPitch = new Map<number, { r: number[]; e: number[] }>();
  const slot = (p: number) => byPitch.get(p) ?? byPitch.set(p, { r: [], e: [] }).get(p)!;
  ref.forEach((n, i) => slot(n.pitch).r.push(i));
  est.forEach((n, j) => slot(n.pitch).e.push(j));
  for (const { r, e } of byPitch.values()) {
    r.sort((a, b) => ref[a].on - ref[b].on);
    e.sort((a, b) => est[a].on - est[b].on);
    let i = 0;
    let j = 0;
    while (i < r.length && j < e.length) {
      const d = est[e[j]].on - lag - ref[r[i]].on;
      if (Math.abs(d) <= NOTE_TOL) match[e[j++]] = r[i++];
      else if (d < 0) j++;
      else i++;
    }
  }
  return match;
}

export function againstPicture(picture: PictureRef, raw: RawNote[]): NoteMetrics {
  let best: NoteMetrics | null = null;
  for (const shift of picture.octaveSure ? [0] : [-24, -12, 0, 12, 24]) {
    const moved = { ...picture, notes: picture.notes.map((n) => ({ ...n, pitch: n.pitch + shift })), low: picture.low + shift, high: picture.high + shift };
    const m = { ...againstNotes(moved, raw), shift };
    if (!best || m.precision * m.heard > best.precision * best.heard) best = m;
  }
  return best!;
}

function againstNotes(pic: PictureRef, raw: RawNote[]): NoteMetrics {
  // only the keys the picture could see, and only while it was looking (a second either side)
  const ref = pic.notes;
  const first = Math.min(...ref.map((n) => n.on));
  const last = Math.max(...ref.map((n) => n.on));
  const heardAt = (lag: number) => raw.filter((n) => n.pitch >= pic.low && n.pitch <= pic.high && n.on - lag >= first - 1 && n.on - lag <= last + 1);
  const count = (lag: number) => matchNotes(ref, heardAt(lag), lag).reduce((a, m) => a + (m >= 0 ? 1 : 0), 0);
  // the clocks lined up: coarsely over two seconds either way (some uploads shift the sound), then to the hundredth
  let best = { lag: 0, n: -1 };
  for (let lag = -2; lag <= 2 + 1e-9; lag += 0.05) {
    const n = count(lag);
    if (n > best.n) best = { lag, n };
  }
  const coarse = best.lag;
  for (let lag = coarse - 0.05; lag <= coarse + 0.05 + 1e-9; lag += 0.01) {
    const n = count(lag);
    if (n > best.n) best = { lag, n };
  }
  const lag = best.lag;
  const est = heardAt(lag);
  const match = matchNotes(ref, est, lag);
  let harmonic = 0;
  let near = 0;
  let again = 0;
  let other = 0;
  est.forEach((n, j) => {
    if (match[j] >= 0) return;
    const t = n.on - lag;
    const at = ref.filter((r) => Math.abs(t - r.on) <= NOTE_TOL).map((r) => n.pitch - r.pitch);
    if (at.some((d) => [12, -12, 24, -24, 19].includes(d))) harmonic++;
    else if (at.some((d) => Math.abs(d) <= 2)) near++;
    else if (ref.some((r) => r.pitch === n.pitch && r.on < t && r.off + NOTE_TOL > t)) again++;
    else other++;
  });
  const tp = best.n;
  const precision = est.length ? tp / est.length : 0;
  const recall = ref.length ? tp / ref.length : 0;
  return {
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    harmonic: est.length ? harmonic / est.length : 0,
    near: est.length ? near / est.length : 0,
    again: est.length ? again / est.length : 0,
    other: est.length ? other / est.length : 0,
    lag: Math.round(lag * 100) / 100,
    shift: 0,
    ref: ref.length,
    heard: est.length,
  };
}

/** A frame with the detected keys marked, as a PNG, to see what the detector saw. */
function savePicture(layout: KeyboardLayout, f: Frame, path: string): void {
  const data = new Uint8ClampedArray(f.data);
  const dot = (x: number, y: number, c: [number, number, number]) => {
    for (let yy = Math.round(y) - 1; yy <= Math.round(y) + 1; yy++) {
      for (let xx = Math.round(x) - 1; xx <= Math.round(x) + 1; xx++) {
        if (xx < 0 || yy < 0 || xx >= f.width || yy >= f.height) continue;
        const i = (yy * f.width + xx) * 4;
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
      }
    }
  };
  for (const k of layout.keys) {
    dot(k.x, k.y, k.black ? [255, 80, 80] : [255, 0, 0]);
    if (k.x2 !== undefined && k.y2 !== undefined) dot(k.x2, k.y2, [60, 120, 255]);
  }
  const L = layout;
  for (let x = Math.max(0, Math.round(L.left)); x < Math.min(f.width, Math.round(L.right)); x++) {
    dot(x, L.top, [0, 255, 0]);
    dot(x, L.bottom, [0, 200, 255]);
  }
  spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${f.width}x${f.height}`, '-i', '-', path], { input: Buffer.from(data.buffer) });
}

export async function benchOne(e: Entry, out?: string, peek?: number): Promise<Result> {
  const t0 = performance.now();
  const v = probeVideo(e.file);
  const res: Result = {
    id: e.id,
    piece: e.piece,
    title: e.title,
    channel: e.channel,
    note: e.note,
    video: { width: v.width, height: v.height, fps: Math.round(v.fps * 100) / 100, duration: Math.round(v.duration) },
    keyboard: null,
    tracker: null,
    transcribed: null,
    metrics: null,
    alignment: '',
    seconds: 0,
  };
  const found = await findKeyboard(e.file, v);
  if (!found) {
    res.seconds = (performance.now() - t0) / 1000;
    return res;
  }
  const L = found.layout;
  res.keyboard = {
    keys: L.keys.length,
    low: name(L.keys[0].pitch),
    high: name(L.keys[L.keys.length - 1].pitch),
    octaveSure: L.octaveSure,
    foundAt: Math.round(found.foundAt * 10) / 10,
    probe: found.probe,
    top: Math.round(L.top),
    bottom: Math.round(L.bottom),
  };
  if (out) savePicture(L, found.calib, join(out, `${e.id}.png`));
  if (out && peek !== undefined) {
    // one frame further on, with the same marks: to compare with the calibration frame
    for await (const g of frames(e.file, v, { start: peek, span: 0.2, fps: 5 })) {
      savePicture(L, g, join(out, `${e.id}.peek-${peek}.png`));
      break;
    }
  }
  const { raw, tracker } = await record(e.file, v, found);
  res.tracker = { frames: tracker.frames, skipped: tracker.skipped, speed: tracker.speed && Math.round(tracker.speed), raw: raw.length, playable: playable(raw) };
  if (out) writeFileSync(join(out, `${e.id}.raw.json`), JSON.stringify(raw));
  let tr = transcribe(raw);
  // as the app: a keyboard that did not say its octave is moved to where the piece's register says
  const octave = L.octaveSure ? 0 : octaveHint(tr.notes);
  if (octave) tr = { ...tr, notes: tr.notes.map((n) => ({ ...n, pitch: n.pitch + 12 * octave })) };
  res.transcribed = { notes: tr.notes.length, bpm: tr.bpm, timeSig: tr.timeSig.join('/'), hands: tr.hands, measures: tr.measures, octave };
  if (out) writeFileSync(join(out, `${e.id}.notes.json`), JSON.stringify(tr));
  const { metrics, alignment, timing } = scoreAgainst(tr, e.piece);
  res.metrics = metrics;
  res.alignment = alignment;
  if (out) writeFileSync(join(out, `${e.id}.timing.txt`), `${alignment}\n\n${timing}\n`);
  res.seconds = Math.round((performance.now() - t0) / 100) / 10;
  return res;
}

/** Hands as the importer gives a one-track MIDI (src/score/midi.ts, split 'auto'): below middle C to the left when the notes clearly span both registers. */
function importerHands(notes: TranscribedNote[]): Hand[] {
  const pitches = notes.map((n) => n.pitch);
  const lo = Math.min(...pitches);
  const hi = Math.max(...pitches);
  const below = pitches.filter((p) => p < 60).length / Math.max(1, pitches.length);
  const split = hi - lo >= 24 && below >= 0.25 && below <= 0.75;
  return pitches.map((p) => (split && p < 60 ? 'L' : 'R'));
}

/** What listens: Basic Pitch or Onsets and Frames as the app runs them, or the notes another model wrote for each video (`<id>.json` or `<id>.raw.json` with pitch, on, off in seconds). */
export type Ear = { kind: 'basic-pitch'; bp: BasicPitch } | { kind: 'piano'; model: OnsetsAndFrames } | { kind: 'notes'; dir: string };

function heardBy(ear: Ear, e: Entry, v: VideoInfo): Promise<{ raw: RawNote[]; seconds: number }> | { raw: RawNote[]; seconds: number } {
  if (ear.kind === 'basic-pitch') {
    const samples = samplesOf(e.file);
    return listenWith(ear.bp, samples, () => {}).then((raw) => ({ raw, seconds: samples.length / 22050 }));
  }
  if (ear.kind === 'piano') {
    const samples = samplesOf(e.file, PIANO_RATE);
    return ear.model.notes(samples).then((raw) => ({ raw, seconds: samples.length / PIANO_RATE }));
  }
  const file = [join(ear.dir, `${e.id}.json`), join(ear.dir, `${e.id}.raw.json`)].find((f) => existsSync(f));
  if (!file) throw new Error(`no notes for ${e.id} in ${ear.dir}`);
  const notes = JSON.parse(readFileSync(file, 'utf8')) as { pitch: number; on: number; off: number }[];
  return { raw: notes.map((n) => ({ pitch: n.pitch, on: n.on, off: n.off, color: [128, 128, 128] })), seconds: v.duration };
}

/** The fallback by ear on the video's sound, scored like the picture (and, given the picture's run, note by note against it). */
export async function benchAudio(e: Entry, out: string | undefined, ear: Ear, picture?: Map<string, PictureRef>): Promise<Result> {
  const t0 = performance.now();
  const v = probeVideo(e.file);
  const res: Result = {
    id: e.id,
    source: 'audio',
    piece: e.piece,
    title: e.title,
    channel: e.channel,
    note: e.note,
    video: { width: v.width, height: v.height, fps: Math.round(v.fps * 100) / 100, duration: Math.round(v.duration) },
    keyboard: null,
    tracker: null,
    transcribed: null,
    metrics: null,
    alignment: '',
    seconds: 0,
  };
  const { raw, seconds } = await heardBy(ear, e, v);
  res.audio = { seconds: Math.round(seconds), heard: raw.length };
  const ref = picture?.get(e.id);
  if (ref) res.notes = againstPicture(ref, raw);
  if (out) writeFileSync(join(out, `${e.id}.raw.json`), JSON.stringify(raw));
  const heard = transcribe(raw);
  const hands = importerHands(heard.notes);
  // scored as the app shows it after import: the right hand is the part above middle C (or everything)
  const tr: Transcribed = { ...heard, hands: 'color', notes: heard.notes.map((n, i) => ({ ...n, hand: hands[i] })) };
  res.transcribed = { notes: tr.notes.length, bpm: tr.bpm, timeSig: tr.timeSig.join('/'), hands: hands.includes('L') ? 'by pitch, split at C4' : 'by pitch, one hand', measures: tr.measures, octave: 0 };
  if (out) writeFileSync(join(out, `${e.id}.notes.json`), JSON.stringify(tr));
  const { metrics, alignment, timing } = scoreAgainst(tr, e.piece);
  res.metrics = metrics;
  res.alignment = alignment;
  if (out) writeFileSync(join(out, `${e.id}.timing.txt`), `${alignment}\n\n${timing}\n`);
  res.seconds = Math.round((performance.now() - t0) / 100) / 10;
  return res;
}

/* ---------- reporting ---------- */

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);

export function describe(r: Result): string {
  const lines = [`${r.id} · ${r.channel ?? ''} · ${r.title ?? ''} (${r.video.duration} s, ${r.video.width}x${r.video.height} @${r.video.fps})${r.note ? ` · ${r.note}` : ''}`];
  if (r.source === 'audio' && r.transcribed && r.metrics) {
    const tr = r.transcribed;
    lines.push(`  by ear: ${r.audio?.heard ?? 0} notes heard in ${r.audio?.seconds ?? 0} s of sound → ${tr.notes} notes, ${tr.timeSig}, ${tr.bpm} bpm, hands: ${tr.hands}, ${tr.measures} bars`);
    lines.push(melodyLine(r));
    if (r.notes) lines.push(notesLine(r.notes));
    lines.push(`  ${r.alignment}`);
    return lines.join('\n');
  }
  if (!r.keyboard) {
    lines.push('  no keyboard found');
    return lines.join('\n');
  }
  const k = r.keyboard;
  lines.push(`  keyboard: ${k.keys} keys ${k.low}–${k.high}${k.octaveSure ? '' : ' (octave guessed)'}, found at ${k.foundAt} s (probe ${k.probe}), rows ${k.top}–${k.bottom}`);
  const t = r.tracker!;
  const tr = r.transcribed!;
  lines.push(`  tracker: ${t.frames} frames, ${t.skipped} skipped, bar speed ${t.speed ?? '—'} px/s, ${t.raw} raw notes${t.playable ? '' : ' (NOT PLAYABLE: the app would offer to listen instead)'} → ${tr.notes} notes, ${tr.timeSig}, ${tr.bpm} bpm, hands: ${tr.hands}, ${tr.measures} bars${tr.octave ? `, moved ${tr.octave > 0 ? '+' : ''}${tr.octave} octave` : ''}`);
  lines.push(melodyLine(r));
  lines.push(`  ${r.alignment}`);
  return lines.join('\n');
}

function notesLine(n: NoteMetrics): string {
  return `  all notes vs the picture (${n.ref} there, ${n.heard} heard, sound ${n.lag >= 0 ? '+' : ''}${n.lag} s${n.shift ? `, picture moved ${n.shift > 0 ? '+' : ''}${n.shift}` : ''}): precision ${pct(n.precision)}, recall ${pct(n.recall)}, F1 ${pct(n.f1)} · not in the picture: harmonics ${pct(n.harmonic)}, a tone off ${pct(n.near)}, struck again ${pct(n.again)}, other ${pct(n.other)}`;
}

function melodyLine(r: Result): string {
  const m = r.metrics!;
  return `  melody ${m.libNotes} notes: found ${pct(m.found)}, wrong ${pct(m.wrong)}, extra ${pct(m.extra)} · hands ${pct(m.hands)} · rhythm ${pct(m.rhythm)} · bars ${pct(m.bars)} · transposed ${m.transposition >= 0 ? '+' : ''}${m.transposition} · beat ×${m.beatFactor.toFixed(2)} · ${r.seconds} s`;
}

export function table(results: Result[]): string {
  const head = '| video | piece | keys | found | wrong | extra | hands | rhythm | bars | time sig | bpm |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|';
  const rows = results.map((r) => {
    const who = `${r.channel ?? r.id}${r.note ? ` (${r.note})` : ''}`;
    if (r.source === 'audio' && r.metrics && r.transcribed) {
      const m = r.metrics;
      return `| ${who} | ${r.piece} | ear | ${pct(m.found)} | ${pct(m.wrong)} | ${pct(m.extra)} | ${pct(m.hands)} | ${pct(m.rhythm)} | ${pct(m.bars)} | ${r.transcribed.timeSig} | ${Math.round(r.transcribed.bpm)} |`;
    }
    if (!r.keyboard || !r.metrics || !r.transcribed) return `| ${who} | ${r.piece} | — | no keyboard | | | | | | | |`;
    if (r.tracker?.playable === false) return `| ${who} | ${r.piece} | ${r.keyboard.keys} | keys do not light up | | | | | | | |`;
    const m = r.metrics;
    return `| ${who} | ${r.piece} | ${r.keyboard.keys} | ${pct(m.found)} | ${pct(m.wrong)} | ${pct(m.extra)} | ${pct(m.hands)} | ${pct(m.rhythm)} | ${pct(m.bars)} | ${r.transcribed.timeSig} | ${Math.round(r.transcribed.bpm)} |`;
  });
  return [head, sep, ...rows].join('\n');
}

/** Means over the videos where a keyboard was found. */
export function summary(results: Result[]): string {
  const ok = results.filter((r) => r.metrics && r.tracker?.playable !== false);
  const mean = (f: (m: Metrics) => number | null) => {
    const xs = ok.map((r) => f(r.metrics!)).filter((x): x is number => x !== null);
    return xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null;
  };
  const line = `${ok.length}/${results.length} ${results.some((r) => r.source === 'audio') ? 'heard' : 'with lit keys'} · found ${pct(mean((m) => m.found))} · wrong ${pct(mean((m) => m.wrong))} · extra ${pct(mean((m) => m.extra))} · hands ${pct(mean((m) => m.hands))} · rhythm ${pct(mean((m) => m.rhythm))} · bars ${pct(mean((m) => m.bars))}`;
  const vs = results.map((r) => r.notes).filter((n): n is NoteMetrics => !!n);
  if (!vs.length) return line;
  const avg = (f: (n: NoteMetrics) => number) => vs.reduce((a, n) => a + f(n), 0) / vs.length;
  return `${line}\nall notes vs the picture on ${vs.length} videos · precision ${pct(avg((n) => n.precision))} · recall ${pct(avg((n) => n.recall))} · F1 ${pct(avg((n) => n.f1))} · heard but not there: harmonics ${pct(avg((n) => n.harmonic))}, a tone off ${pct(avg((n) => n.near))}, struck again ${pct(avg((n) => n.again))}, other ${pct(avg((n) => n.other))}`;
}

export function compare(before: Result[], after: Result[], labels: [string, string] = ['before', 'after']): string {
  const by = new Map(after.map((r) => [r.id, r]));
  const cell = (a: number | null | undefined, b: number | null | undefined) => (a === b ? pct(a) : `${pct(a)} → ${pct(b)}`);
  const rows = before.map((b) => {
    const a = by.get(b.id);
    if (!a) return `| ${b.channel ?? b.id} | ${b.piece} | missing in ${labels[1]} |`;
    const mb = b.tracker?.playable === false ? null : b.metrics;
    const ma = a.tracker?.playable === false ? null : a.metrics;
    return `| ${b.channel ?? b.id}${b.note ? ` (${b.note})` : ''} | ${b.piece} | ${cell(mb?.found, ma?.found)} | ${cell(mb?.wrong, ma?.wrong)} | ${cell(mb?.extra, ma?.extra)} | ${cell(mb?.hands, ma?.hands)} | ${cell(mb?.rhythm, ma?.rhythm)} | ${cell(mb?.bars, ma?.bars)} | ${b.transcribed?.timeSig ?? '—'}${a.transcribed?.timeSig !== b.transcribed?.timeSig ? ` → ${a.transcribed?.timeSig ?? '—'}` : ''} |`;
  });
  return ['| video | piece | found | wrong | extra | hands | rhythm | bars | time sig |', '|---|---|---|---|---|---|---|---|---|', ...rows, '', `${labels[0]}: ${summary(before)}`, `${labels[1]}: ${summary(after)}`].join('\n');
}

/* ---------- command line ---------- */

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(args: string[]): Promise<number> {
  // --rescore <out dir> --manifest list.json: the metrics again from the saved transcriptions (after a change to the scoring)
  const rescore = args.indexOf('--rescore');
  if (rescore >= 0) {
    const dir = args[rescore + 1];
    const results = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as Result[];
    for (const r of results) {
      const f = join(dir, `${r.id}.notes.json`);
      if (!r.transcribed || !existsSync(f)) continue;
      let tr = JSON.parse(readFileSync(f, 'utf8')) as Transcribed;
      const octave = r.transcribed.octave ?? (r.keyboard?.octaveSure ? 0 : octaveHint(tr.notes));
      if (octave) tr = { ...tr, notes: tr.notes.map((n) => ({ ...n, pitch: n.pitch + 12 * octave })) };
      r.transcribed.octave = octave;
      const { metrics, alignment, timing } = scoreAgainst(tr, r.piece);
      r.metrics = metrics;
      r.alignment = alignment;
      writeFileSync(join(dir, `${r.id}.timing.txt`), `${alignment}\n\n${timing}\n`);
    }
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(results, null, 1));
    writeFileSync(join(dir, 'report.md'), `${table(results)}\n\n${summary(results)}\n\n${results.map(describe).join('\n\n')}\n`);
    console.log(table(results));
    console.log('');
    console.log(summary(results));
    return 0;
  }
  // --detect <video> <seconds>: every keyboard the detector sees in that frame
  const det = args.indexOf('--detect');
  if (det >= 0) {
    const file = args[det + 1];
    const v = probeVideo(file);
    for await (const g of frames(file, v, { start: Number(args[det + 2]), span: 0.2, fps: 5 })) {
      const found = detectKeyboards(g);
      console.log(`${found.length} keyboard(s) at ${g.t.toFixed(1)} s in ${v.W}x${v.H}`);
      for (const k of found) console.log(`  ${k.keys.length} keys ${name(k.keys[0].pitch)}–${name(k.keys[k.keys.length - 1].pitch)}, rows ${Math.round(k.top)}–${Math.round(k.bottom)}, x ${Math.round(k.left)}–${Math.round(k.right)}, white ${k.whiteWidth.toFixed(1)} px, black seen ${k.blackSeen}`);
      break;
    }
    return 0;
  }
  const cmp = args.indexOf('--compare');
  if (cmp >= 0) {
    const before = JSON.parse(readFileSync(args[cmp + 1], 'utf8')) as Result[];
    const after = JSON.parse(readFileSync(args[cmp + 2], 'utf8')) as Result[];
    const labels = arg(args, '--labels')?.split(',');
    console.log(compare(before, after, labels && labels.length === 2 ? [labels[0], labels[1]] : undefined));
    return 0;
  }
  const out = arg(args, '--out');
  if (out) mkdirSync(out, { recursive: true });
  const peekArg = arg(args, '--peek');
  const peek = peekArg === undefined ? undefined : Number(peekArg);
  let entries: Entry[];
  const manifest = arg(args, '--manifest');
  if (manifest) {
    const list = JSON.parse(readFileSync(manifest, 'utf8')) as Entry[];
    const dir = dirname(resolve(manifest));
    entries = list.map((e) => ({ ...e, file: resolve(dir, e.file) }));
    const only = arg(args, '--only');
    if (only) {
      const ids = new Set(only.split(','));
      entries = entries.filter((e) => ids.has(e.id));
    }
  } else {
    const file = args.find((a) => !a.startsWith('--') && existsSync(a));
    const piece = arg(args, '--piece');
    if (!file || !piece) {
      console.error('usage: bench-video <video> --piece <library id> [--out dir] | --manifest list.json [--out dir] [--only id,id] | --compare a.json b.json');
      return 2;
    }
    entries = [{ id: basename(file).replace(/\.[^.]+$/, ''), file, piece }];
  }
  // --shard k/n: every n-th entry from the k-th, for several processes side by side
  const shard = arg(args, '--shard');
  if (shard) {
    const [k, n] = shard.split('/').map(Number);
    entries = entries.filter((_, i) => i % n === k);
  }
  // --notes <dir>: what another model heard, scored like the fallback by ear; --vs-picture <dir>: the picture's run, to check all the notes against
  const notesDir = arg(args, '--notes');
  const ear: Ear | null = notesDir
    ? { kind: 'notes', dir: notesDir }
    : args.includes('--piano')
      ? { kind: 'piano', model: await onsetsFramesFromDisk() }
      : args.includes('--audio')
        ? { kind: 'basic-pitch', bp: await basicPitchFromDisk() }
        : null;
  const vsPicture = arg(args, '--vs-picture');
  const picture = vsPicture ? loadPicture(vsPicture) : undefined;
  const results: Result[] = [];
  for (const e of entries) {
    try {
      const r = ear ? await benchAudio(e, out, ear, picture) : await benchOne(e, out, peek);
      results.push(r);
      console.log(describe(r));
    } catch (err) {
      console.error(`${e.id}: ${(err as Error).stack ?? err}`);
    }
    console.log('');
  }
  console.log(table(results));
  console.log('');
  console.log(summary(results));
  if (out) {
    writeFileSync(join(out, 'summary.json'), JSON.stringify(results, null, 1));
    writeFileSync(join(out, 'report.md'), `${table(results)}\n\n${summary(results)}\n\n${results.map(describe).join('\n\n')}\n`);
  }
  return 0;
}
