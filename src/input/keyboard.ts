/**
 * Computer keyboard as a 15-key piano: A S D F G H J K L are white keys from
 * C, W E T Y U O the black keys in between. Z / X shift the octave.
 */
const KEYS: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14,
};

export interface KeyboardHandlers {
  noteOn(pitch: number, velocity: number): void;
  noteOff(pitch: number): void;
  /** Non-note shortcuts; return true when handled. */
  command(code: string, e: KeyboardEvent): boolean;
}

export class ComputerKeyboard {
  /** MIDI pitch of the "A" key. */
  base = 60;
  private down = new Map<string, number>();

  constructor(private h: KeyboardHandlers) {
    addEventListener('keydown', this.onDown);
    addEventListener('keyup', this.onUp);
    addEventListener('blur', () => this.releaseAll());
  }

  /** Choose the octave that covers most of the given pitches. */
  fitTo(pitches: number[]): void {
    if (!pitches.length) return;
    let best = 60;
    let bestCount = -1;
    for (let base = 24; base <= 96; base += 12) {
      const count = pitches.filter((p) => p >= base && p < base + 15).length;
      if (count > bestCount) {
        bestCount = count;
        best = base;
      }
    }
    this.base = best;
  }

  private onDown = (e: KeyboardEvent): void => {
    const el = e.target as HTMLElement | null;
    if (el && isTextEntry(el)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.h.command(e.code, e)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      this.base = Math.max(12, Math.min(96, this.base + (e.code === 'KeyZ' ? -12 : 12)));
      e.preventDefault();
      return;
    }
    if (e.repeat || !(e.code in KEYS)) return;
    const p = this.base + KEYS[e.code];
    this.down.set(e.code, p);
    this.h.noteOn(p, 0.75);
    e.preventDefault();
  };

  private onUp = (e: KeyboardEvent): void => {
    const p = this.down.get(e.code);
    if (p === undefined) return;
    this.down.delete(e.code);
    this.h.noteOff(p);
  };

  releaseAll(): void {
    for (const p of this.down.values()) this.h.noteOff(p);
    this.down.clear();
  }
}

function isTextEntry(el: HTMLElement): boolean {
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'file'].includes(t);
  }
  return false;
}
