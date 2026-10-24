/** Practice progress per piece in the IndexedDB store "progress", keyed like files and finger edits. */
import { emptyProgress, type PieceProgress } from '../practice/progress';
import { PROGRESS, tx } from './db';

export async function getProgress(id: string): Promise<PieceProgress> {
  try {
    return (await tx<PieceProgress | undefined>('readonly', (s) => s.get(id), PROGRESS)) ?? emptyProgress(id);
  } catch {
    return emptyProgress(id);
  }
}

export async function putProgress(p: PieceProgress): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(p), PROGRESS);
  } catch {
    /* storage unavailable: progress lasts for this visit only */
  }
}

export async function listProgress(): Promise<Map<string, PieceProgress>> {
  try {
    const all = await tx<PieceProgress[]>('readonly', (s) => s.getAll(), PROGRESS);
    return new Map(all.map((p) => [p.id, p]));
  } catch {
    return new Map();
  }
}

export async function deleteProgress(id: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(id), PROGRESS);
  } catch {
    /* ignore */
  }
}
