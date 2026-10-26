import { describe, expect, it } from 'vitest';
import { noteKey } from '../src/score/edits';
import { autoFinger } from '../src/score/fingering';
import { emptyNoteEdits, guessHand, hasNoteEdits, PieceEditor, roomUntil, snapBeat, type PieceEdits } from '../src/score/note-edits';
import { parseNotation } from '../src/score/notation';

const TEXT = 'time: 4/4\ntempo: 100\nR: C4 D4 E4 F4 | G4 A4 B4 C5 |\nL: C3/4 G3/4 |';

function piece(text = TEXT) {
  const { score } = parseNotation(text, 'p');
  autoFinger(score);
  return score;
}

function fresh(): PieceEdits {
  return { fingers: {}, notes: emptyNoteEdits() };
}

const shape = (s: ReturnType<typeof piece>) => s.notes.map((n) => `${n.hand}${n.pitch}@${n.t}+${n.dur}:${n.finger}`);

describe('note edits', () => {
  it('a note put in sits in its bar, gets a finger and is kept for the next opening', () => {
    const s = piece();
    const ed = new PieceEditor(s, fresh());
    const n = ed.add({ pitch: 64, t: 4.5, dur: 0.5, hand: 'R' });
    expect(s.notes).toContain(n);
    expect(n.measure).toBe(2);
    expect(n.finger).toBeDefined();
    expect(n.fingerSource).toBe('auto');
    expect(s.notes.map((x) => x.t)).toEqual([...s.notes.map((x) => x.t)].sort((a, b) => a - b));
    const again = piece();
    new PieceEditor(again, structuredClone(ed.edits));
    expect(shape(again)).toEqual(shape(s));
  });

  it('taking out a file note is remembered by its key; taking out an added one forgets it', () => {
    const s = piece();
    const ed = new PieceEditor(s, fresh());
    const before = s.notes.length;
    const e4 = s.notes.find((n) => n.pitch === 64)!;
    ed.remove(e4);
    expect(s.notes).toHaveLength(before - 1);
    expect(ed.edits.notes.removed).toEqual([noteKey(e4)]);
    const added = ed.add({ pitch: 65, t: 2, dur: 1, hand: 'R' });
    ed.remove(added);
    expect(ed.edits.notes.added).toEqual([]);
    expect(s.notes).toHaveLength(before - 1);
  });

  it('a moved note takes its finger along, and moving it back leaves no edit', () => {
    const s = piece();
    const ed = new PieceEditor(s, fresh());
    const d4 = s.notes.find((n) => n.pitch === 62)!;
    ed.setFinger(d4, 4);
    const moved = ed.change(d4, { pitch: 63 });
    expect(moved.pitch).toBe(63);
    expect(moved.finger).toBe(4);
    expect(moved.fingerSource).toBe('user');
    expect(ed.edits.fingers).toEqual({ [noteKey(moved)]: 4 });
    expect(s.notes.some((n) => n.pitch === 62)).toBe(false);
    const back = ed.change(moved, { pitch: 62 });
    expect(hasNoteEdits(ed.edits.notes)).toBe(false);
    expect(back.pitch).toBe(62);
    expect(back.finger).toBe(4);
  });

  it('length and hand change; the hands of the piece follow', () => {
    const s = piece('time: 4/4\ntempo: 100\nR: C4 D4 E4 F4 |');
    const ed = new PieceEditor(s, fresh());
    expect(s.hands).toEqual({ R: true, L: false });
    const c4 = s.notes[0];
    const longer = ed.change(c4, { dur: 2 });
    expect(longer.dur).toBe(2);
    const left = ed.change(longer, { hand: 'L' });
    expect(left.hand).toBe('L');
    expect(s.hands).toEqual({ R: true, L: true });
    expect(ed.change(left, {})).toBe(left);
  });

  it('undo and redo step through notes and fingers alike', () => {
    const s = piece();
    const ed = new PieceEditor(s, fresh());
    const start = shape(s);
    const n = ed.add({ pitch: 67, t: 1.5, dur: 0.5, hand: 'R' });
    const afterAdd = shape(s);
    ed.setFinger(n, 5);
    const afterFinger = shape(s);
    ed.remove(s.notes[0]);
    expect(ed.undo()).toBe(true);
    expect(shape(s)).toEqual(afterFinger);
    expect(ed.undo()).toBe(true);
    expect(shape(s)).toEqual(afterAdd);
    expect(ed.undo()).toBe(true);
    expect(shape(s)).toEqual(start);
    expect(ed.undo()).toBe(false);
    expect(ed.redo()).toBe(true);
    expect(ed.redo()).toBe(true);
    expect(shape(s)).toEqual(afterFinger);
    ed.clearNotes();
    expect(shape(s)).toEqual(start);
    expect(ed.canRedo).toBe(false);
    expect(ed.edits.fingers).toEqual({});
  });

  it('a new note goes to the hand playing nearby', () => {
    const s = piece();
    expect(guessHand(s, 50, 0)).toBe('L');
    expect(guessHand(s, 66, 1)).toBe('R');
    expect(guessHand(s, 40, 100)).toBe('L'); // nothing nearby: below middle C
  });

  it('times snap to the grid or to a note starting nearby', () => {
    expect(snapBeat(1.13, 0.25, [], 0.1)).toBe(1.25);
    expect(snapBeat(1.13, 0.25, [1.1], 0.1)).toBe(1.1);
    expect(snapBeat(1.13, 0.25, [1.3], 0.1)).toBe(1.25);
  });

  it('a new note ends before the next one on the same key', () => {
    const s = piece();
    expect(roomUntil(s, 60, 0.5)).toBe(s.end);
    expect(roomUntil(s, 62, 0.5)).toBe(1);
  });
});
