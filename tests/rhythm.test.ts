import { describe, expect, it } from 'vitest';
import { gapScore, hitScore, RhythmTally } from '../src/practice/rhythm';

describe('rhythm', () => {
  it('a note is on time within a share of the beat, never less than 60 ms, and gets nothing far off', () => {
    // 120 bpm: a beat of 0.5 s, on time within 60 ms, nothing from 175 ms
    expect(hitScore(0, 0.5)).toBe(1);
    expect(hitScore(-0.05, 0.5)).toBe(1);
    expect(hitScore(0.1175, 0.5)).toBeCloseTo(0.5);
    expect(hitScore(-0.2, 0.5)).toBe(0);
    // slower, the bars fall slower too: 0.3 s late is still worth something with a 2 s beat
    expect(hitScore(0.3, 2)).toBeCloseTo((0.7 - 0.3) / (0.7 - 0.16));
    expect(hitScore(0.3, 0.5)).toBe(0);
  });

  it('a gap is right within 15% or 80 ms of the expected one, and gets nothing at 1.8 times', () => {
    expect(gapScore(1, 1)).toBe(1);
    expect(gapScore(1.12, 1)).toBe(1);
    expect(gapScore(0.87, 1)).toBe(1);
    expect(gapScore(0.17, 0.1)).toBe(1); // 70 ms off a short gap
    expect(gapScore(2, 1)).toBe(0);
    expect(gapScore(0.5, 1)).toBe(0);
    const mid = gapScore(1.4, 1);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
  });

  it('learn mode: even playing at your own tempo is in rhythm, and the tempo is measured', () => {
    const r = new RhythmTally();
    // quarter, quarter, half, quarter at 120 bpm (0.5, 0.5, 1, 0.5 s), played at a third of the tempo
    [0.5, 0.5, 1, 0.5].forEach((due, i) => r.gap(1 + (i >> 1), due, due * 3));
    const s = r.summary!;
    expect(s.score).toBe(1);
    expect(s.pace).toBeCloseTo(1 / 3);
    expect(s.bars).toEqual({ 1: { onTime: 2, timed: 2 }, 2: { onTime: 2, timed: 2 } });
  });

  it('learn mode: a half note played as short as the quarters is off', () => {
    const r = new RhythmTally();
    [0.5, 0.5, 1, 0.5, 0.5].forEach((due) => r.gap(1, due, 1));
    const s = r.summary!;
    expect(s.score).toBeCloseTo(4 / 5);
    expect(s.pace).toBeCloseTo(0.5);
  });

  it('tempo mode: notes played late on the whole say so', () => {
    const r = new RhythmTally();
    for (let i = 0; i < 6; i++) r.hit(1, 0.1, 0.5);
    const s = r.summary!;
    expect(s.lean).toBe(1);
    expect(s.pace).toBeNull();
    expect(s.score).toBeCloseTo((0.175 - 0.1) / (0.175 - 0.06));
    const even = new RhythmTally();
    [-0.03, 0.02, 0.01, -0.02].forEach((d) => even.hit(1, d, 0.5));
    expect(even.summary!.lean).toBe(0);
    expect(even.summary!.score).toBe(1);
  });

  it('says nothing with fewer than three notes timed', () => {
    const r = new RhythmTally();
    r.hit(1, 0, 0.5);
    r.hit(1, 0, 0.5);
    expect(r.summary).toBeNull();
    r.hit(1, 0, 0.5);
    expect(r.summary?.timed).toBe(3);
  });
});
