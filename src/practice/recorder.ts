/**
 * Recording the player's own playing: every key press, release and sustain
 * pedal change with its time, from the MIDI keyboard, the computer keys or the
 * on-screen keys. A finished take can be played back and saved as a standard
 * MIDI file. Nothing is stored until the player saves it.
 */
import { Midi } from '@tonejs/midi';

export interface TakeNote {
  pitch: number;
  /** seconds from the start of the take */
  t: number;
  dur: number;
  velocity: number;
}

export interface Take {
  notes: TakeNote[];
  pedal: { t: number; on: boolean }[];
  /** seconds, first event to last release */
  duration: number;
  /** title of the piece it was recorded over */
  title: string;
  recordedAt: Date;
}

type Ev = { kind: 'on'; pitch: number; velocity: number; t: number } | { kind: 'off'; pitch: number; t: number } | { kind: 'pedal'; on: boolean; t: number };

export class Recorder {
  recording = false;
  private t0 = 0;
  private events: Ev[] = [];
  private title = '';

  start(title: string, now = performance.now()): void {
    this.recording = true;
    this.t0 = now;
    this.events = [];
    this.title = title;
  }

  noteOn(pitch: number, velocity: number, now = performance.now()): void {
    if (this.recording) this.events.push({ kind: 'on', pitch, velocity, t: (now - this.t0) / 1000 });
  }

  noteOff(pitch: number, now = performance.now()): void {
    if (this.recording) this.events.push({ kind: 'off', pitch, t: (now - this.t0) / 1000 });
  }

  pedal(on: boolean, now = performance.now()): void {
    if (this.recording) this.events.push({ kind: 'pedal', on, t: (now - this.t0) / 1000 });
  }

  /** Seconds since the recording started. */
  elapsed(now = performance.now()): number {
    return this.recording ? (now - this.t0) / 1000 : 0;
  }

  /** Notes pressed so far. */
  get count(): number {
    return this.events.filter((e) => e.kind === 'on').length;
  }

  /** Stop and return the take, or null when nothing was played. Leading silence is trimmed. */
  stop(now = performance.now()): Take | null {
    if (!this.recording) return null;
    this.recording = false;
    const stopAt = (now - this.t0) / 1000;
    const notes: TakeNote[] = [];
    const open = new Map<number, TakeNote>();
    const pedal: { t: number; on: boolean }[] = [];
    for (const e of this.events) {
      if (e.kind === 'on') {
        const prev = open.get(e.pitch);
        if (prev) prev.dur = Math.max(0.01, e.t - prev.t);
        const n: TakeNote = { pitch: e.pitch, t: e.t, dur: 0, velocity: e.velocity };
        notes.push(n);
        open.set(e.pitch, n);
      } else if (e.kind === 'off') {
        const n = open.get(e.pitch);
        if (!n) continue;
        n.dur = Math.max(0.01, e.t - n.t);
        open.delete(e.pitch);
      } else pedal.push({ t: e.t, on: e.on });
    }
    for (const n of open.values()) n.dur = Math.max(0.01, stopAt - n.t);
    this.events = [];
    if (!notes.length) return null;
    const first = notes[0].t;
    for (const n of notes) n.t -= first;
    for (const p of pedal) p.t = Math.max(0, p.t - first);
    const duration = Math.max(...notes.map((n) => n.t + n.dur));
    return { notes, pedal, duration, title: this.title, recordedAt: new Date() };
  }
}

export interface TakeMidiOptions {
  /** Tempo written into the file, so notation software lines the bars up roughly. */
  bpm?: number;
  timeSig?: [number, number];
}

/** Standard MIDI file (type 1, one piano track) with the notes and the sustain pedal. */
export function takeToMidi(take: Take, opts: TakeMidiOptions = {}): Uint8Array {
  const midi = new Midi();
  midi.name = take.title;
  midi.header.setTempo(opts.bpm && opts.bpm > 0 ? opts.bpm : 120);
  if (opts.timeSig) midi.header.timeSignatures.push({ ticks: 0, timeSignature: opts.timeSig });
  midi.header.update();
  const track = midi.addTrack();
  track.name = 'koimidi recording';
  track.channel = 0;
  track.instrument.number = 0; // acoustic grand piano
  for (const n of take.notes) track.addNote({ midi: n.pitch, time: n.t, duration: n.dur, velocity: Math.max(0.05, Math.min(1, n.velocity)) });
  for (const p of take.pedal) track.addCC({ number: 64, value: p.on ? 1 : 0, time: p.t });
  // a pedal still down at the end is released with the last note
  if (take.pedal.length && take.pedal[take.pedal.length - 1].on) track.addCC({ number: 64, value: 0, time: take.duration });
  return midi.toArray();
}
