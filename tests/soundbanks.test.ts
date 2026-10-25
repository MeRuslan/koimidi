import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSoundFont } from '../src/storage/soundbanks';

describe('sound banks', () => {
  it('recognises SoundFont files by their RIFF sfbk header', () => {
    const sf2 = readFileSync(`${process.cwd()}/tests/fixtures/tiny.sf2`);
    const mid = readFileSync(`${process.cwd()}/tests/fixtures/ode-two-tracks.mid`);
    expect(isSoundFont(new Uint8Array(sf2))).toBe(true);
    expect(isSoundFont(new Uint8Array(mid))).toBe(false);
    expect(isSoundFont(new TextEncoder().encode('<!doctype html><html>'))).toBe(false);
  });
});
