/**
 * Small piano-like WebAudio synth: triangle + 2nd and 3rd harmonics through a
 * velocity-dependent low-pass filter, ~6 s decay, sustain pedal (CC 64).
 * Audio starts only after a user gesture (browser policy), see `unlock()`.
 */
export class Synth {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<number, { g: GainNode; oscs: OscillatorNode[]; held: boolean }>();
  sustain = false;
  volume = 0.55;

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
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
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
    this.noteOff(pitch, true);
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
    this.voices.set(pitch, { g, oscs: [o1, o2, o3], held: true });
    if (seconds > 0) setTimeout(() => this.noteOff(pitch), seconds * 1000);
  }

  noteOff(pitch: number, force = false): void {
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

  setSustain(on: boolean): void {
    this.sustain = on;
    if (!on) for (const [p, v] of [...this.voices]) if (!v.held) this.noteOff(p, true);
  }

  allOff(): void {
    for (const p of [...this.voices.keys()]) this.noteOff(p, true);
  }
}
