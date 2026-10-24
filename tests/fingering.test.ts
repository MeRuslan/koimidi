import { describe, expect, it } from 'vitest';
import { autoFinger } from '../src/score/fingering';
import { parseNotation } from '../src/score/notation';

function fingersOf(text: string, hand: 'R' | 'L' = 'R'): number[] {
  const { score } = parseNotation(`time: 4/4\n${text}`, 'f');
  autoFinger(score);
  return score.notes.filter((n) => n.hand === hand).map((n) => n.finger!);
}

describe('auto fingering', () => {
  it('fingers an ascending C major scale with a thumb-under', () => {
    const f = fingersOf('R: C4 D4 E4 F4 | G4 A4 B4 C5 |');
    expect(f).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });

  it('fingers a descending scale for the left hand mirror-wise', () => {
    const f = fingersOf('L: C4 B3 A3 G3 | F3 E3 D3 C3 |', 'L');
    expect(f).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });

  it('keeps fingers from the file', () => {
    const { score } = parseNotation('time: 4/4\nR: C4:2 D4 E4 F4 |', 'k');
    autoFinger(score);
    expect(score.notes[0].finger).toBe(2);
    expect(score.notes[0].fingerSource).toBe('file');
    expect(score.notes[1].fingerSource).toBe('auto');
  });

  it('never uses the same finger on two different consecutive keys in a fast run', () => {
    const f = fingersOf('R: C4/8 D4 E4 F4 G4 A4 G4 F4 | E4 D4 C4 D4 E4 F4 G4 A4 |');
    for (let i = 1; i < f.length; i++) expect(f[i]).not.toBe(f[i - 1]);
  });

  it('spreads chords from the thumb', () => {
    const { score } = parseNotation('time: 4/4\nR: [C4 E4 G4]/2 [C4 G4]/2 |', 'c');
    autoFinger(score);
    expect(score.notes.slice(0, 3).map((n) => n.finger)).toEqual([1, 3, 5]);
    expect(score.notes.slice(3).map((n) => n.finger)).toEqual([1, 5]);
  });
});
