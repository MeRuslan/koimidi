import { afterEach, describe, expect, it, vi } from 'vitest';
import { Synth } from '../src/audio/synth';

/** Just enough of WebAudio to see which voices get released. */
function fakeAudio() {
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() });
  const node = () => ({ connect: vi.fn((n: unknown) => n), gain: param(), frequency: param(), Q: param(), type: '', start: vi.fn(), stop: vi.fn() });
  class Ctx {
    currentTime = 0;
    state = 'running';
    destination = {};
    createGain = node;
    createBiquadFilter = node;
    createOscillator = node;
    createDynamicsCompressor = node;
    resume = vi.fn();
  }
  return Ctx;
}

describe('synth', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a timed note does not cut the same key struck again right after it (listen mode)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('AudioContext', fakeAudio());
    const s = new Synth();
    s.unlock();
    s.noteOn(64, 0.7, 0.5); // first E4, half a second
    vi.advanceTimersByTime(495);
    s.noteOn(64, 0.7, 0.5); // the repeat starts a moment before the first one's release fires
    const voice = (s as unknown as { voices: Map<number, unknown> }).voices.get(64);
    vi.advanceTimersByTime(10); // the first note's release time passes
    expect((s as unknown as { voices: Map<number, unknown> }).voices.get(64)).toBe(voice);
    vi.advanceTimersByTime(500); // its own release
    expect((s as unknown as { voices: Map<number, unknown> }).voices.has(64)).toBe(false);
  });
});
