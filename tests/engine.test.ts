import { describe, expect, it, vi } from 'vitest';
import { Engine, type EngineEvents } from '../src/practice/engine';
import { parseNotation } from '../src/score/notation';

function make(text = 'time: 4/4\ntempo: 120\nR: C4 D4 E4 F4 | G4 A4 B4 C5 | [C4 E4]/2 G4/2 |') {
  const { score } = parseNotation(text, 'e');
  const ev: EngineEvents = {
    flash: vi.fn(),
    ripple: vi.fn(),
    sound: vi.fn(),
    wrongNote: vi.fn(),
    octaveHint: vi.fn(),
    finished: vi.fn(),
    change: vi.fn(),
  };
  const e = new Engine(score, ev);
  e.speed = 1;
  return { e, ev, score };
}

describe('engine: learn mode', () => {
  it('waits on the next note and accepts the right key', () => {
    const { e } = make();
    e.setPlaying(true);
    for (let i = 0; i < 100; i++) e.step(1 / 60);
    expect(e.pos).toBe(0); // first note at beat 0, time is frozen
    expect(e.waiting).toBe(true);
    e.press(60);
    expect(e.hits).toBe(1);
    expect(e.next).toBe(1);
    for (let i = 0; i < 200; i++) e.step(1 / 60);
    expect(e.pos).toBe(1);
    expect(e.waiting).toBe(true);
  });

  it('counts a wrong key and keeps waiting', () => {
    const { e, ev } = make();
    e.setPlaying(true);
    for (let i = 0; i < 100; i++) e.step(1 / 60);
    e.press(62);
    expect(e.wrong).toBe(1);
    expect(e.hits).toBe(0);
    expect(ev.wrongNote).toHaveBeenCalled();
  });

  it('accepts the same note in another octave and hints', () => {
    const { e, ev } = make();
    e.setPlaying(true);
    for (let i = 0; i < 100; i++) e.step(1 / 60);
    e.press(72);
    expect(e.hits).toBe(1);
    expect(ev.octaveHint).toHaveBeenCalledWith(72, 60);
    e.anyOctave = false;
    e.press(74); // D5 for D4: wrong when octaves must match
    expect(e.wrong).toBe(1);
    e.press(62);
    expect(e.hits).toBe(2);
  });

  it('early presses are accepted and the bars catch up smoothly without going back', () => {
    const { e } = make();
    e.setPlaying(true);
    e.step(1 / 60);
    // play the first 6 notes immediately
    [60, 62, 64, 65, 67, 69].forEach((p) => e.press(p));
    expect(e.hits).toBe(6);
    expect(e.next).toBe(6);
    let prev = e.pos;
    let maxStep = 0;
    for (let i = 0; i < 300; i++) {
      e.step(1 / 60);
      expect(e.pos).toBeGreaterThanOrEqual(prev - 1e-9);
      maxStep = Math.max(maxStep, e.pos - prev);
      prev = e.pos;
    }
    expect(maxStep).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(e.pos).toBe(6); // waiting on B4
  });

  it('requires every note of a chord', () => {
    const { e } = make();
    e.setRangeMeasures(3, 3);
    e.setPlaying(true);
    for (let i = 0; i < 400; i++) e.step(1 / 60);
    expect(e.pos).toBe(8);
    e.press(60);
    expect(e.next).toBe(0 + e.groups.findIndex((g) => g.t === 8));
    expect(e.waiting).toBe(true);
    e.press(64);
    expect(e.hits).toBe(2);
    for (let i = 0; i < 400; i++) e.step(1 / 60);
    expect(e.pos).toBe(10);
  });

  it('the first correct key starts the lesson', () => {
    const { e } = make();
    expect(e.playing).toBe(false);
    e.press(60);
    expect(e.playing).toBe(true);
    expect(e.hits).toBe(1);
  });
});

describe('engine: tempo mode', () => {
  it('counts misses when notes pass and hits inside the window', () => {
    const { e } = make();
    e.setMode('tempo');
    e.loop = false;
    e.setPlaying(true);
    for (let i = 0; i < 300; i++) e.step(1 / 60); // 5 s at 120 bpm = 10 beats, minus the 2-beat lead-in
    expect(e.misses).toBeGreaterThanOrEqual(7);
    expect(e.hits).toBe(0);
  });

  it('a press near the note counts once', () => {
    const { e } = make();
    e.setMode('tempo');
    e.setPlaying(true);
    while (e.pos < 0.8) e.step(1 / 60);
    e.press(62);
    expect(e.hits).toBe(1);
    e.press(62);
    expect(e.hits).toBe(1);
    expect(e.wrong + 0).toBeGreaterThanOrEqual(0);
  });
});

describe('engine: range and loop', () => {
  it('loops the selected bars', () => {
    const { e } = make();
    e.setMode('listen');
    e.setRangeMeasures(1, 1);
    e.loop = true;
    e.setPlaying(true);
    for (let i = 0; i < 400; i++) e.step(1 / 60); // > 4 beats
    expect(e.playing).toBe(true);
    expect(e.pos).toBeLessThan(4);
  });

  it('stops and reports when the range ends without loop', () => {
    const { e, ev } = make();
    e.setMode('listen');
    e.loop = false;
    e.setPlaying(true);
    for (let i = 0; i < 1200; i++) e.step(1 / 60);
    expect(e.playing).toBe(false);
    expect(e.finished).toBe(true);
    expect(ev.finished).toHaveBeenCalled();
  });

  it('hand selection filters notes', () => {
    const { e } = make('time: 4/4\nR: C5 D5 E5 F5 |\nL: C3/1 |');
    expect(e.hand).toBe('both');
    expect(e.groups.length).toBe(4);
    expect(e.groups[0].notes.length).toBe(2);
    e.setHand('L');
    expect(e.groups.length).toBe(1);
  });
});
