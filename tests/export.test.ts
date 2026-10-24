import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { libraryScore } from '../src/library';
import { PIECES } from '../src/library/pieces';
import { parseMidi } from '../src/score/midi';
import type { Score } from '../src/score/model';
import { parseMusicXML } from '../src/score/musicxml';
import { toMusicXML } from '../src/score/musicxml-export';
import { parseNotation } from '../src/score/notation';
import { readFileSync } from 'node:fs';

const shape = (s: Score) =>
  s.notes.map((n) => `${n.hand}${n.pitch}@${n.t.toFixed(3)}+${n.dur.toFixed(3)}:${n.finger ?? '-'}`).sort();

describe('MusicXML export', () => {
  it('round-trips every library piece: notes, hands, fingers, bars, sections, tempo', () => {
    for (const p of PIECES) {
      const a = libraryScore(p.id);
      const xml = toMusicXML(a, { software: 'koimidi test', date: '2026-10-25' });
      const b = parseMusicXML(xml, 'x');
      expect(b.title, p.id).toBe(a.title);
      expect(b.composer, p.id).toBe(a.composer);
      expect(shape(b), p.id).toEqual(shape(a));
      expect(b.measures.map((m) => [m.t, m.beats, m.section ?? '']), p.id).toEqual(a.measures.map((m) => [m.t, m.beats, m.section ?? '']));
      expect(b.tempo[0].bpm, p.id).toBeCloseTo(a.tempo[0].bpm, 2);
      expect(b.timeSig, p.id).toEqual(a.timeSig);
    }
  });

  it('ties notes across barlines and writes the finger once', () => {
    const { score } = parseNotation('time: 4/4\ntempo: 90\nR: C4/4:1 D4 E4 F4/4:4~ | F4/2 G4/4 r/4 |', 't');
    const xml = toMusicXML(score);
    expect(xml.match(/<fingering>4<\/fingering>/g)?.length).toBe(1);
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
    const back = parseMusicXML(xml, 't');
    const f = back.notes.find((n) => n.pitch === 65)!;
    expect([f.t, f.dur, f.finger]).toEqual([3, 3, 4]);
  });

  it('writes a left-hand-only piece on the lower staff so the hand survives', () => {
    const { score } = parseNotation('time: 3/4\ntempo: 100\nL: C3/4:5 E3:3 G3:1 | C3/2. |', 'l');
    const back = parseMusicXML(toMusicXML(score), 'l');
    expect(back.notes.every((n) => n.hand === 'L')).toBe(true);
    expect(shape(back)).toEqual(shape(score));
  });

  it('keeps pickups, triplets and chords', () => {
    const { score } = parseNotation('time: 3/4\ntempo: 80\npickup: 1\nR: G4/4:5 | C5/12 D5 E5 [C5 E5 G5]/2:135 | C5/2. |\nL: r/4 | C3/2. | C3/2. |', 'p');
    const xml = toMusicXML(score);
    expect(xml).toContain('implicit="yes"');
    expect(xml).toContain('<time-modification>');
    const back = parseMusicXML(xml, 'p');
    expect(shape(back)).toEqual(shape(score));
    expect(back.measures[0].beats).toBe(1);
  });

  it('exports a MIDI import and reads it back', () => {
    const bytes = readFileSync(`${process.cwd()}/tests/fixtures/ode-two-tracks.mid`);
    const a = parseMidi(new Uint8Array(bytes), 'm', 'ode.mid');
    const back = parseMusicXML(toMusicXML(a), 'm');
    expect(shape(back)).toEqual(shape(a));
  });

  it('rounds hand-played MIDI timing to a 1/24-beat grid', () => {
    const m = new Midi();
    m.header.setTempo(100);
    const tr = m.addTrack();
    const ppq = m.header.ppq;
    [60, 62, 64, 65].forEach((p, i) => tr.addNote({ midi: p, ticks: i * ppq + (i % 2 ? 7 : -3) + 3, durationTicks: ppq - 37 }));
    const a = parseMidi(m.toArray(), 'h', 'h.mid');
    const back = parseMusicXML(toMusicXML(a), 'h');
    expect(back.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 65]);
    for (const [i, n] of back.notes.entries()) {
      expect(Math.abs(n.t * 24 - Math.round(n.t * 24))).toBeLessThan(1e-6);
      expect(Math.abs(n.t - a.notes[i].t)).toBeLessThanOrEqual(1 / 48 + 1e-6);
    }
  });

  it('escapes titles', () => {
    const { score } = parseNotation('title: Rock & <Roll>\ntime: 4/4\nR: C4/1 |', 'e');
    const back = parseMusicXML(toMusicXML(score), 'e');
    expect(back.title).toBe('Rock & <Roll>');
  });
});
