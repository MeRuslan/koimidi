/**
 * Basic Pitch under Node for the benchmark: the same network the app fetches
 * from models/basic-pitch/, read from node_modules instead, on TensorFlow.js's
 * CPU backend (about real time; the browser's WebGL is much faster). The
 * packages are CommonJS, so they are required rather than imported.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { BasicPitch as BasicPitchT } from '@spotify/basic-pitch';

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

/** The sound of a video as Basic Pitch wants it, mono at 22.05 kHz (ffmpeg decodes and resamples, as the browser does in the app). */
export function samplesOf(file: string): Float32Array {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.toString()}`);
  const copy = r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength) as ArrayBuffer;
  return new Float32Array(copy);
}
