/**
 * Onsets and Frames, Magenta's piano transcription network (Hawthorne et al.,
 * ISMIR 2018, Apache-2.0), ported from @magenta/music onto the TensorFlow.js
 * the app already loads for Basic Pitch. One acoustic stack finds where notes
 * start, another which keys sound; each feeds an LSTM, and a note is an onset
 * followed by its key sounding. It was trained on piano only: it hears a piano
 * far more surely than Basic Pitch (no octave ghosts), and other instruments
 * poorly.
 *
 * The weights are Magenta's, without the velocity stack and stored as uint8
 * (scripts/build-onsets-frames.mjs). The mel spectrogram repeats Magenta's
 * arithmetic, float32 roundings included, so the network hears what it was
 * trained on.
 */
import type * as TF from '@tensorflow/tfjs';
import type { RawNote } from './tracker';

type Tf = typeof TF;

/** The network listens at 16 kHz, mono, in frames of 512 samples (32 ms). */
export const PIANO_RATE = 16000;
const HOP = 512;
const FRAME = HOP / PIANO_RATE;
const N_FFT = 2048;
const MEL_BINS = 229;
const F_MIN = 30;
const MIN_PITCH = 21;
const PITCHES = 88;
/** Frames the acoustic stacks see at once, frames of context added either side, and pieces run together. */
const CHUNK = 250;
const RF_PAD = 3;
const GROUP = 4;
const UNITS = 384;
const THRESHOLD = 0.5;
const CELL = 'cudnn_lstm/rnn/multi_rnn_cell/cell_0/cudnn_compatible_lstm_cell';
/** No colour: the hands are split by pitch on import. */
const GREY: [number, number, number] = [128, 128, 128];

/* ---------- the mel spectrogram, as Magenta computes it ---------- */

function linear(start: number, end: number, count: number): Float32Array {
  const out = new Float32Array(count);
  const step = (end - start) / (count - 1);
  for (let i = 0; i < count; i++) out[i] = start + step * i;
  return out;
}

let bank: { lo: number; hi: number; w: Float32Array }[] | null = null;

/** Magenta's mel filters (HTK scale, area-normalised), each kept with the span of FFT bins where it is not zero. */
function filterbank(): { lo: number; hi: number; w: Float32Array }[] {
  if (bank) return bank;
  const bins = N_FFT / 2 + 1;
  const fft = linear(0, PIANO_RATE / 2, bins);
  const toMel = (hz: number) => 1125 * Math.log(1 + hz / 700);
  const mel = linear(toMel(F_MIN), toMel(PIANO_RATE / 2), MEL_BINS + 2).map((m) => 700 * (Math.exp(m / 1125) - 1));
  const f = Math.fround;
  bank = [];
  for (let i = 0; i < MEL_BINS; i++) {
    const w = new Float32Array(bins);
    const down = f(mel[i + 1] - mel[i]);
    const up = f(mel[i + 2] - mel[i + 1]);
    const norm = 2 / (mel[i + 2] - mel[i]);
    let lo = bins;
    let hi = 0;
    for (let j = 0; j < bins; j++) {
      w[j] = f(Math.max(0, Math.min(-f(mel[i] - fft[j]) / down, f(mel[i + 2] - fft[j]) / up))) * norm;
      if (w[j] !== 0) {
        lo = Math.min(lo, j);
        hi = j + 1;
      }
    }
    bank.push({ lo, hi, w });
  }
  return bank;
}

let hann: Float32Array | null = null;
let twiddle: { cos: Float64Array; sin: Float64Array; rev: Uint32Array } | null = null;

