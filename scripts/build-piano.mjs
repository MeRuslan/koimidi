// Builds public/sounds/salamander-grand-piano.sf3, the grand piano koimidi
// offers, from the Salamander Grand Piano V3 SoundFont (Alexander Holm,
// CC BY 3.0; SF2 conversion from https://freepats.zenvoid.org/Piano/).
//
// The full instrument is far too big for a web page, so this keeps a few of
// its 16 velocity layers, shortens the long sample tails with a fade, and
// compresses every sample with Ogg Vorbis (SF3). Needs ffmpeg with libvorbis.
//
// Usage: node scripts/build-piano.mjs <SalamanderGrandPiano-V3.sf2> [out.sf3]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Modulator, ModulatorSource, SoundBankLoader } from 'spessasynth_core';

/** Velocities whose layers are kept; each kept layer then covers the velocities up to the next one. */
const KEEP_AT = [40, 64, 88, 116];
/** Longest kept tail in seconds, by MIDI key: long in the bass, short in the treble. */
const maxSeconds = (key) => Math.max(2.5, Math.min(9, 9 - (key - 21) * 0.075));
const FADE = 0.4; // seconds of fade-out at the cut
const QUALITY = 3; // libvorbis -q:a, about 80–96 kbit/s per channel
/**
 * The velocity layers already get softer, so the SoundFont default
 * "velocity → attenuation" (960 cB, concave) would make soft notes nearly
 * inaudible on top of them (−53 dB at velocity 20). A milder curve keeps
 * soft playing audible on small controllers.
 */
const VELOCITY_ATTENUATION = 240; // centibels

const [, , input, output = 'public/sounds/salamander-grand-piano.sf3'] = process.argv;
if (!input) {
  console.error('usage: node scripts/build-piano.mjs <SalamanderGrandPiano-V3.sf2> [out.sf3]');
  process.exit(1);
}

const file = readFileSync(input);
const bank = SoundBankLoader.fromArrayBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
console.log(`loaded ${bank.presets.length} preset(s), ${bank.instruments.length} instrument(s), ${bank.samples.length} samples`);

// 1. keep a few velocity layers and let them cover 0–127 between them
for (const ins of bank.instruments) {
  const layers = [...new Set(ins.zones.map((z) => `${z.velRange.min}:${z.velRange.max}`))]
    .map((s) => s.split(':').map(Number))
    .sort((a, b) => a[0] - b[0]);
  if (layers.length <= KEEP_AT.length) continue;
  const kept = [...new Set(KEEP_AT.map((v) => layers.findIndex(([lo, hi]) => v >= lo && v <= hi)).filter((i) => i >= 0))].map((i) => layers[i]);
  const span = new Map(kept.map(([lo, hi], i) => [`${lo}:${hi}`, [i === 0 ? 0 : kept[i - 1][1] + 1, i === kept.length - 1 ? 127 : hi]]));
  for (let i = ins.zones.length - 1; i >= 0; i--) {
    const z = ins.zones[i];
    const s = span.get(`${z.velRange.min}:${z.velRange.max}`);
    if (!s) ins.deleteZone(i, true);
    else z.velRange = { min: s[0], max: s[1] };
  }
  console.log(`${ins.name}: kept velocity layers ${kept.map(([lo, hi]) => `${lo}–${hi}`).join(', ')} of ${layers.length}`);
}
bank.removeUnusedElements();
// same source, destination and transform as the default modulator, so it replaces it
for (const ins of bank.instruments) {
  ins.globalZone.addModulators(new Modulator(ModulatorSource.fromSourceEnum(0x0502), ModulatorSource.fromSourceEnum(0), 48, VELOCITY_ATTENUATION, 0));
}

// 2. shorten the tails
let seconds = 0;
for (const s of bank.samples) {
  const data = s.getAudioData();
  const keep = Math.min(data.length, Math.round(maxSeconds(s.originalKey) * s.sampleRate), s.loopEnd > s.loopStart + 1 ? data.length : Infinity);
  const out = data.slice(0, keep);
  const fade = Math.min(keep, Math.round(FADE * s.sampleRate));
  if (keep < data.length) for (let i = 0; i < fade; i++) out[keep - fade + i] *= 1 - i / fade;
  s.setAudioData(out, s.sampleRate);
  seconds += keep / s.sampleRate;
}
console.log(`${bank.samples.length} samples left, ${(seconds / 60).toFixed(1)} min of audio`);

// 3. Ogg Vorbis through ffmpeg
const tmp = mkdtempSync(join(tmpdir(), 'koimidi-piano-'));
let n = 0;
const encode = async (audio, rate) => {
  const raw = join(tmp, `${n}.f32`);
  const ogg = join(tmp, `${n++}.ogg`);
  writeFileSync(raw, Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', raw, '-c:a', 'libvorbis', '-q:a', String(QUALITY), ogg]);
  const bytes = new Uint8Array(readFileSync(ogg));
  rmSync(raw);
  rmSync(ogg);
  return bytes;
};
await bank.setSampleFormat({ format: 'compressed', compressionFunction: encode });
rmSync(tmp, { recursive: true });

for (const p of bank.presets) p.name = 'Grand Piano';
for (const ins of bank.instruments) ins.name = 'Salamander Grand Piano';
bank.soundBankInfo.name = 'Salamander Grand Piano (koimidi web edition)';
bank.soundBankInfo.copyright = 'Alexander Holm, CC BY 3.0 https://creativecommons.org/licenses/by/3.0/';
bank.soundBankInfo.comment = `Reduced for koimidi: ${KEEP_AT.length} of 16 velocity layers, tails shortened with a fade, milder velocity curve, Ogg Vorbis q${QUALITY}. Source: freepats.zenvoid.org`;
const sf3 = bank.writeSF2({ software: 'koimidi build-piano.mjs' });
writeFileSync(output, new Uint8Array(sf3));
console.log(`wrote ${output}: ${(sf3.byteLength / 1024 / 1024).toFixed(1)} MB`);
