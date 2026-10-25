/**
 * The fallback for videos without a lit keyboard: listen instead of look.
 * Spotify's Basic Pitch (a small neural network, Apache-2.0) turns piano
 * audio into notes in the browser. It hears the notes but not which hand
 * played them, and it makes mistakes, so its result is a draft. The network
 * and TensorFlow.js load only when this is used.
 */
import type { BasicPitch } from '@spotify/basic-pitch';
import type { RawNote } from './tracker';

/** Basic Pitch listens at 22.05 kHz, mono. */
const RATE = 22050;
/** Served next to the page (see vite.config.ts). */
const MODEL = 'models/basic-pitch/model.json';
/** Shortest note kept, in model frames (about 86 a second): ~130 ms, Basic Pitch's own default. */
const MIN_FRAMES = 11;

/** Mono samples at 22.05 kHz from an audio or video file, or a recording. */
export async function decodeAudio(data: ArrayBuffer): Promise<Float32Array> {
  // decoding in a context of the target rate resamples on the way
  const ctx = new OfflineAudioContext(1, 1, RATE);
  const buf = await ctx.decodeAudioData(data);
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
  }
  return out;
}

/** Notes heard in the samples. `progress` gets 0–1. */
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
