/** Web MIDI input: note on/off and the sustain pedal from every connected device. */
export type MidiStatus =
  | { kind: 'unsupported' }
  | { kind: 'requesting' }
  | { kind: 'denied' }
  | { kind: 'none' }
  | { kind: 'connected'; names: string[] };

export interface MidiHandlers {
  noteOn(pitch: number, velocity: number): void;
  noteOff(pitch: number): void;
  sustain(on: boolean): void;
  status(s: MidiStatus): void;
}

export function startMidi(h: MidiHandlers): void {
  if (!navigator.requestMIDIAccess) {
    h.status({ kind: 'unsupported' });
    return;
  }
  h.status({ kind: 'requesting' });
  navigator.requestMIDIAccess({ sysex: false }).then(
    (access) => {
      const onMessage = (e: MIDIMessageEvent) => {
        const data = e.data;
        if (!data || data.length < 2) return;
        const cmd = data[0] & 0xf0;
        const d1 = data[1];
        const d2 = data.length > 2 ? data[2] : 0;
        if (cmd === 0x90 && d2 > 0) h.noteOn(d1, d2 / 127);
        else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) h.noteOff(d1);
        else if (cmd === 0xb0 && d1 === 64) h.sustain(d2 >= 64);
      };
      const refresh = () => {
        const names: string[] = [];
        access.inputs.forEach((inp) => {
          names.push(inp.name || 'MIDI');
          inp.onmidimessage = onMessage;
        });
        h.status(names.length ? { kind: 'connected', names } : { kind: 'none' });
      };
      access.onstatechange = refresh;
      refresh();
    },
    () => h.status({ kind: 'denied' }),
  );
}
