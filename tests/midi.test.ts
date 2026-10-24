import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { parseMidi } from '../src/score/midi';

function makeMidi(two: boolean): Uint8Array {
  const m = new Midi();
  m.header.setTempo(100);
  m.header.timeSignatures.push({ ticks: 0, timeSignature: [3, 4] });
  const ppq = m.header.ppq;
  const t1 = m.addTrack();
  t1.name = 'Right';
  [72, 74, 76, 77, 79].forEach((p, i) => t1.addNote({ midi: p, ticks: i * ppq, durationTicks: ppq }));
  if (two) {
    const t2 = m.addTrack();
    [48, 43].forEach((p, i) => t2.addNote({ midi: p, ticks: i * 3 * ppq, durationTicks: 3 * ppq }));
  }
  return m.toArray();
}

describe('midi', () => {
  it('imports tempo, time signature and two tracks as two hands', () => {
    const s = parseMidi(makeMidi(true), 'm', 'song.mid');
    expect(s.tempo[0].bpm).toBeCloseTo(100, 3);
    expect(s.timeSig).toEqual([3, 4]);
    expect(s.hands).toEqual({ R: true, L: true });
    expect(s.notes.filter((n) => n.hand === 'R').map((n) => n.pitch)).toEqual([72, 74, 76, 77, 79]);
    expect(s.notes.filter((n) => n.hand === 'L').map((n) => n.t)).toEqual([0, 3]);
    expect(s.measures.length).toBe(2);
  });

  it('single track is the right hand; middle-C split moves low notes left', () => {
    const one = parseMidi(makeMidi(false), 'm', 'song.mid');
    expect(one.hands).toEqual({ R: true, L: false });
    const m = new Midi();
    const tr = m.addTrack();
    [36, 40, 43, 72, 76, 79].forEach((p, i) => tr.addNote({ midi: p, ticks: i * m.header.ppq, durationTicks: m.header.ppq }));
    const split = parseMidi(m.toArray(), 'm2', 'x.mid', { split: 'middleC' });
    expect(split.notes.filter((n) => n.hand === 'L').length).toBe(3);
    const auto = parseMidi(m.toArray(), 'm3', 'x.mid');
    expect(auto.hands.L).toBe(true);
  });
});
