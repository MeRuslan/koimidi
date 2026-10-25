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
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { libraryScore } from '../../src/library';
import { measureAt, type Hand } from '../../src/score/model';
import { KeyboardFinder } from '../../src/video/finder';
import type { Frame } from '../../src/video/frame';
import { detectKeyboards, type KeyboardLayout } from '../../src/video/keyboard';
import { KeyTracker, playable, type RawNote } from '../../src/video/tracker';
import { octaveHint, transcribe, type Transcribed } from '../../src/video/transcribe';

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
  /** Found notes whose hand is the right hand; null when the hands were not told apart. */
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
  const metrics: Metrics = {
    found: f.pairs.length / lib.length,
    extra: f.extra / lib.length,
    wrong: f.subs / lib.length,
    hands: tr.hands === 'color' && f.pairs.length ? f.pairs.filter(([, j]) => rec[j].hand === 'R').length / f.pairs.length : null,
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
  piece: string;
  title?: string;
  channel?: string;
  note?: string;
  video: { width: number; height: number; fps: number; duration: number };
  keyboard: { keys: number; low: string; high: string; octaveSure: boolean; foundAt: number; probe: number; top: number; bottom: number } | null;
  tracker: { frames: number; skipped: number; speed: number | null; raw: number; playable: boolean } | null;
  transcribed: { notes: number; bpm: number; timeSig: string; hands: string; measures: number; octave: number } | null;
  metrics: Metrics | null;
  alignment: string;
  seconds: number;
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

/* ---------- reporting ---------- */

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);

export function describe(r: Result): string {
  const lines = [`${r.id} · ${r.channel ?? ''} · ${r.title ?? ''} (${r.video.duration} s, ${r.video.width}x${r.video.height} @${r.video.fps})${r.note ? ` · ${r.note}` : ''}`];
  if (!r.keyboard) {
    lines.push('  no keyboard found');
    return lines.join('\n');
  }
  const k = r.keyboard;
  lines.push(`  keyboard: ${k.keys} keys ${k.low}–${k.high}${k.octaveSure ? '' : ' (octave guessed)'}, found at ${k.foundAt} s (probe ${k.probe}), rows ${k.top}–${k.bottom}`);
  const t = r.tracker!;
  const tr = r.transcribed!;
  lines.push(`  tracker: ${t.frames} frames, ${t.skipped} skipped, bar speed ${t.speed ?? '—'} px/s, ${t.raw} raw notes${t.playable ? '' : ' (NOT PLAYABLE: the app would offer to listen instead)'} → ${tr.notes} notes, ${tr.timeSig}, ${tr.bpm} bpm, hands: ${tr.hands}, ${tr.measures} bars${tr.octave ? `, moved ${tr.octave > 0 ? '+' : ''}${tr.octave} octave` : ''}`);
  const m = r.metrics!;
  lines.push(
    `  melody ${m.libNotes} notes: found ${pct(m.found)}, wrong ${pct(m.wrong)}, extra ${pct(m.extra)} · hands ${pct(m.hands)} · rhythm ${pct(m.rhythm)} · bars ${pct(m.bars)} · transposed ${m.transposition >= 0 ? '+' : ''}${m.transposition} · beat ×${m.beatFactor.toFixed(2)} · ${r.seconds} s`,
  );
  lines.push(`  ${r.alignment}`);
  return lines.join('\n');
}

export function table(results: Result[]): string {
  const head = '| video | piece | keys | found | wrong | extra | hands | rhythm | bars | time sig | bpm |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|';
  const rows = results.map((r) => {
    const who = `${r.channel ?? r.id}${r.note ? ` (${r.note})` : ''}`;
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
  return `${ok.length}/${results.length} with lit keys · found ${pct(mean((m) => m.found))} · wrong ${pct(mean((m) => m.wrong))} · extra ${pct(mean((m) => m.extra))} · hands ${pct(mean((m) => m.hands))} · rhythm ${pct(mean((m) => m.rhythm))} · bars ${pct(mean((m) => m.bars))}`;
}

export function compare(before: Result[], after: Result[]): string {
  const by = new Map(after.map((r) => [r.id, r]));
  const cell = (a: number | null | undefined, b: number | null | undefined) => (a === b ? pct(a) : `${pct(a)} → ${pct(b)}`);
  const rows = before.map((b) => {
    const a = by.get(b.id);
    if (!a) return `| ${b.channel ?? b.id} | ${b.piece} | missing after |`;
    const mb = b.tracker?.playable === false ? null : b.metrics;
    const ma = a.tracker?.playable === false ? null : a.metrics;
    return `| ${b.channel ?? b.id}${b.note ? ` (${b.note})` : ''} | ${b.piece} | ${cell(mb?.found, ma?.found)} | ${cell(mb?.wrong, ma?.wrong)} | ${cell(mb?.extra, ma?.extra)} | ${cell(mb?.hands, ma?.hands)} | ${cell(mb?.rhythm, ma?.rhythm)} | ${cell(mb?.bars, ma?.bars)} | ${b.transcribed?.timeSig ?? '—'}${a.transcribed?.timeSig !== b.transcribed?.timeSig ? ` → ${a.transcribed?.timeSig ?? '—'}` : ''} |`;
  });
  return ['| video | piece | found | wrong | extra | hands | rhythm | bars | time sig |', '|---|---|---|---|---|---|---|---|---|', ...rows, '', `before: ${summary(before)}`, `after:  ${summary(after)}`].join('\n');
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
    console.log(compare(before, after));
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
  const results: Result[] = [];
  for (const e of entries) {
    try {
      const r = await benchOne(e, out, peek);
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
