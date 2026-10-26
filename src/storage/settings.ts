/**
 * Settings live in localStorage under "koimidi:" keys (the site may share an
 * origin with other github.io pages, so every key is prefixed).
 */
import type { Instrument } from '../audio/banks';
import type { KeyboardChoice } from '../input/profile';
import type { HandSel, Mode } from '../practice/engine';
import type { MidiSplit } from '../score/midi';
import type { ThemeChoice } from '../theme';

export type Lang = 'ru' | 'en';
export type NoteNames = 'auto' | 'solfege' | 'letters';
/** How a video is recognised: by its sound, or by the keys lighting up in the picture. */
export type VideoBy = 'ear' | 'eye';
/** What the sound of a video is: a piano (heard by a piano network) or another instrument (a universal one). */
export type VideoSound = 'piano' | 'other';

export interface Settings {
  v: 1;
  lang: Lang | 'auto';
  mode: Mode;
  speed: number;
  loop: boolean;
  sound: boolean;
  volume: number;
  anyOctave: boolean;
  noteNames: NoteNames;
  midiSplit: MidiSplit;
  /** metronome clicks in tempo and listen modes */
  metronome: boolean;
  /** one bar of count-in before the range in tempo mode */
  countIn: boolean;
  /** the player's controller: a key count, or detect from the device name */
  keyboard: KeyboardChoice;
  /** the trainer plays the other hand when one hand of a two-hand piece is practised */
  accompany: boolean;
  /** which sound plays the notes */
  instrument: Instrument;
  /** chosen preset per sound bank, as "bankMSB:bankLSB:program" */
  patches: Record<string, string>;
  /** the look: paper, lacquer, console, or like the system */
  theme: ThemeChoice;
  /** how a video is recognised: by ear (the default) or by the lit keys */
  videoBy: VideoBy;
  /** by ear: a piano (the default) or another instrument */
  videoSound: VideoSound;
  /** show the video a piece was recognised from on the practice screen, in step with the bars */
  video: boolean;
  lastPieceId?: string;
}

export interface PieceSettings {
  from?: number;
  to?: number;
  hand?: HandSel;
  speed?: number;
  split?: MidiSplit;
}

const KEY = 'koimidi:settings';
const PIECE = 'koimidi:piece:';

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  lang: 'auto',
  mode: 'learn',
  speed: 0.5,
  loop: true,
  sound: true,
  volume: 0.55,
  videoBy: 'ear',
  videoSound: 'piano',
  anyOctave: true,
  noteNames: 'auto',
  midiSplit: 'auto',
  metronome: false,
  countIn: true,
  keyboard: 'auto',
  accompany: true,
  instrument: 'simple',
  patches: {},
  theme: 'auto',
  video: true,
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or quota: settings simply don't persist */
  }
}

export function loadSettings(): Settings {
  const s = read<Partial<Settings>>(KEY);
  return { ...DEFAULT_SETTINGS, ...(s && s.v === 1 ? s : {}) };
}

export function saveSettings(s: Settings): void {
  write(KEY, s);
}

export function loadPieceSettings(id: string): PieceSettings {
  return read<PieceSettings>(PIECE + id) ?? {};
}

export function savePieceSettings(id: string, p: PieceSettings): void {
  write(PIECE + id, p);
}

export function clearPieceSettings(id: string): void {
  try {
    localStorage.removeItem(PIECE + id);
  } catch {
    /* ignore */
  }
}
