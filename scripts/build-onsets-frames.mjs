// Builds public/models/onsets-frames/, the piano listener koimidi uses by
// default: Magenta's Onsets and Frames (Hawthorne et al. 2018, Apache-2.0),
// the unidirectional checkpoint published for Magenta.js.
//
// The checkpoint is 62.5 MB of float32 weights. This keeps only the parts that
// give notes (the "onsets" and "frame" stacks; the velocity stack is dropped,
// koimidi does not use loudness) and stores every weight as uint8 with its own
// minimum and step, the TF.js weights format, which TF.js turns back into
// float32 when it loads them. On the 34-video benchmark the uint8 weights found
// the same notes as the float32 ones.
//
// Usage: node scripts/build-onsets-frames.mjs [checkpoint dir] [out dir]
// Without a checkpoint dir the checkpoint is downloaded from Magenta.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_BASE = 'https://storage.googleapis.com/magentadata/js/checkpoints/transcription/onsets_frames_uni';
const KEEP = (name) => name.startsWith('onsets/') || name.startsWith('frame/');
/** Shard size of the TF.js converter. */
const SHARD = 4 * 1024 * 1024;

const [, , source, out = 'public/models/onsets-frames'] = process.argv;

async function read(name) {
  if (source) return readFileSync(join(source, name));
  const res = await fetch(`${URL_BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const manifest = JSON.parse((await read('weights_manifest.json')).toString('utf8'));
const specs = [];
const parts = [];
let before = 0;
for (const group of manifest) {
  const data = Buffer.concat(await Promise.all(group.paths.map(read)));
  let offset = 0;
  for (const w of group.weights) {
    if (w.dtype !== 'float32' || w.quantization) throw new Error(`${w.name}: expected plain float32`);
    const n = w.shape.reduce((a, b) => a * b, 1);
    const values = new Float32Array(data.buffer.slice(data.byteOffset + offset, data.byteOffset + offset + 4 * n));
    offset += 4 * n;
    before += 4 * n;
    if (!KEEP(w.name)) continue;
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const scale = max > min ? (max - min) / 255 : 1;
    const q = new Uint8Array(n);
    for (let i = 0; i < n; i++) q[i] = Math.round((values[i] - min) / scale);
    specs.push({ name: w.name, shape: w.shape, dtype: 'float32', quantization: { dtype: 'uint8', min, scale } });
    parts.push(q);
  }
  if (offset !== data.length) throw new Error('the weights do not fill their shards');
}

const all = Buffer.concat(parts);
const count = Math.ceil(all.length / SHARD);
const paths = Array.from({ length: count }, (_, i) => `group1-shard${i + 1}of${count}.bin`);
if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });
paths.forEach((p, i) => writeFileSync(join(out, p), all.subarray(i * SHARD, (i + 1) * SHARD)));
writeFileSync(join(out, 'weights_manifest.json'), `${JSON.stringify([{ paths, weights: specs }])}\n`);
writeFileSync(
  join(out, 'onsets-frames.txt'),
  `Onsets and Frames piano transcription (Magenta, Google), Apache License 2.0:
https://github.com/magenta/magenta-js/tree/master/music/src/transcription
Hawthorne et al., "Onsets and Frames: Dual-Objective Piano Transcription", ISMIR 2018.
Checkpoint: ${URL_BASE}

Changes made for koimidi (scripts/build-onsets-frames.mjs in
https://github.com/MeRuslan/koimidi): the velocity stack removed, every
weight stored as uint8 with its own minimum and step (TF.js quantisation).
`,
);
console.log(`${specs.length} weights, ${(before / 1e6).toFixed(1)} MB of float32 → ${(all.length / 1e6).toFixed(1)} MB in ${count} shard(s) at ${out}`);