/** An in-place radix-2 FFT of N_FFT points. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = N_FFT;
  if (!twiddle) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    const rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    twiddle = { cos, sin, rev };
  }
  const { cos, sin, rev } = twiddle;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const c = cos[k * step];
        const s = sin[k * step];
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Log-mel frames (dB, at most 80 below each frame's loudest bin) of 16 kHz samples: what the network takes in. */
export function melSpectrogram(y: Float32Array): Float32Array[] {
  const half = N_FFT / 2;
  // centred frames: half a window of reflection at either end
  const x = new Float32Array(y.length + N_FFT);
  x.set(y, half);
  for (let i = 0; i < half; i++) {
    x[i] = x[2 * half - i];
    x[x.length - i - 1] = x[x.length - 2 * half + i - 1];
  }
  if (!hann) {
    hann = new Float32Array(N_FFT);
    for (let i = 0; i < N_FFT; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N_FFT - 1)));
  }
  const fb = filterbank();
  const count = Math.floor((x.length - N_FFT) / HOP) + 1;
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const power = new Float32Array(half + 1);
  const f = Math.fround;
  const out: Float32Array[] = [];
  for (let t = 0; t < count; t++) {
    const at = t * HOP;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = f(x[at + i] * hann[i]);
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= half; k++) {
      const r = f(re[k]);
      const m = f(im[k]);
      power[k] = Math.pow(f(Math.sqrt(r * r + m * m)), 2);
    }
    const row = new Float32Array(MEL_BINS);
    let max = -Infinity;
    for (let i = 0; i < MEL_BINS; i++) {
      const { lo, hi, w } = fb[i];
      let sum = 0;
      for (let j = lo; j < hi; j++) sum += f(power[j] * w[j]);
      row[i] = 10 * Math.log10(Math.max(1e-10, f(sum)));
      if (row[i] > max) max = row[i];
    }
    for (let i = 0; i < MEL_BINS; i++) row[i] = Math.max(row[i], max - 80);
    out.push(row);
  }
  return out;
}

/* ---------- pieces of a long recording ---------- */

/**
 * Frames cut into pieces of CHUNK with RF_PAD frames of context either side
 * (the convolutions see three frames around each), as Magenta's batchInput,
 * except that a recording shorter than one padded piece stays whole.
 */
export function batchInput(tf: Tf, input: Float32Array[]): TF.Tensor3D {
  const rows = (r: Float32Array[]) => {
    const flat = new Float32Array(r.length * MEL_BINS);
    r.forEach((row, i) => flat.set(row, i * MEL_BINS));
    return tf.tensor2d(flat, [r.length, MEL_BINS]);
  };
  const padded = CHUNK + 2 * RF_PAD;
  let size = Math.ceil(input.length / CHUNK);
  let rem = input.length % CHUNK;
  let merged = 0;
  if (size > 1 && rem > 0 && rem <= RF_PAD) {
    size -= 1;
    merged = rem;
    rem = 0;
  }
  return tf.tidy(() => {
    if (size === 1 || input.length <= padded) return rows(input).expandDims(0) as TF.Tensor3D;
    const first = rows(input.slice(0, padded)).expandDims(0) as TF.Tensor3D;
    const last = rows(input.slice(input.length - padded)).expandDims(0) as TF.Tensor3D;
    if (size === 2) return tf.concat([first, last], 0);
    const naive = rem ? rows(input).pad([[0, CHUNK - rem], [0, 0]]).as3D(size, CHUNK, -1) : rows(input.slice(0, input.length - merged)).as3D(size, CHUNK, -1);
    const left = naive.slice([0, CHUNK - RF_PAD], [size - 2, -1]);
    const right = naive.slice([2, 0], [-1, RF_PAD]);
    const mid = tf.concat([left, naive.slice(1, size - 2), right], 1);
    return tf.concat([first, mid, last], 0);
  });
}

