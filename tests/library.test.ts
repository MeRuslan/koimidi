import { describe, expect, it } from 'vitest';
import { libraryItems, libraryScore } from '../src/library';
import { PIECES } from '../src/library/pieces';
import { EPS } from '../src/score/model';

describe('library', () => {
  it('every piece parses, has notes and complete measures', () => {
    for (const p of PIECES) {
      const s = libraryScore(p.id);
      expect(s.notes.length, p.id).toBeGreaterThan(8);
      expect(s.measures.length, p.id).toBeGreaterThan(4);
      // the last measure may be short only to complement a pickup
      const last = s.measures[s.measures.length - 1];
      expect(last.t + last.beats, `${p.id} ends mid-measure`).toBeGreaterThanOrEqual(s.end - EPS);
      // notes never overlap the same pitch in the same hand
      const byKey = new Map<string, number>();
      for (const n of s.notes) {
        const k = `${n.hand}|${n.pitch}`;
        const prevEnd = byKey.get(k) ?? -1;
        expect(n.t + EPS, `${p.id}: overlapping ${n.pitch} at ${n.t}`).toBeGreaterThanOrEqual(prevEnd - 1e-3);
        byKey.set(k, n.t + n.dur);
      }
    }
  });

  it('every note gets a finger 1–5', () => {
    for (const p of PIECES) {
      const s = libraryScore(p.id);
      for (const n of s.notes) {
        expect(n.finger, `${p.id} ${n.pitch}@${n.t}`).toBeGreaterThanOrEqual(1);
        expect(n.finger).toBeLessThanOrEqual(5);
      }
    }
  });

  it('two-hand pieces keep both streams the same length', () => {
    for (const p of PIECES) {
      const s = libraryScore(p.id);
      if (!s.hands.L) continue;
      const endR = Math.max(...s.notes.filter((n) => n.hand === 'R').map((n) => n.t + n.dur));
      const endL = Math.max(...s.notes.filter((n) => n.hand === 'L').map((n) => n.t + n.dur));
      // the left hand of Für Elise ends on its last arpeggio, within the final bar
      expect(Math.abs(endR - endL), p.id).toBeLessThan(2);
    }
  });

  it('lists metadata', () => {
    const items = libraryItems();
    expect(items.length).toBe(PIECES.length);
    for (const it of items) {
      expect(it.title).toBeTruthy();
      expect(it.difficulty).toBeGreaterThanOrEqual(1);
      expect(it.seconds).toBeGreaterThan(5);
    }
  });
});
