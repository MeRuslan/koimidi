/**
 * The listening networks under Node for the benchmark: Basic Pitch as the app
 * fetches it from models/basic-pitch/, read from node_modules instead, and the
 * app's Onsets and Frames with its weights read from public/models/, both on
 * TensorFlow.js's CPU backend (Basic Pitch about real time, Onsets and Frames
 * four times slower; the browser's WebGL is much faster). The packages are
 * CommonJS, so they are required rather than imported.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BasicPitch as BasicPitchT } from '@spotify/basic-pitch';
import type * as TF from '@tensorflow/tfjs';
import { OnsetsAndFrames } from '../../src/video/onsets-frames';

const require = createRequire(import.meta.url);

interface ModelJson {
  format: string;
  generatedBy: string;
  convertedBy: string;
  signature: object;
  modelTopology: object;
  weightsManifest: { paths: string[]; weights: object[] }[];
}

/** Basic Pitch with its network loaded from disk. */
export async function basicPitchFromDisk(): Promise<BasicPitchT> {
  const tf = require('@tensorflow/tfjs') as typeof import('@tensorflow/tfjs');
  const { BasicPitch } = require('@spotify/basic-pitch') as typeof import('@spotify/basic-pitch');
  await tf.setBackend('cpu');
  await tf.ready();
  const dir = join(dirname(require.resolve('@spotify/basic-pitch/package.json')), 'model');
  const mj = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8')) as ModelJson;
  const data = Buffer.concat(mj.weightsManifest.flatMap((g) => g.paths.map((p) => readFileSync(join(dir, p)))));
  const weightData = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const artifacts = {
    modelTopology: mj.modelTopology,
    weightSpecs: mj.weightsManifest.flatMap((g) => g.weights),
    weightData,
    format: mj.format,
    generatedBy: mj.generatedBy,
    convertedBy: mj.convertedBy,
    signature: mj.signature,
  } as Parameters<typeof tf.io.fromMemory>[0];
  return new BasicPitch(tf.loadGraphModel(tf.io.fromMemory(artifacts)));
}

/** The app's Onsets and Frames with the weights it would fetch from models/onsets-frames/ (or, to compare, another TF.js checkpoint named by BENCH_OAF_WEIGHTS). */
export async function onsetsFramesFromDisk(): Promise<OnsetsAndFrames> {
  const tf = require('@tensorflow/tfjs') as typeof TF;
  await tf.setBackend('cpu');
  await tf.ready();
  const dir = process.env.BENCH_OAF_WEIGHTS ?? fileURLToPath(new URL('../../public/models/onsets-frames/', import.meta.url));
  const manifest = JSON.parse(readFileSync(join(dir, 'weights_manifest.json'), 'utf8')) as TF.io.WeightsManifestConfig;
  const data = Buffer.concat(manifest.flatMap((g) => g.paths.map((p) => readFileSync(join(dir, p)))));
  const vars = tf.io.decodeWeights(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, manifest.flatMap((g) => g.weights));
  const model = OnsetsAndFrames.fromWeights(tf, vars);
  tf.dispose(Object.values(vars));
  return model;
}

/** The sound of a video, mono at `rate` (Basic Pitch's 22.05 kHz by default; ffmpeg decodes and resamples, as the browser does in the app). */
export function samplesOf(file: string, rate = 22050): Float32Array {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.toString()}`);
  const copy = r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength) as ArrayBuffer;
  return new Float32Array(copy);
}