/** The pieces' outputs joined back into one run of `total` frames (Magenta's unbatchOutput). */
export function unbatchOutput(tf: Tf, batches: TF.Tensor3D, total: number): TF.Tensor3D {
  if (batches.shape[0] === 1) return batches.clone();
  return tf.tidy(() => {
    const first = batches.slice([0, 0], [1, CHUNK]);
    let finalLength = total % CHUNK;
    if (finalLength <= RF_PAD) finalLength += CHUNK;
    const last = batches.slice([batches.shape[0] - 1, batches.shape[1] - finalLength], [-1, -1]);
    if (batches.shape[0] === 2) return tf.concat([first, last], 1);
    const n = batches.shape[0] - 2;
    const mid = batches.slice([1, RF_PAD], [n, CHUNK]).as3D(1, n * CHUNK, -1);
    return tf.concat([first, mid, last], 1);
  });
}

/* ---------- notes ---------- */

/**
 * Magenta's decoding of the two rolls (frames × 88 keys): a note starts where
 * its key's onset is above the threshold and lasts while the key sounds (an
 * onset counts as sounding); an onset of a sounding key after a frame without
 * one strikes it again.
 */
export function pianoroll(frames: ArrayLike<number>, onsets: ArrayLike<number>, count: number): RawNote[] {
  const start = new Uint32Array(PITCHES);
  let before = new Uint8Array(PITCHES);
  const notes: RawNote[] = [];
  const end = (p: number, f: number) => {
    notes.push({ pitch: p + MIN_PITCH, on: (start[p] - 1) * FRAME, off: f * FRAME, color: GREY });
    start[p] = 0;
  };
  // one silent frame past the end closes every note
  for (let f = 0; f <= count; f++) {
    const now = new Uint8Array(PITCHES);
    for (let p = 0; p < PITCHES; p++) {
      const i = f * PITCHES + p;
      const onset = f < count && onsets[i] > THRESHOLD;
      if (onset) {
        now[p] = 1;
        if (!start[p]) start[p] = f + 1;
        else if (!before[p]) {
          end(p, f);
          start[p] = f + 1;
        }
      } else if (start[p] && !(f < count && frames[i] > THRESHOLD)) end(p, f);
    }
    before = now;
  }
  return notes;
}

/* ---------- the network ---------- */

/**
 * A pause for the page to draw the progress. Not tf.nextFrame: animation
 * frames stop in a hidden tab, and the recognition with them.
 */
const breathe = () =>
  new Promise<void>((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });

interface Lstm {
  lstm: TF.LayersModel;
  dense: TF.Sequential;
}

export class OnsetsAndFrames {
  private constructor(
    private tf: Tf,
    private onsetsCnn: TF.Sequential,
    private onsetsRnn: Lstm,
    private activationCnn: TF.Sequential,
    private frameRnn: Lstm,
  ) {}

