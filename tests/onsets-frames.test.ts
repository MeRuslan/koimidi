import { readFileSync } from 'node:fs';
import * as tf from '@tensorflow/tfjs';
import { SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';
import { beforeAll, describe, expect, it } from 'vitest';
import { batchInput, melSpectrogram, OnsetsAndFrames, pianoroll, PIANO_RATE, unbatchOutput } from '../src/video/onsets-frames';

const FRAME = 512 / PIANO_RATE;

beforeAll(async () => {
  await tf.setBackend('cpu');
  await tf.ready();
});

describe('Onsets and Frames: the pieces around the network', () => {
  it('the mel spectrogram has a frame per 512 samples and a sine peaks in its own band', () => {
    const y = new Float32Array(PIANO_RATE);
    for (let i = 0; i < y.length; i++) y[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / PIANO_RATE);
    const spec = melSpectrogram(y);
    expect(spec.length).toBe(Math.floor(y.length / 512) + 1);
    expect(spec[0].length).toBe(229);
    const row = spec[15];
    const peak = row.indexOf(Math.max(...row));
    // the band whose centre is nearest 440 Hz on the HTK mel scale from 30 to 8000 Hz
    const mel = (hz: number) => 1125 * Math.log(1 + hz / 700);
    const centre = Math.round(((mel(440) - mel(30)) / (mel(8000) - mel(30))) * 230) - 1;
    expect(Math.abs(peak - centre)).toBeLessThanOrEqual(1);
    // at most 80 dB below the loudest band of the frame
    expect(Math.min(...row)).toBeGreaterThanOrEqual(Math.max(...row) - 80 - 1e-3);
  });

  it('pieces of a long recording join back into the whole run', () => {
    for (const frames of [40, 250, 253, 254, 256, 260, 500, 503, 777, 1000]) {
      const spec = Array.from({ length: frames }, (_, t) => Float32Array.from({ length: 229 }, (_, b) => t * 1000 + b));
      const batches = batchInput(tf, spec);
      const joined = unbatchOutput(tf, batches, frames);
      expect(joined.shape).toEqual([1, frames, 229]);
      const values = joined.arraySync()[0];
      expect(values.map((r) => r[0])).toEqual(spec.map((r) => r[0]));
      tf.dispose([batches, joined]);
    }
  });

  it('decodes the rolls as Magenta does: an onset starts a note, the frames hold it, a new onset strikes it again', () => {
    const count = 12;
    const frames = new Float32Array(count * 88);
    const onsets = new Float32Array(count * 88);
    const C4 = 60 - 21;
    for (let f = 1; f <= 9; f++) frames[f * 88 + C4] = 0.9;
    onsets[1 * 88 + C4] = 0.8;
    onsets[2 * 88 + C4] = 0.8; // the same onset going on: not a new note
    onsets[6 * 88 + C4] = 0.7; // struck again
    // a lone onset without frames is still a one-frame note
    onsets[3 * 88 + 64 - 21] = 0.9;
    const notes = pianoroll(frames, onsets, count);
    const c4 = notes.filter((n) => n.pitch === 60).map((n) => [Math.round(n.on / FRAME), Math.round(n.off / FRAME)]);
    expect(c4).toEqual([
      [1, 6],
      [6, 10],
    ]);
    expect(notes.filter((n) => n.pitch === 64).map((n) => [Math.round(n.on / FRAME), Math.round(n.off / FRAME)])).toEqual([[3, 4]]);
  });
});

/** A few notes played by the Salamander grand koimidi ships, rendered at the network's rate. */
async function grandPiano(notes: { pitch: number; at: number; len: number }[], seconds: number): Promise<Float32Array> {
  const file = readFileSync(`${process.cwd()}/public/sounds/salamander-grand-piano.sf3`);
  const synth = new SpessaSynthProcessor(PIANO_RATE);
  synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)), 'main');
  await synth.processorInitialized;
  const left = new Float32Array(Math.round(seconds * PIANO_RATE));
  const right = new Float32Array(left.length);
  const events = notes.flatMap((n) => [
    { at: n.at, on: true, pitch: n.pitch },
    { at: n.at + n.len, on: false, pitch: n.pitch },
  ]);
  events.sort((a, b) => a.at - b.at);
  const BLOCK = 128;
  for (let i = 0; i < left.length; i += BLOCK) {
    const t = i / PIANO_RATE;
    while (events.length && events[0].at <= t) {
      const e = events.shift()!;
      if (e.on) synth.noteOn(0, e.pitch, 90);
      else synth.noteOff(0, e.pitch);
    }
    synth.process(left, right, i, Math.min(BLOCK, left.length - i));
  }
  return left.map((v, i) => (v + right[i]) / 2);
}

describe('Onsets and Frames: the shipped network', () => {
  it('hears a grand piano play the start of Ode to Joy', async () => {
    const dir = `${process.cwd()}/public/models/onsets-frames`;
    const manifest = JSON.parse(readFileSync(`${dir}/weights_manifest.json`, 'utf8')) as tf.io.WeightsManifestConfig;
    const data = Buffer.concat(manifest.flatMap((g) => g.paths.map((p) => readFileSync(`${dir}/${p}`))));
    const vars = tf.io.decodeWeights(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, manifest.flatMap((g) => g.weights));
    const model = OnsetsAndFrames.fromWeights(tf, vars);
    tf.dispose(Object.values(vars));

    const melody = [64, 64, 65, 67, 67, 65, 64, 62];
    const audio = await grandPiano(
      melody.map((pitch, i) => ({ pitch, at: 0.25 + i * 0.4, len: 0.35 })),
      0.25 + melody.length * 0.4 + 0.5,
    );
    const heard = await model.notes(audio);
    expect(heard.map((n) => n.pitch)).toEqual(melody);
    heard.forEach((n, i) => expect(Math.abs(n.on - (0.25 + i * 0.4))).toBeLessThan(0.07));
  }, 120000);
});
