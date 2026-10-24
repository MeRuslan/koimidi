/**
 * Settings live in localStorage under "koimidi:" keys (the site may share an
 * origin with other github.io pages, so every key is prefixed).
 */
import type { KeyboardChoice } from '../input/profile';
import type { HandSel, Mode } from '../practice/engine';
import type { MidiSplit } from '../score/midi';

export type Lang = 'ru' | 'en';
export type NoteNames = 'auto' | 'solfege' | 'letters';

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
  anyOctave: true,
  noteNames: 'auto',
  midiSplit: 'auto',
  metronome: false,
  countIn: true,
  keyboard: 'auto',
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