  /** The network built from Magenta's named weights (the "onsets" and "frame" scopes). */
  static fromWeights(tf: Tf, vars: TF.NamedTensorMap): OnsetsAndFrames {
    const get = (name: string) => {
      const v = vars[name];
      if (!v) throw new Error(`Onsets and Frames: no weight ${name}`);
      return v;
    };
    const acoustic = (scope: string, head?: string) => {
      const nn = tf.sequential();
      const conv = (filters: number, first = false) =>
        tf.layers.conv2d({ filters, kernelSize: [3, 3], activation: 'linear', useBias: false, padding: 'same', dilationRate: [1, 1], trainable: false, ...(first ? { inputShape: [null, MEL_BINS, 1] } : {}) });
      const norm = () => tf.layers.batchNormalization({ scale: false, trainable: false });
      const relu = () => tf.layers.activation({ activation: 'relu' });
      nn.add(conv(48, true));
      nn.add(norm());
      nn.add(relu());
      nn.add(conv(48));
      nn.add(norm());
      nn.add(relu());
      nn.add(tf.layers.maxPooling2d({ poolSize: [1, 2], strides: [1, 2] }));
      nn.add(conv(96));
      nn.add(norm());
      nn.add(relu());
      nn.add(tf.layers.maxPooling2d({ poolSize: [1, 2], strides: [1, 2] }));
      const dims = nn.outputShape as number[];
      nn.add(tf.layers.reshape({ targetShape: [dims[1], dims[2] * dims[3]] }));
      nn.add(tf.layers.dense({ units: 768, activation: 'relu', trainable: false }));
      if (head) nn.add(tf.layers.dense({ units: PITCHES, activation: 'sigmoid', trainable: false }));
      const layers = [0, 1, 2].flatMap((i) => ['weights', 'BatchNorm/beta', 'BatchNorm/moving_mean', 'BatchNorm/moving_variance'].map((w) => get(`${scope}/conv${i}/${w}`)));
      layers.push(get(`${scope}/fc_end/weights`), get(`${scope}/fc_end/biases`));
      if (head) layers.push(get(`${scope}/${head}/weights`), get(`${scope}/${head}/biases`));
      nn.setWeights(layers);
      return nn;
    };
    const recurrent = (scope: string, head: string, inputSize: number): Lstm => {
      const layer = tf.layers.lstm({
        units: UNITS,
        returnSequences: true,
        returnState: true,
        recurrentActivation: 'sigmoid',
        kernelInitializer: 'zeros',
        recurrentInitializer: 'zeros',
        biasInitializer: 'zeros',
        trainable: false,
      });
      const inputs = [tf.input({ shape: [null, inputSize] }), tf.input({ shape: [UNITS] }), tf.input({ shape: [UNITS] })];
      const lstm = tf.model({ inputs, outputs: layer.apply(inputs) as TF.SymbolicTensor[] });
      const dense = tf.sequential();
      dense.add(tf.layers.dense({ inputShape: [null, UNITS], units: PITCHES, activation: 'sigmoid', trainable: false }));
      // the cuDNN-compatible cell keeps its gates as i, c, f, o; TF.js wants i, f, c, o, with the forget bias of 1 added
      const reorder = (w: TF.Tensor, forgetBias = 0) => {
        const [i, c, f, o] = tf.split(w, 4, -1);
        return tf.concat([i, f.add(tf.scalar(forgetBias)), c, o], -1);
      };
      const kernel = get(`${scope}/${CELL}/kernel`);
      lstm.setWeights([...tf.split(reorder(kernel), [kernel.shape[0] - UNITS, UNITS]), reorder(get(`${scope}/${CELL}/bias`), 1)]);
      dense.setWeights([get(`${scope}/${head}/weights`), get(`${scope}/${head}/biases`)]);
      return { lstm, dense };
    };
    // built in a tidy for the reordered gates; the layers' variables outlive it
    let built: OnsetsAndFrames | null = null;
    tf.tidy(() => {
      const onsetsCnn = acoustic('onsets');
      const onsetsRnn = recurrent('onsets', 'onset_probs', (onsetsCnn.outputShape as number[])[2]);
      const activationCnn = acoustic('frame', 'activation_probs');
      const frameRnn = recurrent('frame', 'frame_probs', PITCHES * 2);
      built = new OnsetsAndFrames(tf, onsetsCnn, onsetsRnn, activationCnn, frameRnn);
    });
    return built!;
  }

