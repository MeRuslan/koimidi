/**
 * Sampled instruments through SpessaSynth (Apache-2.0): an SF2/SF3 sound bank
 * played by an AudioWorklet on MIDI channel 1. The library and its worklet
 * are loaded only when a sampled sound is chosen.
 */
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { WorkletSynthesizer } from 'spessasynth_lib';

export interface Patch {
  name: string;
  program: number;
  bankMSB: number;
  bankLSB: number;
}

const CH = 0;
const CC_BANK_MSB = 0;
const CC_BANK_LSB = 32;
const CC_SUSTAIN = 64;

export function patchKey(p: Patch): string {
  return `${p.bankMSB}:${p.bankLSB}:${p.program}`;
}

export class Sampler {
  private constructor(private synth: WorkletSynthesizer) {}

  static async create(ctx: AudioContext, out: AudioNode): Promise<Sampler> {
    if (!ctx.audioWorklet) throw new Error('AudioWorklet unavailable');
    const { WorkletSynthesizer } = await import('spessasynth_lib');
    await ctx.audioWorklet.addModule(processorUrl);
    const synth = new WorkletSynthesizer(ctx);
    synth.connect(out);
    await synth.isReady;
    return new Sampler(synth);
  }

  /** Load a sound bank (replacing the previous one) and list its melodic presets. */
  async load(bytes: ArrayBuffer): Promise<Patch[]> {
    const synth = this.synth;
    const listed = new Promise<void>((resolve) => {
      synth.eventHandler.addEvent('presetListChange', 'koimidi', () => resolve());
      setTimeout(resolve, 3000);
    });
    const failed = new Promise<never>((_, reject) => synth.eventHandler.addEvent('soundBankError', 'koimidi', (e) => reject(e)));
    // the worklet takes the buffer over: keep the caller's copy usable
    await Promise.race([synth.soundBankManager.addSoundBank(bytes.slice(0), 'main'), failed]);
    await Promise.race([listed, failed]);
    synth.eventHandler.removeEvent('presetListChange', 'koimidi');
    synth.eventHandler.removeEvent('soundBankError', 'koimidi');
    return synth.presetList
      .filter((p) => !p.isDrum)
      .map((p) => ({ name: p.name.trim() || `Program ${p.program + 1}`, program: p.program, bankMSB: p.bankMSB, bankLSB: p.bankLSB }));
  }

  select(p: Patch): void {
    this.synth.controllerChange(CH, CC_BANK_MSB, p.bankMSB);
    this.synth.controllerChange(CH, CC_BANK_LSB, p.bankLSB);
    this.synth.programChange(CH, p.program);
  }

  noteOn(pitch: number, vel: number): void {
    this.synth.noteOn(CH, pitch, Math.max(1, Math.min(127, Math.round(vel * 127))));
  }

  noteOff(pitch: number): void {
    this.synth.noteOff(CH, pitch);
  }

  sustain(on: boolean): void {
    this.synth.controllerChange(CH, CC_SUSTAIN, on ? 127 : 0);
  }

  allOff(): void {
    this.synth.stopAll(true);
  }

  destroy(): void {
    this.synth.destroy();
  }
}
