/** File → Score. Detects the format from the bytes, parses in the browser, stores a copy in IndexedDB. */
import { autoFinger } from './score/fingering';
import { parseMidi, type MidiSplit } from './score/midi';
import { pitchSpan, type Score } from './score/model';
import { parseMusicXML, parseMXL } from './score/musicxml';
import { putFile, sha256, type FileKind, type StoredFile } from './storage/files';

export function sniffKind(bytes: Uint8Array, name: string): FileKind | null {
  const head = String.fromCharCode(...bytes.slice(0, 4));
  if (head === 'MThd') return 'midi';
  if (head.startsWith('PK')) return 'mxl';
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 4096));
  if (/<score-partwise|<score-timewise|<!DOCTYPE score|<\?xml/i.test(text)) return 'musicxml';
  const ext = name.toLowerCase().split('.').pop() || '';
  if (ext === 'mid' || ext === 'midi') return 'midi';
  if (ext === 'mxl') return 'mxl';
  if (ext === 'xml' || ext === 'musicxml') return 'musicxml';
  return null;
}

export function parseBytes(bytes: Uint8Array, kind: FileKind, id: string, name: string, split: MidiSplit): Score {
  let score: Score;
  if (kind === 'midi') score = parseMidi(bytes, id, name, { split });
  else if (kind === 'mxl') score = parseMXL(bytes, id, name);
  else score = parseMusicXML(new TextDecoder().decode(bytes), id, name);
  if (!score.notes.length) throw new Error('no notes found');
  autoFinger(score);
  return score;
}

export interface Imported {
  score: Score;
  stored: StoredFile;
}

export async function importFile(file: File, split: MidiSplit): Promise<Imported> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const kind = sniffKind(bytes, file.name);
  if (!kind) throw new Error('unknown-type');
  const id = await sha256(bytes);
  const score = parseBytes(bytes, kind, id, file.name, split);
  const now = Date.now();
  const stored: StoredFile = {
    id,
    name: file.name,
    kind,
    size: bytes.length,
    bytes: buf,
    addedAt: now,
    openedAt: now,
    title: score.title,
    composer: score.composer,
    measures: score.measures.length,
    hands: score.hands,
    ...pitchSpan(score),
  };
  try {
    await putFile(stored);
  } catch {
    /* storage unavailable: the piece still opens */
  }
  return { score, stored };
}

export function scoreFromStored(f: StoredFile, split: MidiSplit): Score {
  return parseBytes(new Uint8Array(f.bytes), f.kind, f.id, f.name, split);
}
