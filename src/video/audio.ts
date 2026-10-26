/**
 * Recognition by ear: listen instead of look. A piano is heard by Magenta's
 * Onsets and Frames (see onsets-frames.ts), trained on piano only and sure of
 * its notes; any other instrument by Spotify's Basic Pitch (a small network,
 * Apache-2.0), which hears anything but gets more notes wrong, often an octave
 * too high. Neither knows which hand played, so the importer splits the hands
 * by pitch. The networks and TensorFlow.js load only when they are used.
 */
import type { BasicPitch } from '@spotify/basic-pitch';
import { loadOnsetsFrames, PIANO_RATE, type OnsetsAndFrames } from './onsets-frames';
import type { RawNote } from './tracker';

export { PIANO_RATE };
/** Basic Pitch listens at 22.05 kHz, mono. */
export const RATE = 22050;
/** Served next to the page (see vite.config.ts). */
const MODEL = 'models/basic-pitch/model.json';
/** In public/, built by scripts/build-onsets-frames.mjs. */
const PIANO_MODEL = 'models/onsets-frames/';
/** Shortest note kept, in model frames (about 86 a second): ~130 ms, Basic Pitch's own default. */
const MIN_FRAMES = 11;

/** Mono samples at `rate` (Basic Pitch's by default) from an audio or video file, or a recording. */
export async function decodeAudio(data: ArrayBuffer, rate = RATE): Promise<Float32Array> {
  // decoding in a context of the target rate resamples on the way
  const ctx = new OfflineAudioContext(1, 1, rate);
  const buf = await ctx.decodeAudioData(data);
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
  }
  return out;
}

let piano: Promise<OnsetsAndFrames> | null = null;

/**
 * Notes of a piano heard in samples at PIANO_RATE. The weights (11 MB) are
 * fetched the first time, `loading` hears the bytes (got, total); `progress`
 * gets 0–1 while listening.
 */
export async function listenPiano(samples: Float32Array, progress: (p: number) => void, loading: (got: number, total: number) => void): Promise<RawNote[]> {
  if (!piano) {
    const tf = await import('@tensorflow/tfjs');
    piano = loadOnsetsFrames(tf, new URL(PIANO_MODEL, document.baseURI).href, loading).catch((e: unknown) => {
      piano = null;
      throw e;
    });
  }
  return (await piano).notes(samples, progress);
}

/** Notes of any instrument heard in samples at RATE, by Basic Pitch. `progress` gets 0–1. */
export async function listen(samples: Float32Array, progress: (p: number) => void): Promise<RawNote[]> {
  const { BasicPitch } = await import('@spotify/basic-pitch');
  return listenWith(new BasicPitch(new URL(MODEL, document.baseURI).href), samples, progress);
}

/** The notes a Basic Pitch hears (the benchmark brings one with the network read from disk). */
export async function listenWith(bp: BasicPitch, samples: Float32Array, progress: (p: number) => void): Promise<RawNote[]> {
  const { outputToNotesPoly, noteFramesToTime } = await import('@spotify/basic-pitch');
  const frames: number[][] = [];
  const onsets: number[][] = [];
  await bp.evaluateModel(
    samples,
    (f, o) => {
      frames.push(...f);
      onsets.push(...o);
    },
    progress,
  );
  const notes = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.5, 0.3, MIN_FRAMES));
  // no colour: the hands are split by pitch on import
  return notes.map((n) => ({ pitch: n.pitchMidi, on: n.startTimeSeconds, off: n.startTimeSeconds + n.durationSeconds, color: [128, 128, 128] }));
}

/** The sound of a captured tab, recorded until `stop`. */
export class AudioTake {
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  private started = performance.now();

  constructor(stream: MediaStream) {
    this.rec = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { audioBitsPerSecond: 128000 });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
  }

  /** Seconds recorded so far. */
  get seconds(): number {
    return (performance.now() - this.started) / 1000;
  }

  stop(): Promise<ArrayBuffer> {
    return new Promise((resolve) => {
      this.rec.onstop = () => void new Blob(this.chunks, { type: this.rec.mimeType }).arrayBuffer().then(resolve);
      if (this.rec.state === 'inactive') this.rec.onstop(new Event('stop'));
      else this.rec.stop();
    });
  }
}
