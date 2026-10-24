import { describe, expect, it } from 'vitest';
import { parseNotation, parsePitch } from '../src/score/notation';

describe('notation', () => {
  it('parses pitches', () => {
    expect(parsePitch('C4')).toBe(60);
    expect(parsePitch('A4')).toBe(69);
    expect(parsePitch('C#4')).toBe(61);
    expect(parsePitch('Bb3')).toBe(58);
    expect(parsePitch('D#5')).toBe(75);
  });

  it('parses durations, dots, fingers, ties and chords', () => {
    const { score } = parseNotation(
      `title: T\ntime: 4/4\ntempo: 120\nR: C4:1 D4/8. E4/16 F4/4 G4/4~ | G4/4 r/4 [A4 C5]/2:35 |`,
      't',
    );
    const n = score.notes;
    expect(n.map((x) => [x.pitch, x.t, x.dur])).toEqual([
      [60, 0, 1],
      [62, 1, 0.75],
      [64, 1.75, 0.25],
      [65, 2, 1],
      [67, 3, 2], // G4/4 tied to G4/4
      [69, 6, 2],
      [72, 6, 2],
    ]);
    expect(n[0].finger).toBe(1);
    expect(n[0].fingerSource).toBe('file');
    expect(n[5].finger).toBe(3);
    expect(n[6].finger).toBe(5);
    expect(score.measures.length).toBe(2);
    expect(score.end).toBe(8);
  });

  it('rejects a barline inside a measure', () => {
    expect(() => parseNotation(`time: 4/4\nR: C4 D4 E4 | F4 |`, 'bad')).toThrow(/barline/);
  });

  it('handles pickup measures and sections', () => {
    const { score } = parseNotation(`time: 3/4\npickup: 1\nR: G4 | @A C5 C5 C5 | @B D5/2. |`, 'p');
    expect(score.measures.map((m) => [m.number, m.t, m.beats])).toEqual([
      [1, 0, 1],
      [2, 1, 3],
      [3, 4, 3],
    ]);
    expect(score.measures[1].section).toBe('A');
    expect(score.measures[2].section).toBe('B');
    expect(score.notes[1].measure).toBe(2);
  });

  it('keeps two hands in sync and reports hands', () => {
    const { score } = parseNotation(`time: 2/4\nR: C5 D5 | E5/2 |\nL: C3/2 | G2/2 |`, 'h');
    expect(score.hands).toEqual({ R: true, L: true });
    expect(score.notes.filter((n) => n.hand === 'L').map((n) => n.t)).toEqual([0, 2]);
  });
});
