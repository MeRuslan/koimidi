/**
 * Compact text notation used for the built-in library.
 *
 *   title: Ode to Joy
 *   composer: Ludwig van Beethoven
 *   time: 4/4
 *   tempo: 108            // quarter notes per minute
 *   pickup: 1             // optional anacrusis length in quarter beats
 *   R: @A E4 E4 F4 G4 | G4 F4 E4 D4 | C4:1 C4 D4 E4 | E4. D4/8 D4/2 |
 *   L: [C3 E3 G3]/2:135 [G2 B2 D3]/2 |
 *
 * Tokens (whitespace separated), per hand stream:
 *   C4 D#4 Bb3 ...     note; default duration = the previous token's
 *   C4/8  C4/2.  C4/12 duration as a fraction of a whole note, dots allowed, /12 = eighth triplet
 *   C4:3               finger 1–5 (kept as "file" fingering)
 *   C4~                tie to the next note of the same pitch in this stream
 *   [C4 E4 G4]/2:135   chord: fingers listed in the same order as the pitches
 *   r/4                rest
 *   |                  barline: must land on a measure boundary (checked)
 *   @A                 section / rehearsal mark at this point
 *   // ...             comment to end of line
 */
import { buildMeasures, finalizeScore, measureAt, type Finger, type Hand, type Score, type ScoreNote, EPS } from './model';

export interface NotationMeta {
  difficulty?: number;
  [key: string]: string | number | undefined;
}

export interface ParsedNotation {
  score: Score;
  meta: NotationMeta;
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_RE = /^([A-Ga-g])(#{1,2}|b{1,2})?(-?\d)$/;
const SUFFIX_RE = /^(?:\/(\d+))?(\.*)(?::([1-5]+))?(~?)$/;

export function parsePitch(s: string): number {
  const m = NOTE_RE.exec(s);
  if (!m) throw new Error(`Bad pitch "${s}"`);
  const step = STEP[m[1].toUpperCase()];
  const acc = m[2] ? (m[2][0] === '#' ? m[2].length : -m[2].length) : 0;
  const oct = parseInt(m[3], 10);
  return 12 * (oct + 1) + step + acc;
}

function durationBeats(den: number, dots: number): number {
  let b = 4 / den;
  let add = b / 2;
  for (let i = 0; i < dots; i++) {
    b += add;
    add /= 2;
  }
  return b;
}

interface Stream {
  hand: Hand;
  t: number;
  dur: number;
  notes: ScoreNote[];
  /** notes still waiting to be tied to their continuation, by pitch */
  openTies: Map<number, ScoreNote>;
}

export function parseNotation(text: string, id: string): ParsedNotation {
  const meta: NotationMeta = {};
  let title = id;
  let composer: string | undefined;
  let timeSig: [number, number] = [4, 4];
  let bpm = 100;
  let pickup = 0;
  const streams: Record<Hand, Stream> = {
    R: { hand: 'R', t: 0, dur: 1, notes: [], openTies: new Map() },
    L: { hand: 'L', t: 0, dur: 1, notes: [], openTies: new Map() },
  };
  const sections = new Map<number, string>();
  const barlines: { hand: Hand; t: number; last: boolean; line: number }[] = [];

  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const raw = stripComment(lines[li]).trim();
    if (!raw) continue;
    const head = /^([A-Za-z_]+):\s*(.*)$/.exec(raw);
    if (!head) throw new Error(`${id}: line ${li + 1}: expected "key: value" or "R:"/"L:" stream`);
    const key = head[1];
    const value = head[2].trim();
    if (key === 'R' || key === 'L') {
      const s = streams[key];
      const tokens = value.match(/\[[^\]]*\][^\s]*|\S+/g) ?? [];
      tokens.forEach((tok, ti) => {
        const isLast = ti === tokens.length - 1 && !lines.slice(li + 1).some((l) => stripComment(l).trim().startsWith(key + ':'));
        try {
          parseToken(tok, s, sections, barlines, isLast, li + 1);
        } catch (e) {
          throw new Error(`${id}: line ${li + 1}, token "${tok}": ${(e as Error).message}`);
        }
      });
      continue;
    }
    switch (key) {
      case 'title':
        title = value;
        break;
      case 'composer':
        composer = value;
        break;
      case 'time': {
        const m = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
        if (!m) throw new Error(`${id}: bad time signature "${value}"`);
        timeSig = [parseInt(m[1], 10), parseInt(m[2], 10)];
        break;
      }
      case 'tempo':
        bpm = parseFloat(value);
        if (!(bpm > 0)) throw new Error(`${id}: bad tempo "${value}"`);
        break;
      case 'pickup':
        pickup = parseFloat(value);
        break;
      default: {
        const num = Number(value);
        meta[key] = value !== '' && !Number.isNaN(num) ? num : value;
      }
    }
  }

