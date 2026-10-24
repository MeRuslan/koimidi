import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { Recorder, takeToMidi } from '../src/practice/recorder';

describe('recorder', () => {
  it('pairs presses and releases, trims leading silence, keeps the pedal', () => {
    const r = new Recorder();
    r.start('Ode', 1000);
    r.noteOn(64, 0.8, 3000); // 2 s of silence before the first note
    r.pedal(true, 3100);
    r.noteOff(64, 3500);
    r.noteOn(62, 0.5, 3600);
    r.noteOn(60, 0.6, 4000);
    r.noteOff(62, 4100);
    r.pedal(false, 4200);
    const take = r.stop(5000)!; // C4 still held: closed at stop
    expect(take.notes.map((n) => [n.pitch, +n.t.toFixed(3), +n.dur.toFixed(3)])).toEqual([
      [64, 0, 0.5],
      [62, 0.6, 0.5],
      [60, 1, 1],
    ]);
    expect(take.pedal).toEqual([
      { t: expect.closeTo(0.1, 5), on: true },
      { t: expect.closeTo(1.2, 5), on: false },
    ]);
    expect(take.duration).toBeCloseTo(2, 5);
    expect(r.recording).toBe(false);
  });

  it('returns nothing when no key was played', () => {
    const r = new Recorder();
    r.start('x', 0);
    r.pedal(true, 10);
    expect(r.stop(100)).toBeNull();
  });

  it('writes a MIDI file that reads back with the same notes and timing', () => {
    const r = new Recorder();
    r.start('Take', 0);
    r.noteOn(60, 0.7, 0);
    r.pedal(true, 100);
    r.noteOff(60, 500);
    r.noteOn(67, 0.9, 750);
    r.noteOff(67, 1250);
    const take = r.stop(1300)!;
    const midi = new Midi(takeToMidi(take, { bpm: 90, timeSig: [3, 4] }));
    expect(midi.header.tempos[0].bpm).toBeCloseTo(90, 3);
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([3, 4]);
    const notes = midi.tracks[0].notes;
    expect(notes.map((n) => n.midi)).toEqual([60, 67]);
    expect(notes[1].time).toBeCloseTo(0.75, 2);
    expect(notes[1].duration).toBeCloseTo(0.5, 2);
    expect(notes[0].velocity).toBeCloseTo(0.7, 1);
    const cc = midi.tracks[0].controlChanges[64];
    expect(cc.map((c) => c.value > 0.5)).toEqual([true, false]);
  });
});
