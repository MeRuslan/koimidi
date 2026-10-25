/**
 * SoundFont packs the player added (SF2/SF3), kept in the IndexedDB store
 * "soundbanks" under the SHA-256 of their bytes. They never leave the browser.
 */
import { BANKS, tx } from './db';

export interface StoredBank {
  id: string;
  /** file name without the extension */
  name: string;
  size: number;
  bytes: ArrayBuffer;
  addedAt: number;
}

export type StoredBankMeta = Omit<StoredBank, 'bytes'>;

/** RIFF…sfbk: a SoundFont 2 file, uncompressed (SF2) or with Vorbis samples (SF3). */
export function isSoundFont(bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  return bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'sfbk';
}

/** Is there room for `size` more bytes in this site's storage? Unknown counts as yes. */
export async function hasRoomFor(size: number): Promise<boolean> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est?.quota) return true;
    return (est.quota - (est.usage ?? 0)) > size * 1.2;
  } catch {
    return true;
  }
}

export async function putBank(b: StoredBank): Promise<void> {
  await tx('readwrite', (s) => s.put(b), BANKS);
}

export async function listBanks(): Promise<StoredBankMeta[]> {
  try {
    const all = await tx<StoredBank[]>('readonly', (s) => s.getAll(), BANKS);
    return all.map(({ bytes: _b, ...meta }) => meta).sort((a, b) => a.addedAt - b.addedAt);
  } catch {
    return [];
  }
}

export async function getBank(id: string): Promise<StoredBank | undefined> {
  try {
    return await tx<StoredBank | undefined>('readonly', (s) => s.get(id), BANKS);
  } catch {
    return undefined;
  }
}

export async function deleteBank(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id), BANKS);
}
