import { describe, expect, it } from 'vitest';
import type { PassStats } from '../src/practice/engine';
import { accuracy, addPass, bestAccuracy, emptyProgress, MAX_PASSES, rhythm, samePasses, weakestBars } from '../src/practice/progress';

const pass = (over: Partial<PassStats> = {}): PassStats => ({
  from: 1, to: 4, mode: 'learn', hand: 'R', speed: 0.5, hits: 9, wrong: 1, misses: 0, seconds: 30, complete: true,
  bars: { 1: { hits: 3, wrong: 1, misses: 0 }, 2: { hits: 6, wrong: 0, misses: 0 } },
  ...over,
});

describe('progress', () => {
  it('accuracy is hits over everything played', () => {
    expect(accuracy({ hits: 9, wrong: 1, misses: 0 })).toBe(0.9);
    expect(accuracy({ hits: 6, wrong: 1, misses: 1 })).toBe(0.75);
    expect(accuracy({ hits: 0, wrong: 0, misses: 0 })).toBeNull();
  });

  it('adds time and bar counts from every pass, history only from complete ones', () => {
    const p = emptyProgress('x');
    expect(addPass(p, pass({ complete: false }), 1)).toBeNull();
    const r = addPass(p, pass(), 2)!;
    expect(p.seconds).toBe(60);
    expect(p.passes).toHaveLength(1);
    expect(p.bars[1]).toEqual({ hits: 6, wrong: 2, misses: 0 });
    expect(r).toEqual({ accuracy: 0.9, previousBest: null, count: 1, rhythm: null, lean: 0, pace: null });
  });

  it('compares with the best earlier pass over the same range, mode and hand', () => {
    const p = emptyProgress('x');
    addPass(p, pass({ hits: 8, wrong: 2 }));
    addPass(p, pass({ hits: 10, wrong: 0, mode: 'tempo' })); // another mode: not compared
    const r = addPass(p, pass({ hits: 9, wrong: 1 }))!;
    expect(r.previousBest).toBe(0.8);
    expect(r.count).toBe(2);
    expect(samePasses(p, 1, 4, 'learn', 'R')).toHaveLength(2);
    expect(bestAccuracy(p)).toBe(1);
  });

  it('keeps the rhythm per pass and per bar; older records simply have none', () => {
    const p = emptyProgress('x');
    addPass(p, pass()); // before the rhythm was judged
    const timed = pass({ onTime: 7, timed: 8, pace: 0.4, bars: { 1: { hits: 3, wrong: 1, misses: 0, onTime: 2, timed: 3 }, 2: { hits: 6, wrong: 0, misses: 0, onTime: 5, timed: 5 } } });
    const r = addPass(p, timed)!;
    expect(r.rhythm).toBe(7 / 8);
    expect(r.pace).toBe(0.4);
    addPass(p, timed);
    expect(rhythm(p.passes[0])).toBeNull();
    expect(rhythm(p.passes[1])).toBe(7 / 8);
    expect(p.passes[1].pace).toBe(0.4);
    expect(p.bars[1]).toEqual({ hits: 9, wrong: 3, misses: 0, onTime: 4, timed: 6 });
    expect(rhythm(p.bars[2])).toBe(1);
  });

  it('keeps the history bounded', () => {
    const p = emptyProgress('x');
    for (let i = 0; i < MAX_PASSES + 20; i++) addPass(p, pass(), i);
    expect(p.passes).toHaveLength(MAX_PASSES);
    expect(p.passes[0].at).toBe(20);
  });

  it('finds the weakest bars with enough notes played', () => {
    const p = emptyProgress('x');
    p.bars = {
      1: { hits: 10, wrong: 0, misses: 0 },
      2: { hits: 5, wrong: 5, misses: 0 },
      3: { hits: 7, wrong: 2, misses: 1 },
      4: { hits: 1, wrong: 2, misses: 0 }, // too few notes to judge
    };
    expect(weakestBars(p)).toEqual([2, 3]);
  });
});
