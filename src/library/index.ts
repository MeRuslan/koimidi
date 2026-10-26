import { autoFinger } from '../score/fingering';
import { pitchSpan, type Score } from '../score/model';
import { parseNotation } from '../score/notation';
import { PIECES } from './pieces';

export interface LibraryItem {
  id: string;
  title: string;
  titleRu: string;
  composer: string;
  composerRu: string;
  difficulty: number;
  measures: number;
  hands: { R: boolean; L: boolean };
  seconds: number;
  low?: number;
  high?: number;
}

/** A fresh copy of a library piece each time: the player's edits change its notes. */
export function libraryScore(id: string): Score {
  const entry = PIECES.find((p) => p.id === id);
  if (!entry) throw new Error(`Unknown library piece ${id}`);
  const s = parseNotation(entry.text, id).score;
  autoFinger(s);
  return s;
}

export function libraryItems(): LibraryItem[] {
  return PIECES.map((p) => {
    const { score, meta } = parseNotation(p.text, p.id);
    return {
      id: p.id,
      title: score.title,
      titleRu: String(meta.title_ru ?? score.title),
      composer: score.composer ?? '',
      composerRu: String(meta.composer_ru ?? score.composer ?? ''),
      difficulty: Number(meta.difficulty ?? 2),
      measures: score.measures.length,
      hands: score.hands,
      seconds: (score.end * 60) / score.tempo[0].bpm,
      ...pitchSpan(score),
    };
  });
}
