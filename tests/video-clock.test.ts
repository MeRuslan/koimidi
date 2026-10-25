import { describe, expect, it } from 'vitest';
import { parseNotation } from '../src/score/notation';
import { fitOffset, secondsAt, videoRate, videoTime } from '../src/video/clock';
import { transcribe } from '../src/video/transcribe';
import type { RawNote } from '../src/video/tracker';

const score = (text: string) => parseNotation(text, 'c').score;

describe('beats to seconds', () => {
  it('counts seconds at the piece tempo, before beat 0 too', () => {
    const s = score('time: 4/4\ntempo: 120\nR: C4 D4 E4 F4 | G4 A4 B4 C5 |');
    expect(secondsAt(s, 0)).toBe(0);
    expect(secondsAt(s, 4)).toBeCloseTo(2);
    expect(secondsAt(s, 1.5)).toBeCloseTo(0.75);
    expect(secondsAt(s, -2)).toBeCloseTo(-1);
  });

  it('follows tempo changes along the way', () => {
    const s = {
      tempo: [
        { t: 0, bpm: 60 },
        { t: 4, bpm: 120 },
      ],
    };
    expect(secondsAt(s, 4)).toBeCloseTo(4);
    expect(secondsAt(s, 6)).toBeCloseTo(5);
    expect(secondsAt(s, 8)).toBeCloseTo(6);
  });

  it('places a position in the video from the second of beat 0', () => {
    const s = score('time: 3/4\ntempo: 90\nR: C4 D4 E4 | F4 G4 A4 |');
    expect(videoTime(12.5, s, 0)).toBeCloseTo(12.5);
    expect(videoTime(12.5, s, 3)).toBeCloseTo(14.5);
    // the lead-in before the first bar lands before the piece in the video
    expect(videoTime(12.5, s, -2)).toBeCloseTo(12.5 - 4 / 3);
  });

  it('keeps the player rate within what YouTube allows', () => {
    expect(videoRate(1)).toBe(1);
    expect(videoRate(0.5)).toBe(0.5);
    expect(videoRate(0.2)).toBe(0.25);
    expect(videoRate(3)).toBe(2);
  });
});

describe('the capture clock against the video clock', () => {
  it('finds the offset from samples at normal and at half speed', () => {
    // the video was at 30 s when the capture started, watched at full speed
    const full = Array.from({ length: 20 }, (_, i) => ({ c: 1 + i * 0.15, v: 31 + i * 0.15 }));
    expect(fitOffset(full, 1)).toBeCloseTo(30, 6);
    // at half speed the video gains half a second per second of capture
    const half = Array.from({ length: 20 }, (_, i) => ({ c: 2 + i * 0.15, v: 31 + i * 0.075 }));
    expect(fitOffset(half, 0.5)).toBeCloseTo(30, 6);
  });

  it('ignores samples from while the player was seeking or buffering', () => {
    const good = Array.from({ length: 12 }, (_, i) => ({ c: i * 0.5, v: 10 + i * 0.5 }));
    const stuck = [
      { c: 0.1, v: 0 },
      { c: 0.2, v: 0 },
      { c: 3.1, v: 11.5 },
    ];
    expect(fitOffset([...stuck, ...good], 1)).toBeCloseTo(10, 6);
  });

  it('wants at least three samples', () => {
    expect(fitOffset([{ c: 0, v: 1 }], 1)).toBeNull();
    expect(fitOffset([], 1)).toBeNull();
  });
});

describe('the first bar in the capture clock', () => {
  /** Two bars of 4/4 at 120 bpm, bass notes on the downbeats, repeated; the first downbeat at `from` seconds. */
  const piece = (from: number, stretch = 1): RawNote[] => {
    const raw: RawNote[] = [];
    const green: [number, number, number] = [126, 226, 132];
    const blue: [number, number, number] = [124, 178, 255];
    const melody = [72, 74, 76, 77, 79, 77, 76, 74];
    for (let bar = 0; bar < 8; bar++) {
      for (let k = 0; k < 8; k++) {
        const on = from + (bar * 4 + k * 0.5) * stretch;
        raw.push({ pitch: melody[k], on, off: on + 0.42 * stretch, color: green });
      }
      const on = from + bar * 4 * stretch;
      raw.push({ pitch: 48, on, off: on + 1.8 * stretch, color: blue });
      raw.push({ pitch: 52 + (bar % 2), on: on + 2 * stretch, off: on + 3.8 * stretch, color: blue });
    }
    return raw;
  };

  it('is the second the first downbeat was seen at', () => {
    const tr = transcribe(piece(17.3));
    expect(tr.timeSig).toEqual([4, 4]);
    expect(tr.bpm).toBeCloseTo(120, 0);
    expect(tr.start).toBeCloseTo(17.3, 1);
    expect(tr.notes[0].t).toBe(0);
  });

  it('moves with the bar lines when they are shifted, the notes staying where they were seen', () => {
    for (const shift of [1, -1]) {
      const tr = transcribe(piece(17.3), { shift });
      // the first bar now begins before the first note: a beat earlier, or three
      expect(tr.notes[0].t).toBe(shift > 0 ? 3 : 1);
      expect(tr.start! + (tr.notes[0].t * 60) / tr.bpm).toBeCloseTo(17.3, 1);
    }
  });

  it('stays in the capture clock at half speed, while the tempo is the real one', () => {
    const tr = transcribe(piece(17.3, 2), { speed: 0.5 });
    expect(tr.bpm).toBeCloseTo(120, 0);
    expect(tr.start).toBeCloseTo(17.3, 1);
  });

  it('is absent without notes', () => {
    expect(transcribe([]).start).toBeUndefined();
  });
});
