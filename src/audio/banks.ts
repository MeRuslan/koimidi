/**
 * The sounds to choose from: the built-in synth, the sampled grand piano that
 * ships with koimidi (downloaded on first use, then kept in Cache Storage so
 * it works offline), and SoundFont packs the player adds.
 */
import { sha256 } from '../storage/files';
import { getBank, hasRoomFor, isSoundFont, listBanks, putBank, type StoredBankMeta } from '../storage/soundbanks';

export type Instrument = 'simple' | 'grand' | `pack:${string}`;

/** Salamander Grand Piano, reduced for the web: see scripts/build-piano.mjs. */
export const GRAND = {
  file: 'sounds/salamander-grand-piano.sf3',
  /** download size in bytes, shown before the first download */
  size: 10_248_758,
  credit: 'Salamander Grand Piano V3 by Alexander Holm',
  license: 'CC BY 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
};

const CACHE = 'koimidi-sounds';

function grandUrl(): string {
  return new URL(GRAND.file, document.baseURI).href;
}

/** The grand piano from the cache, or null before its first download (a damaged copy is dropped). */
export async function cachedGrand(): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(grandUrl());
    if (!hit) return null;
    const buf = await hit.arrayBuffer();
    if (isSoundFont(new Uint8Array(buf, 0, 12))) return buf;
    await cache.delete(grandUrl());
    return null;
  } catch {
    return null;
  }
}

/** Has the grand piano been downloaded already? */
export async function hasGrand(): Promise<boolean> {
  try {
    return !!(await (await caches.open(CACHE)).match(grandUrl()));
  } catch {
    return false;
  }
}

/** Download the grand piano with progress (0–1) and keep it for offline use. */
export async function downloadGrand(onProgress: (done: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(grandUrl());
  if (!res.ok || !res.body) throw new BankError('unavailable');
  const total = Number(res.headers.get('content-length')) || GRAND.size;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress(Math.min(1, got / total));
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  if (!isSoundFont(bytes)) throw new BankError('unavailable');
  try {
    await (await caches.open(CACHE)).put(grandUrl(), new Response(bytes.slice(0), { headers: { 'content-type': 'application/octet-stream' } }));
  } catch {
    /* no Cache Storage: works now, downloads again next time */
  }
  return bytes.buffer;
}

export class BankError extends Error {
  constructor(readonly code: 'not-soundfont' | 'no-room' | 'unavailable') {
    super(code);
  }
}

/** Check and store a SoundFont the player picked. Returns its id. */
export async function addPack(file: File): Promise<StoredBankMeta> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (!isSoundFont(bytes)) throw new BankError('not-soundfont');
  if (!(await hasRoomFor(bytes.length))) throw new BankError('no-room');
  const id = await sha256(bytes);
  const meta: StoredBankMeta = { id, name: file.name.replace(/\.[^.]+$/, ''), size: bytes.length, addedAt: Date.now() };
  await putBank({ ...meta, bytes: buf });
  return meta;
}

/** Bytes of the chosen sound, or null for the built-in synth (or when a pack is gone). */
export async function bankBytes(inst: Instrument): Promise<ArrayBuffer | null> {
  if (inst === 'simple') return null;
  if (inst === 'grand') return cachedGrand();
  return (await getBank(inst.slice(5)))?.bytes ?? null;
}

export { listBanks };
