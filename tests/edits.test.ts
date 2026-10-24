import { describe, expect, it } from 'vitest';
import { applyEdits, clearEdits, noteKey, setFinger, suggestedSource, type FingerEdits } from '../src/score/edits';
import { autoFinger } from '../src/score/fingering';
import { parseNotation } from '../src/score/notation';

function scale() {
  const { score } = parseNotation('time: 4/4\ntempo: 100\nR: C4 D4 E4 F4 | G4 A4 B4 C5 | C5 B4 A4 G4 | F4 E4 D4 C4 |', 's');
  autoFinger(score);
  return score;
}

describe('finger edits', () => {
  it('a user finger is kept and the automatic fingering works around it', () => {
    const s = scale();
    const before = s.notes.map((n) => n.finger);
    const edits: FingerEdits = {};
    const e4 = s.notes[2];
    setFinger(s, e4, 1, edits);
    expect(e4.finger).toBe(1);
    expect(e4.fingerSource).toBe('user');
    expect(edits[noteKey(e4)]).toBe(1);
    // a thumb on E forces a different path through the neighbours
    expect(s.notes.map((n) => n.finger)).not.toEqual(before);
    expect(s.notes.filter((n) => n.fingerSource === 'user')).toHaveLength(1);
  });

  it('edits re-apply to a freshly parsed copy of the same piece', () => {
    const a = scale();
    const edits: FingerEdits = {};
    setFinger(a, a.notes[2], 1, edits);
    setFinger(a, a.notes[9], 4, edits);
    const b = scale();
    expect(applyEdits(b, edits)).toBe(2);
    expect(b.notes.map((n) => n.finger)).toEqual(a.notes.map((n) => n.finger));
  });

  it('going back to the suggestion restores the automatic or the file finger', () => {
    const { score } = parseNotation('time: 4/4\ntempo: 100\nR: C4:1 D4 E4 F4 |', 'f');
    autoFinger(score);
    const edits: FingerEdits = {};
    const c4 = score.notes[0];
    setFinger(score, c4, 2, edits);
    expect(suggestedSource(c4)).toBe('file');
    setFinger(score, c4, undefined, edits);
    expect([c4.finger, c4.fingerSource]).toEqual([1, 'file']);
    const d4 = score.notes[1];
    const auto = d4.finger;
    setFinger(score, d4, 5, edits);
    clearEdits(score, edits);
    expect(edits).toEqual({});
    expect([d4.finger, d4.fingerSource]).toEqual([auto, 'auto']);
  });

  it('a user finger on the top note of a chord is respected', () => {
    const { score } = parseNotation('time: 4/4\ntempo: 100\nR: [C4 E4 G4]/2 [D4 F4 A4]/2 |', 'c');
    autoFinger(score);
    const edits: FingerEdits = {};
    const g4 = score.notes.find((n) => n.pitch === 67)!;
    setFinger(score, g4, 4, edits);
    expect(g4.finger).toBe(4);
  });
});
