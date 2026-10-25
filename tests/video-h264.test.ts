/**
 * The recognition on real compressed video: synthetic frames encoded with
 * H.264 (YouTube's codec) by ffmpeg and decoded back. Skipped where ffmpeg is
 * not installed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { libraryScore } from '../src/library';
import { parseMidi } from '../src/score/midi';
import { beatsToSeconds } from '../src/score/model';
import { detectKeyboard } from '../src/video/keyboard';
import { syntheticVideo, type SynthNote } from '../src/video/synthetic';
import { KeyTracker } from '../src/video/tracker';
import { toMidi, transcribe } from '../src/video/transcribe';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const dir = hasFfmpeg ? mkdtempSync(join(tmpdir(), 'koimidi-h264-')) : '';
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

async function roundTrip(notes: SynthNote[], W: number, H: number, bitrate: string): Promise<{ frames: Uint8ClampedArray[]; fps: number }> {
  const fps = 30;
  const v = syntheticVideo(notes, { width: W, height: H, felt: true });
  const file = join(dir, `${W}x${H}.mp4`);
  const enc = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', bitrate, '-pix_fmt', 'yuv420p', file]);
  const end = Math.max(...notes.map((n) => n.off)) + 1;
  for (let i = 0; i / fps <= end; i++) {
    if (!enc.stdin.write(Buffer.from(v.frameAt(i / fps).data.buffer))) await new Promise((r) => enc.stdin.once('drain', r));
  }
  enc.stdin.end();
  await new Promise((r) => enc.on('close', r));
  const raw = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 2 ** 32 }).stdout;
  const size = W * H * 4;
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; (i + 1) * size <= raw.length; i++) frames.push(new Uint8ClampedArray(raw.buffer, raw.byteOffset + i * size, size));
  return { frames, fps };
}

function notesOf(id: string, gate: number): SynthNote[] {
  const s = libraryScore(id);
  return s.notes.map((n) => {
    const on = 1 + beatsToSeconds(s, n.t);
    return { pitch: n.pitch, on, off: on + (beatsToSeconds(s, n.t + n.dur) + 1 - on) * gate, hand: n.hand };
  });
}

describe.skipIf(!hasFfmpeg)('recognition of H.264 video', () => {
  for (const [id, W, H, bitrate, gate] of [
    ['ode-to-joy', 1280, 720, '1500k', 0.85],
    ['twinkle', 640, 360, '350k', 1],
  ] as const) {
    it(`${id} at ${H}p, ${bitrate}: every note, the hands and the bars`, async () => {
      const notes = notesOf(id, gate);
      const { frames, fps } = await roundTrip(notes, W, H, bitrate);
      const frame = (i: number) => ({ width: W, height: H, data: frames[i] });
      const layout = detectKeyboard(frame(15))!;
      expect(layout.keys.length).toBe(88);
      const tracker = new KeyTracker(layout, frame(15));
      frames.forEach((_, i) => tracker.push(frame(i), i / fps));
      const raw = tracker.finish();
      expect(raw.length).toBe(notes.length);
      const s = libraryScore(id);
      const back = parseMidi(toMidi(transcribe(raw), s.title), 'x', 'x.mid');
      const shape = (sc: typeof s) => sc.notes.map((n) => `${n.hand}${n.pitch}@${Math.round(n.t * 24) / 24}`).sort();
      const got = new Set(shape(back));
      const want = shape(s);
      expect(want.filter((x) => got.has(x)).length / want.length).toBeGreaterThanOrEqual(0.97);
    }, 60000);
  }
});
