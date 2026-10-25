/**
 * All sound goes through here: the player's keys, listen mode, the trainer's
 * hand, playback of recordings, and the metronome. Notes are played by a
 * sampled instrument (SpessaSynth, see sampler.ts) once one is loaded, and by
 * the small built-in synth otherwise, including while a sound bank loads.
 *
 * The built-in synth: triangle + 2nd and 3rd harmonics through a
 * velocity-dependent low-pass filter, ~6 s decay, sustain pedal (CC 64).
 * Audio starts only after a user gesture (browser policy), see `unlock()`.
 */
import { Sampler, type Patch } from './sampler';

interface Voice {
  g: GainNode;
  oscs: OscillatorNode[];
  held: boolean;
}

export class Synth {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<number, Voice>();
  sustain = false;
  volume = 0.55;
  private sampler: Sampler | null = null;
  /** the sampler, kept when switching back to the built-in synth, to switch again quickly */
  private samplerCache: Promise<Sampler> | null = null;
  /** the latest timed note on each key, so an earlier note's timer does not release a later one */
  private timed = new Map<number, object>();
  private unlocked!: () => void;
  private whenUnlocked = new Promise<void>((r) => (this.unlocked = r));
  /** bank switches run one after another */
  private switching: Promise<unknown> = Promise.resolve();

  /** Create or resume the audio context. Call from a user gesture. */
  unlock(): void {
    if (!this.ac) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ac = new Ctor();
      this.master = this.ac.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ac.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ac.destination);
      this.unlocked();
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
  }

  /** Is a sampled instrument playing the notes? */
  get sampled(): boolean {
    return !!this.sampler;
  }

  /**
   * Play notes with this sound bank (null: the built-in synth). Waits for the
   * first user gesture if audio is not running yet. Returns the bank's
   * melodic presets; the first one is selected.
   */
  useBank(bytes: ArrayBuffer | null): Promise<Patch[]> {
    const run = async (): Promise<Patch[]> => {
      if (!bytes) {
        this.sampler?.allOff();
        this.sampler = null;
        return [];
      }
      await this.whenUnlocked;
      this.samplerCache ??= Sampler.create(this.ac!, this.master!);
      let s: Sampler;
      try {
        s = await this.samplerCache;
      } catch (e) {
        this.samplerCache = null;
        throw e;
      }
      this.sampler?.allOff();
      this.sampler = null; // the built-in synth plays while the bank loads
      const patches = await s.load(bytes);
      if (!patches.length) throw new Error('no instruments in this sound bank');
      s.select(patches[0]);
      s.sustain(this.sustain);
      this.sampler = s;
      return patches;
    };
    const p = this.switching.then(run, run);
    this.switching = p.catch(() => undefined);
    return p;
  }

  selectPatch(p: Patch): void {
    this.sampler?.select(p);
  }

  get ready(): boolean {
    return !!this.ac && this.ac.state === 'running';
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ac) this.master.gain.setTargetAtTime(v, this.ac.currentTime, 0.02);
  }

  noteOn(pitch: number, vel = 0.8, seconds = 0): void {
    const ac = this.ac;
    if (!ac || !this.master) return;
    if (this.sampler) {
      const sampler = this.sampler;
      sampler.noteOn(pitch, vel);
      const token = {};
      if (seconds > 0) {
        this.timed.set(pitch, token);
        setTimeout(() => this.timed.get(pitch) === token && sampler.noteOff(pitch), seconds * 1000);
      } else this.timed.delete(pitch);
      return;
    }
    this.release(pitch, true);
    const t = ac.currentTime;
    const f = 440 * Math.pow(2, (pitch - 69) / 12);
    const g = ac.createGain();
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800 + 3200 * vel;
    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    const o3 = ac.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = f;
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const g2 = ac.createGain();
    g2.gain.value = 0.25;
    o3.type = 'sine';
    o3.frequency.value = f * 3.01;
    const g3 = ac.createGain();
    g3.gain.value = 0.08;
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    o3.connect(g3).connect(lp);
    lp.connect(g).connect(this.master);
    const peak = 0.12 + 0.28 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.45);
    g.gain.exponentialRampToValueAtTime(peak * 0.12, t + 2.4);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 6);
    for (const o of [o1, o2, o3]) {
      o.start(t);
      o.stop(t + 6.2);
    }
    const voice: Voice = { g, oscs: [o1, o2, o3], held: true };
    this.voices.set(pitch, voice);
    // a timed note releases only itself: the same key may have been struck again meanwhile
    if (seconds > 0) setTimeout(() => this.voices.get(pitch) === voice && this.release(pitch), seconds * 1000);
  }

  noteOff(pitch: number, force = false): void {
    if (this.sampler) {
      // the sampler holds the note itself while the pedal is down
      this.timed.delete(pitch);
      this.sampler.noteOff(pitch);
    }
    this.release(pitch, force);
  }

  /** Release a built-in synth voice (there may be one on this key from before a sound bank loaded). */
  private release(pitch: number, force = false): void {
    const v = this.voices.get(pitch);
    const ac = this.ac;
    if (!v || !ac) return;
    if (this.sustain && !force) {
      v.held = false;
      return;
    }
    const t = ac.currentTime;
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setValueAtTime(Math.max(v.g.gain.value, 0.0008), t);
    v.g.gain.exponentialRampToValueAtTime(0.0008, t + 0.25);
    for (const o of v.oscs) {
      try {
        o.stop(t + 0.3);
      } catch {
        /* already stopped */
      }
    }
    this.voices.delete(pitch);
  }

  /** Metronome click: a short wooden-sounding blip, `delay` seconds from now, higher on the downbeat. */
  click(delay = 0, accent = false): void {
    const ac = this.ac;
    if (!ac || !this.master) return;
    const t = ac.currentTime + Math.max(0, delay);
    const o = ac.createOscillator();
    const bp = ac.createBiquadFilter();
    const g = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(accent ? 1760 : 1250, t);
    o.frequency.exponentialRampToValueAtTime(accent ? 1100 : 800, t + 0.05);
    bp.type = 'bandpass';
    bp.frequency.value = accent ? 1700 : 1200;
    bp.Q.value = 1.5;
    const peak = accent ? 0.9 : 0.6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(bp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.09);
  }

  setSustain(on: boolean): void {
    this.sustain = on;
    this.sampler?.sustain(on);
    if (!on) for (const [p, v] of [...this.voices]) if (!v.held) this.release(p, true);
  }

  allOff(): void {
    this.sampler?.allOff();
    this.timed.clear();
    for (const p of [...this.voices.keys()]) this.release(p, true);
  }
}
