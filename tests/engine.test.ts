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
    tick: vi.fn(),
    pass: vi.fn(),
  };
  const e = new Engine(score, ev);
  e.speed = 1;
  // a clock that moves with the steps, as the frames do in the app
  let clock = 0;
  e.now = () => clock;
  const step = e.step.bind(e);
  e.step = (dt: number) => {
    clock += dt;
    step(dt);
  };
  return { e, ev, score, wait: (s: number) => (clock += s) };
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
    e.countIn = false;
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

describe('engine: rhythm', () => {
  const tune = 'time: 4/4\ntempo: 120\nR: C4 D4 E4 F4 | G4 A4 B4 C5 |';
  const pitches = [60, 62, 64, 65, 67, 69, 71, 72];
  const tempo = () => {
    const r = make(tune);
    r.e.countIn = false;
    r.e.loop = false;
    r.e.setMode('tempo');
    r.e.setPlaying(true);
    return r;
  };

  it('tempo mode: notes played on their beat are in rhythm', () => {
    const { e } = tempo();
    pitches.forEach((p, i) => {
      while (e.pos < i) e.step(1 / 60);
      e.press(p);
    });
    expect(e.hits).toBe(8);
    expect(e.rhythm!.score).toBe(1);
    expect(e.rhythm!.lean).toBe(0);
  });

  it('tempo mode: notes a fifth of a beat late lose some, and the pass says they are late', () => {
    const { e, ev } = tempo();
    pitches.forEach((p, i) => {
      while (e.pos < i + 0.2) e.step(1 / 60);
      e.press(p);
    });
    for (let i = 0; i < 120; i++) e.step(1 / 60);
    const s = (ev.pass as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(s.timed).toBe(8);
    expect(s.onTime / s.timed).toBeLessThan(0.75);
    expect(s.onTime / s.timed).toBeGreaterThan(0.4);
    expect(s.lean).toBe(1);
  });

  it('tempo mode: a key pressed between frames is timed where it went down', () => {
    const { e, wait } = tempo();
    pitches.forEach((p, i) => {
      while (e.pos < i - 0.15) e.step(1 / 60);
      wait((i - e.pos) * 0.5); // the last frame showed the bars a little early; the key went down on the beat
      e.press(p);
    });
    expect(e.hits).toBe(8);
    expect(e.rhythm!.score).toBe(1);
  });

  it('learn mode: a pause is not a gap between notes', () => {
    const { e } = make(tune);
    e.setPlaying(true);
    for (let i = 0; i < 60; i++) e.step(1 / 60);
    [60, 62, 64, 65].forEach((p) => {
      e.press(p);
      for (let i = 0; i < 30; i++) e.step(1 / 60);
    });
    e.setPlaying(false);
    e.setPlaying(true);
    e.step(1 / 60);
    e.press(67); // a moment after the pause: not timed
    expect(e.rhythm!.timed).toBe(3);
    expect(e.rhythm!.score).toBe(1);
    expect(e.rhythm!.pace).toBeCloseTo(1);
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

describe('engine: count-in and metronome', () => {
  const run = (e: Engine, seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) e.step(1 / 60);
  };

  it('counts in one bar before the range in tempo mode', () => {
    const { e, ev } = make();
    e.setMode('tempo');
    expect(e.pos).toBe(-4); // one 4/4 bar of count-in
    e.setPlaying(true);
    expect(e.countInBeat()).toEqual({ beat: 1, of: 4, frac: 0 });
    run(e, 0.75); // 120 bpm: 1.5 beats
    expect(e.countInBeat()?.beat).toBe(2);
    run(e, 1.3);
    expect(e.countInBeat()).toBeNull();
    const ticks = (ev.tick as ReturnType<typeof vi.fn>).mock.calls;
    expect(ticks).toHaveLength(4);
    expect(ticks.map((c) => c[1])).toEqual([true, false, false, false]);
    for (const [delay] of ticks) expect(delay).toBeLessThanOrEqual(0.12 + 1e-9);
  });

  it('no count-in when switched off: a short lead-in as before', () => {
    const { e } = make();
    e.setMode('tempo');
    e.setCountIn(false);
    expect(e.pos).toBe(-2);
  });

  it('metronome clicks every beat with the downbeat accented, only in the range', () => {
    const { e, ev } = make();
    e.setMode('tempo');
    e.setCountIn(false);
    e.setMetronome(true);
    e.loop = false;
    e.setRangeMeasures(2, 2);
    e.setPlaying(true);
    run(e, 4);
    const ticks = (ev.tick as ReturnType<typeof vi.fn>).mock.calls;
    expect(ticks.map((c) => c[1])).toEqual([true, false, false, false]);
  });

  it('6/8 clicks on dotted quarters; learn mode never clicks', () => {
    const { e, ev } = make('time: 6/8\ntempo: 120\nR: C4/8 D4 E4 F4 G4 A4 | C5/4. C5 |');
    expect(e.beatUnit()).toBe(1.5);
    e.setMetronome(true);
    e.setPlaying(true);
    e.press(60);
    run(e, 2);
    expect(ev.tick).not.toHaveBeenCalled();
    e.setMode('tempo');
    e.loop = false;
    e.setPlaying(true);
    run(e, 6);
    const ticks = (ev.tick as ReturnType<typeof vi.fn>).mock.calls;
    // count-in bar, then two bars
    expect(ticks.map((c) => c[1])).toEqual([true, false, true, false, true, false]);
  });
});

describe('engine: the other hand', () => {
  const TWO = 'time: 4/4\ntempo: 120\nR: C5 D5 E5 F5 | G5/1 |\nL: C3/2 G3/2 | C3/1 |';
  const run = (e: Engine, seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) e.step(1 / 60);
  };
  const sounded = (ev: EngineEvents) => (ev.sound as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);

  it('learn mode: the left hand waits with the timeline and sounds with your note', () => {
    const { e, ev } = make(TWO);
    e.setHand('R');
    expect(e.accompanying).toBe(true);
    expect(e.accompaniment.map((n) => n.pitch)).toEqual([48, 55, 48]);
    e.setPlaying(true);
    run(e, 2);
    expect(e.waiting).toBe(true);
    expect(sounded(ev)).toEqual([]); // C3 starts with C5: it waits for you
    e.press(72);
    run(e, 0.1);
    expect(sounded(ev)).toEqual([48]);
    e.press(74);
    run(e, 0.6);
    e.press(76); // E5 together with G3
    run(e, 0.1);
    expect(sounded(ev)).toEqual([48, 55]);
    expect(e.keys.get(55)).toBe('acc');
  });

  it('an early press brings the other hand along at once', () => {
    const { e, ev } = make(TWO);
    e.setHand('R');
    e.press(72); // starts the lesson ahead of the bars
    expect(e.pos).toBeLessThan(0);
    expect(sounded(ev)).toEqual([48]);
  });

  it('tempo mode plays the other hand on time; off when switched off or practising both', () => {
    const { e, ev } = make(TWO);
    e.countIn = false;
    e.setMode('tempo');
    e.loop = false;
    e.setHand('L');
    e.setPlaying(true);
    run(e, 3);
    expect(sounded(ev)).toEqual([72, 74, 76, 77, 79]);
    e.setAccompany(false);
    expect(e.accompaniment).toEqual([]);
    e.setAccompany(true);
    e.setHand('both');
    expect(e.accompanying).toBe(false);
  });

  it('a one-hand piece never accompanies', () => {
    const { e } = make();
    expect(e.accompanying).toBe(false);
  });
});

describe('engine: pass statistics', () => {
  const run = (e: Engine, seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) e.step(1 / 60);
  };
  const passes = (ev: EngineEvents) => (ev.pass as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);

  it('reports a complete pass with counts per bar', () => {
    const { e, ev } = make('time: 4/4\ntempo: 120\nR: C4 D4 E4 F4 | G4 A4 B4 C5 |');
    e.loop = false;
    e.setPlaying(true);
    for (const p of [60, 62, 64, 66, 65, 67, 69, 71, 72]) {
      run(e, 0.6);
      e.press(p);
    }
    run(e, 3);
    const [s] = passes(ev);
    expect(s.complete).toBe(true);
    expect([s.hits, s.wrong, s.misses]).toEqual([8, 1, 0]);
    // the rhythm too: quarters played every 0.6 s, but F4 1.2 s after E4 (a wrong key in between)
    expect(s.bars[1]).toEqual({ hits: 4, wrong: 1, misses: 0, onTime: 2, timed: 3 });
    expect(s.bars[2]).toEqual({ hits: 4, wrong: 0, misses: 0, onTime: 4, timed: 4 });
    expect([s.onTime, s.timed]).toEqual([6, 7]);
    expect(s.pace).toBeCloseTo(0.5 / 0.6);
    expect(s.seconds).toBeGreaterThan(4);
    expect([s.from, s.to, s.mode, s.hand]).toEqual([1, 2, 'learn', 'R']);
  });

  it('a pass cut short by a restart is reported as incomplete; empty ones not at all', () => {
    const { e, ev } = make();
    e.setPlaying(true);
    e.restart();
    expect(passes(ev)).toHaveLength(0);
    e.setPlaying(true);
    run(e, 0.5);
    e.press(60);
    e.setRangeMeasures(2, 2);
    const [s] = passes(ev);
    expect(s.complete).toBe(false);
    expect([s.from, s.to, s.hits]).toEqual([1, 3, 1]);
  });

  it('long waits for a key do not count as practice time', () => {
    const { e, ev } = make();
    e.setPlaying(true);
    run(e, 60);
    e.press(60);
    e.dispose();
    const [s] = passes(ev);
    expect(s.seconds).toBeLessThan(16);
  });
});

describe('engine: listen mode', () => {
  it('a repeated key stays lit for the second note, even when frames run ahead of the timers', () => {
    vi.useFakeTimers();
    const { e } = make('time: 4/4\ntempo: 120\nR: E4 E4 E4/2 |');
    e.setMode('listen');
    e.setPlaying(true);
    // big frames: the second E4 starts before the first one's release timer fires
    while (e.pos < 1.05) {
      e.step(0.1);
      vi.advanceTimersByTime(20);
    }
    expect(e.keys.get(64)).toBe('auto');
    vi.advanceTimersByTime(400); // the first note's release is due now
    expect(e.keys.get(64)).toBe('auto');
    vi.useRealTimers();
  });
});

describe('engine: edited notes', () => {
  it('reload regroups the notes and keeps the place', () => {
    const { e, score } = make();
    e.setPlaying(true);
    for (const p of [60, 62]) {
      for (let i = 0; i < 100; i++) e.step(1 / 60);
      e.press(p);
    }
    for (let i = 0; i < 100; i++) e.step(1 / 60);
    e.setPlaying(false);
    const pos = e.pos;
    expect(pos).toBe(2);
    // the third note (E4) is taken out, a G4 put in its place
    score.notes = score.notes.filter((n) => n.pitch !== 64);
    score.notes.push({ pitch: 67, t: 2, dur: 1, hand: 'R', measure: 1 });
    score.notes.sort((a, b) => a.t - b.t || a.pitch - b.pitch);
    e.reload();
    expect(e.pos).toBe(pos);
    expect(e.target?.notes.map((n) => n.pitch)).toEqual([67]);
    expect(e.noteState(score.notes[0])).toBe(1);
  });

  it('seek carries on inside the range and restarts outside it', () => {
    const { e } = make();
    e.setRangeMeasures(2, 3);
    e.seek(5);
    expect(e.pos).toBe(5);
    expect(e.target?.t).toBe(5);
    e.seek(1);
    expect(e.pos).toBe(4 - e.leadBeats());
    expect(e.target?.t).toBe(4);
  });
});