  /** Notes heard in 16 kHz mono samples. `progress` gets 0–1. */
  async notes(samples: Float32Array, progress: (p: number) => void = () => {}): Promise<RawNote[]> {
    const tf = this.tf;
    const spec = melSpectrogram(samples);
    const count = spec.length;
    progress(0.05);
    if (!count) return [];
    // the acoustic stacks over the pieces, a few at a time
    const batches = batchInput(tf, spec);
    const n = batches.shape[0];
    const onsetParts: TF.Tensor3D[] = [];
    const activationParts: TF.Tensor3D[] = [];
    for (let b = 0; b < n; b += GROUP) {
      const [o, a] = tf.tidy(() => {
        const x = batches.slice([b, 0, 0], [Math.min(GROUP, n - b), -1, -1]).expandDims(-1);
        return [this.onsetsCnn.predict(x) as TF.Tensor3D, this.activationCnn.predict(x) as TF.Tensor3D];
      });
      onsetParts.push(o);
      activationParts.push(a);
      progress(0.05 + 0.55 * Math.min(1, (b + GROUP) / n));
      await breathe();
    }
    batches.dispose();
    const join = (parts: TF.Tensor3D[]) => tf.tidy(() => unbatchOutput(tf, parts.length === 1 ? parts[0] : tf.concat(parts, 0), count));
    const onsetsCnnOut = join(onsetParts);
    const activation = join(activationParts);
    tf.dispose([...onsetParts, ...activationParts]);
    const onsetProbs = await this.run(this.onsetsRnn, onsetsCnnOut, (p) => progress(0.6 + 0.2 * p));
    onsetsCnnOut.dispose();
    const frameInput = tf.concat([onsetProbs, activation], -1);
    activation.dispose();
    const frameProbs = await this.run(this.frameRnn, frameInput, (p) => progress(0.8 + 0.2 * p));
    frameInput.dispose();
    const [frames, onsets] = await Promise.all([frameProbs.data(), onsetProbs.data()]);
    tf.dispose([frameProbs, onsetProbs]);
    progress(1);
    return pianoroll(frames, onsets, count);
  }

  /** An LSTM and its dense layer over the whole run, CHUNK frames at a time with the state carried over. */
  private async run(m: Lstm, x: TF.Tensor3D, progress: (p: number) => void): Promise<TF.Tensor3D> {
    const tf = this.tf;
    const total = x.shape[1];
    const n = Math.ceil(total / CHUNK);
    let state: TF.Tensor[] = [tf.zeros([1, UNITS]), tf.zeros([1, UNITS])];
    const outs: TF.Tensor3D[] = [];
    for (let i = 0; i < n; i++) {
      const [out, h, c] = tf.tidy(() => {
        const piece = x.slice([0, i * CHUNK], [-1, i < n - 1 ? CHUNK : -1]);
        const [seq, h, c] = m.lstm.predict([piece, state[0], state[1]]) as TF.Tensor[];
        return [m.dense.predict(seq) as TF.Tensor3D, h, c];
      });
      tf.dispose(state);
      state = [h, c];
      outs.push(out as TF.Tensor3D);
      progress((i + 1) / n);
      if (i % GROUP === GROUP - 1) await breathe();
    }
    tf.dispose(state);
    if (outs.length === 1) return outs[0];
    const all = tf.concat(outs, 1);
    tf.dispose(outs);
    return all;
  }
}

/**
 * The network from `base` (weights_manifest.json and its shards), the shards
 * read as they arrive so `loaded` can show the download (bytes so far, total).
 */
export async function loadOnsetsFrames(tf: Tf, base: string, loaded: (got: number, total: number) => void = () => {}): Promise<OnsetsAndFrames> {
  const res = await fetch(new URL('weights_manifest.json', base));
  if (!res.ok) throw new Error(`Onsets and Frames: HTTP ${res.status}`);
  const manifest = (await res.json()) as TF.io.WeightsManifestConfig;
  const specs = manifest.flatMap((g) => g.weights);
  const width: Record<string, number> = { uint8: 1, uint16: 2, float16: 2 };
  const total = specs.reduce((a, s) => a + s.shape.reduce((x, y) => x * y, 1) * (s.quantization ? width[s.quantization.dtype] : 4), 0);
  const data = new Uint8Array(total);
  let got = 0;
  loaded(0, total);
  for (const path of manifest.flatMap((g) => g.paths)) {
    const shard = await fetch(new URL(path, base));
    if (!shard.ok || !shard.body) throw new Error(`Onsets and Frames: HTTP ${shard.status}`);
    const reader = shard.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      data.set(value, got);
      got += value.length;
      loaded(got, total);
    }
  }
  if (got !== total) throw new Error('Onsets and Frames: the weights are incomplete');
  const vars = tf.io.decodeWeights(data.buffer, specs);
  const model = OnsetsAndFrames.fromWeights(tf, vars);
  tf.dispose(Object.values(vars));
  return model;
}
