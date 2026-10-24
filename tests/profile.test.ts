import { describe, expect, it } from 'vitest';
import { fits, guessSize, placeRange, presetRange } from '../src/input/profile';

describe('keyboard profile', () => {
  it('guesses the size from device names', () => {
    expect(guessSize(['Komplete Kontrol M32'])).toBe('32');
    expect(guessSize(['KOMPLETE KONTROL M32 MIDI'])).toBe('32');
    expect(guessSize(['Keystation 49 MK3'])).toBe('49');
    expect(guessSize(['MPK mini 3'])).toBe('25');
    expect(guessSize(['MPK249'])).toBe('49');
    expect(guessSize(['Arturia KeyStep 37'])).toBe('37');
    expect(guessSize(['Arturia KeyStep'])).toBe('32');
    expect(guessSize(['IAC Driver Bus 1'])).toBeNull();
  });

  it('places a small controller at the octave that fits the piece', () => {
    const m32 = presetRange('32'); // C3–G5
    // G#4..D6: fits one octave up
    const pl = placeRange(m32, [68, 70, 74, 86]);
    expect(pl.outside).toBe(0);
    expect(pl.shift).toBe(1);
    expect([pl.low, pl.high]).toEqual([60, 91]);
    // prefers no shift when the piece already fits
    expect(placeRange(m32, [60, 72]).shift).toBe(0);
  });

  it('reports notes that cannot fit at any octave', () => {
    const k25 = presetRange('25');
    const pl = placeRange(k25, [48, 50, 74, 76]);
    expect(pl.outside).toBeGreaterThan(0);
    expect(pl.needs).toBe(29);
    expect(fits(k25, 48, 72)).toBe(true);
    expect(fits(k25, 48, 73)).toBe(false);
    expect(fits(presetRange('88'), 21, 108)).toBe(true);
  });
});
