/**
 * Imported files are kept in IndexedDB (database "koimidi", store "files"),
 * keyed by the SHA-256 of their bytes so re-importing the same file never
 * creates a duplicate. The user's edits of a piece, fingers and notes (store
 * "fingerings", named after what it held first), and practice statistics
 * ("progress") are stored under the same id (or the library slug).
 * Everything stays in this browser.
 */
import type { FingerEdits } from '../score/edits';
import { emptyNoteEdits, hasNoteEdits, type NoteEdits, type PieceEdits } from '../score/note-edits';
import { FINGERS, PROGRESS, STORE, tx } from './db';

export type FileKind = 'midi' | 'musicxml' | 'mxl';

export interface StoredFile {
  id: string;
  name: string;
  kind: FileKind;
  size: number;
  bytes: ArrayBuffer;
  addedAt: number;
  openedAt: number;
  title: string;
  composer?: string;
  measures: number;
  hands: { R: boolean; L: boolean };
  /** Lowest and highest pitch, for the keyboard-fit badge (absent on files stored by v0.1). */
  low?: number;
  high?: number;
  /** The video a piece was recognised from (a YouTube link). */
  origin?: string;
  /** The second of that video where the piece's first bar begins, so the trainer can play it in step. */
  videoStart?: number;
  /** The speed the video was watched at while recognising (0.5 = half speed); the tempo in the file is the real one. */
  videoSpeed?: number;
}

export type StoredFileMeta = Omit<StoredFile, 'bytes'>;

interface StoredEdits {
  id: string;
  /** fingers by note key */
  edits: FingerEdits;
  /** notes added, taken out or moved (absent in records from before note editing) */
  notes?: NoteEdits;
  updatedAt: number;
}

export async function putFile(f: StoredFile): Promise<void> {
  await tx('readwrite', (s) => s.put(f));
}

export async function listFiles(): Promise<StoredFileMeta[]> {
  try {
    const all = await tx<StoredFile[]>('readonly', (s) => s.getAll());
    return all
      .map(({ bytes: _b, ...meta }) => meta)
      .sort((a, b) => b.openedAt - a.openedAt);
  } catch {
    return [];
  }
}

export async function getFile(id: string): Promise<StoredFile | undefined> {
  try {
    return await tx<StoredFile | undefined>('readonly', (s) => s.get(id));
  } catch {
    return undefined;
  }
}

export async function touchFile(id: string): Promise<void> {
  const f = await getFile(id);
  if (f) {
    f.openedAt = Date.now();
    await putFile(f);
  }
}

export async function deleteFile(id: string): Promise<void> {
  await tx(
    'readwrite',
    (s, t) => {
      s.delete(id);
      t.objectStore(FINGERS).delete(id);
      t.objectStore(PROGRESS).delete(id);
    },
    [STORE, FINGERS, PROGRESS],
  );
}

/** The user's edits of a piece (file hash or library slug); empty when none or storage is unavailable. */
export async function getPieceEdits(id: string): Promise<PieceEdits> {
  try {
    const rec = await tx<StoredEdits | undefined>('readonly', (s) => s.get(id), FINGERS);
    return { fingers: rec?.edits ?? {}, notes: { removed: rec?.notes?.removed ?? [], added: rec?.notes?.added ?? [] } };
  } catch {
    return { fingers: {}, notes: emptyNoteEdits() };
  }
}

export async function putPieceEdits(id: string, edits: PieceEdits): Promise<void> {
  // copied now: the edits may change again before the database opens
  const rec: StoredEdits = { id, edits: { ...edits.fingers }, notes: structuredClone(edits.notes), updatedAt: Date.now() };
  try {
    if (Object.keys(rec.edits).length || hasNoteEdits(edits.notes)) await tx('readwrite', (s) => s.put(rec), FINGERS);
    else await tx('readwrite', (s) => s.delete(id), FINGERS);
  } catch {
    /* storage unavailable: edits last for this visit only */
  }
}

/** Ask the browser not to evict our data under storage pressure. Best effort. */
export function requestPersistence(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}

export async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (globalThis.crypto?.subtle) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', data as BufferSource);
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      /* fall through to FNV */
    }
  }
  // FNV-1a over two lanes: good enough as a dedupe key when SubtleCrypto is unavailable (plain http).
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < data.length; i++) {
    h1 = Math.imul(h1 ^ data[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ data[i], 0x811c9dc5) >>> 0;
  }
  return 'fnv' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + data.length.toString(16);
}
