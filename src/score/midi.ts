/**
 * Standard MIDI file importer built on @tonejs/midi.
 *
 * Hands: with two or more note tracks the two busiest become right/left by
 * mean pitch. A single track is the right hand, optionally split at middle C
 * (`split: 'middleC'`), or automatically when the track clearly spans both
 * registers (`split: 'auto'`).
 */
import { Midi } from '@tonejs/midi';
import { buildMeasures, finalizeScore, type Hand, type Score, type ScoreNote } from './model';

export type MidiSplit = 'auto' | 'none' | 'middleC';

export interface MidiImportOptions {
  split?: MidiSplit;
}

export function parseMidi(bytes: ArrayBuffer | Uint8Array, id: string, fileName = '', opts: MidiImportOptions = {}): Score {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const midi = new Midi(buf);
  const ppq = midi.header.ppq || 480;
  const toBeats = (ticks: number) => ticks / ppq;

  const tracks = midi.tracks
    .map((tr, index) => ({ index, name: tr.name, channel: tr.channel, notes: tr.notes }))
    .filter((tr) => tr.notes.length > 0 && tr.channel !== 9);
  if (!tracks.length) throw new Error('The MIDI file has no notes');

  const notes: ScoreNote[] = [];
  const push = (tr: (typeof tracks)[number], hand: Hand | ((pitch: number) => Hand)) => {
    for (const n of tr.notes) {
      const h = typeof hand === 'function' ? hand(n.midi) : hand;
      notes.push({ pitch: n.midi, t: toBeats(n.ticks), dur: Math.max(toBeats(n.durationTicks), 0.05), hand: h, measure: 1, velocity: n.velocity });
    }
  };
  const mean = (tr: (typeof tracks)[number]) => tr.notes.reduce((s, n) => s + n.midi, 0) / tr.notes.length;

  if (tracks.length >= 2) {
    const busiest = [...tracks].sort((a, b) => b.notes.length - a.notes.length).slice(0, 2);
    busiest.sort((a, b) => mean(b) - mean(a));
    push(busiest[0], 'R');
    push(busiest[1], 'L');
  } else {
    const tr = tracks[0];
    const split = opts.split ?? 'auto';
    let useSplit = split === 'middleC';
    if (split === 'auto') {
      const pitches = tr.notes.map((n) => n.midi);
      const lo = Math.min(...pitches);
      const hi = Math.max(...pitches);
      const below = pitches.filter((p) => p < 60).length / pitches.length;
      useSplit = hi - lo >= 24 && below >= 0.25 && below <= 0.75;
    }
    push(tr, useSplit ? (p) => (p < 60 ? 'L' : 'R') : 'R');
  }

  // trim overlapping repeats of the same pitch in the same hand
  const byKey = new Map<string, ScoreNote[]>();
  for (const n of notes) {
    const k = `${n.hand}|${n.pitch}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(n);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => a.t - b.t);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      if (prev.t + prev.dur > list[i].t) prev.dur = Math.max(0.05, list[i].t - prev.t);
    }
  }

  const end = notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
  const sigs = midi.header.timeSignatures
    .map((ts) => ({ t: toBeats(ts.ticks), num: ts.timeSignature[0], den: ts.timeSignature[1] }))
    .sort((a, b) => a.t - b.t);
  if (!sigs.length || sigs[0].t > 0) sigs.unshift({ t: 0, num: 4, den: 4 });
  const tempo = midi.header.tempos.map((te) => ({ t: toBeats(te.ticks), bpm: te.bpm })).sort((a, b) => a.t - b.t);
  if (!tempo.length || tempo[0].t > 0) tempo.unshift({ t: 0, bpm: tempo[0]?.bpm ?? 120 });

  const title = (midi.name || '').trim() || fileName.replace(/\.[^.]+$/, '') || 'Untitled';
  return finalizeScore({
    id,
    title,
    timeSig: [sigs[0].num, sigs[0].den],
    tempo,
    measures: buildMeasures(sigs, end),
    notes,
    source: 'midi',
  });
}