  const end = Math.max(streams.R.t, streams.L.t);
  const measures = buildMeasures([{ t: 0, num: timeSig[0], den: timeSig[1] }], end, pickup);
  // check barlines
  const boundaries = new Set(measures.map((m) => round(m.t)));
  boundaries.add(round(end));
  for (const b of barlines) {
    if (b.last) continue;
    if (!boundaries.has(round(b.t))) {
      const m = measureAt({ measures } as Score, b.t);
      throw new Error(`${id}: ${b.hand} line ${b.line}: barline at beat ${b.t} is inside measure ${m} (measure boundaries: ${[...boundaries].slice(0, 6).join(', ')}…)`);
    }
  }
  for (const [t, label] of sections) {
    const m = measures.find((x) => Math.abs(x.t - t) < EPS);
    if (m) m.section = label;
  }
  const score = finalizeScore({
    id,
    title,
    composer,
    timeSig,
    tempo: [{ t: 0, bpm }],
    measures,
    notes: [...streams.R.notes, ...streams.L.notes],
    source: 'library',
  });
  return { score, meta };
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function parseToken(
  tok: string,
  s: Stream,
  sections: Map<number, string>,
  barlines: { hand: Hand; t: number; last: boolean; line: number }[],
  isLast: boolean,
  line: number,
): void {
  if (tok === '|') {
    barlines.push({ hand: s.hand, t: s.t, last: isLast, line });
    return;
  }
  if (tok[0] === '@') {
    sections.set(round(s.t), tok.slice(1));
    return;
  }
  let pitches: number[] = [];
  let rest = false;
  let suffix: string;
  if (tok[0] === '[') {
    const close = tok.indexOf(']');
    if (close < 0) throw new Error('unclosed chord');
    pitches = tok
      .slice(1, close)
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(parsePitch);
    suffix = tok.slice(close + 1);
  } else if (tok[0] === 'r') {
    rest = true;
    suffix = tok.slice(1);
  } else {
    const m = /^([A-Ga-g](?:#{1,2}|b{1,2})?-?\d)(.*)$/.exec(tok);
    if (!m) throw new Error('unknown token');
    pitches = [parsePitch(m[1])];
    suffix = m[2];
  }
  const sm = SUFFIX_RE.exec(suffix);
  if (!sm) throw new Error(`bad duration/finger suffix "${suffix}"`);
  if (sm[1]) s.dur = durationBeats(parseInt(sm[1], 10), sm[2].length);
  else if (sm[2]) s.dur = durationBeats(4 / baseOf(s.dur), sm[2].length);
  const dur = s.dur;
  const fingers = sm[3] ? sm[3].split('').map((c) => parseInt(c, 10) as Finger) : [];
  const tie = sm[4] === '~';
  if (!rest) {
    if (fingers.length && fingers.length !== pitches.length) throw new Error(`fingers "${sm[3]}" do not match ${pitches.length} pitch(es)`);
    pitches.forEach((p, k) => {
      const open = s.openTies.get(p);
      if (open && Math.abs(open.t + open.dur - s.t) < EPS) {
        open.dur += dur;
        s.openTies.delete(p);
        if (tie) s.openTies.set(p, open);
        return;
      }
      s.openTies.delete(p);
      const n: ScoreNote = { pitch: p, t: s.t, dur, hand: s.hand, measure: 1 };
      if (fingers.length) {
        n.finger = fingers[k];
        n.fingerSource = 'file';
      }
      s.notes.push(n);
      if (tie) s.openTies.set(p, n);
    });
  }
  s.t += dur;
}

/** Undotted base of a dotted duration (so "C4." after "/8" means dotted eighth). */
function baseOf(dur: number): number {
  let b = 4;
  while (b > dur + EPS) b /= 2;
  return b;
}

function stripComment(line: string): string {
  const i = line.indexOf('//');
  return i < 0 ? line : line.slice(0, i);
}
