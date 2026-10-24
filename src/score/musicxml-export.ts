/**
 * MusicXML export (score-partwise 4.0): one piano part with the right hand on
 * the upper staff and the left hand on the lower one, every note with its
 * finger in <fingering>. Opens in MuseScore and other notation programs, and
 * in koimidi itself.
 *
 * Each staff is split into voices that never overlap themselves. Notes that
 * cross a barline are split and tied; durations that are not a single note
 * value become tied pieces. Times that are not on a simple grid (a MIDI file
 * recorded by hand) are rounded to 1/24 of a beat. Accidentals, beams and stems
 * are left to the notation program, as the <supports> elements declare.
 */
import { EPS, type Hand, type Score, type ScoreNote } from './model';

export interface ExportOptions {
  /** Written into <encoding><software>. */
  software?: string;
  /** Written into <encoding-date>, YYYY-MM-DD. */
  date?: string;
}

interface Chord {
  s: number;
  e: number;
  notes: ScoreNote[];
}

interface Voice {
  chords: Chord[];
  end: number;
}

interface Piece {
  units: number;
  type?: string;
  dots: number;
  tuplet: boolean;
}

const GRIDS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 96];
const FALLBACK_GRID = 24;
const TYPES: [string, number][] = [
  ['whole', 4],
  ['half', 2],
  ['quarter', 1],
  ['eighth', 0.5],
  ['16th', 0.25],
  ['32nd', 0.125],
  ['64th', 0.0625],
];
/** Spelling by pitch class, matching the note names in the UI: sharps, and B flat. */
const SPELL: [string, number][] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['B', -1], ['B', 0],
];

const isInt = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;

export function toMusicXML(score: Score, opts: ExportOptions = {}): string {
  const times = [...score.notes.flatMap((n) => [n.t, n.dur]), ...score.measures.flatMap((m) => [m.t, m.beats])];
  const div = GRIDS.find((d) => times.every((v) => Math.abs(v * d - Math.round(v * d)) < 1e-3)) ?? FALLBACK_GRID;
  const q = (beats: number) => Math.round(beats * div);
  const values = noteValues(div);

  // measure bounds in divisions, made contiguous after rounding
  const bounds: [number, number][] = score.measures.map((m) => [q(m.t), q(m.t + m.beats)]);
  for (let i = 1; i < bounds.length; i++) bounds[i][0] = bounds[i - 1][1];
  for (const b of bounds) b[1] = Math.max(b[1], b[0] + 1);
  const pieceEnd = bounds.length ? bounds[bounds.length - 1][1] : q(score.end);

  const twoStaves = score.hands.L;
  const staffOf = (h: Hand) => (twoStaves && h === 'L' ? 2 : 1);
  const staves = twoStaves ? [1, 2] : [1];
  const voices = new Map<number, Voice[]>(staves.map((s) => [s, buildVoices(score.notes.filter((n) => staffOf(n.hand) === s), q, pieceEnd, s === 1)]));
  const voiceBase = new Map<number, number>([[1, 1], [2, Math.max(5, (voices.get(1)?.length ?? 0) + 1)]]);

  const tempos = score.tempo.map((te) => ({ u: q(te.t), bpm: Math.round(te.bpm * 100) / 100 }));
  const [num, den] = score.timeSig;
  let nominal = q((num * 4) / den);
  const lines: string[] = [];
  const push = (indent: number, s: string) => lines.push('  '.repeat(indent) + s);

  push(0, '<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  push(0, '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  push(0, '<score-partwise version="4.0">');
  push(1, `<work><work-title>${esc(score.title)}</work-title></work>`);
  push(1, '<identification>');
  if (score.composer) push(2, `<creator type="composer">${esc(score.composer)}</creator>`);
  push(2, '<encoding>');
  if (opts.software) push(3, `<software>${esc(opts.software)}</software>`);
  if (opts.date) push(3, `<encoding-date>${esc(opts.date)}</encoding-date>`);
  for (const el of ['accidental', 'beam', 'stem']) push(3, `<supports element="${el}" type="no"/>`);
  push(2, '</encoding>');
  push(1, '</identification>');
  push(1, '<part-list>');
  push(2, '<score-part id="P1"><part-name>Piano</part-name></score-part>');
  push(1, '</part-list>');
  push(1, '<part id="P1">');

  score.measures.forEach((m, i) => {
    const [ms, me] = bounds[i];
    const len = me - ms;
    const pickup = i === 0 && len < nominal;
    push(2, `<measure number="${m.number}"${pickup ? ' implicit="yes"' : ''}>`);
    let timeChange: [number, number] | null = null;
    if (i === 0 ? len > nominal : len > nominal || (len < nominal && i < score.measures.length - 1)) {
      timeChange = sigFor(len / div, den);
      nominal = len;
    }
    if (i === 0) {
      const [tn, td] = timeChange ?? [num, den];
      push(3, '<attributes>');
      push(4, `<divisions>${div}</divisions>`);
      push(4, '<key><fifths>0</fifths></key>');
      push(4, `<time><beats>${tn}</beats><beat-type>${td}</beat-type></time>`);
      if (twoStaves) push(4, '<staves>2</staves>');
      for (const s of staves) push(4, clefFor(score, s, twoStaves));
      push(3, '</attributes>');
    } else if (timeChange) {
      push(3, `<attributes><time><beats>${timeChange[0]}</beats><beat-type>${timeChange[1]}</beat-type></time></attributes>`);
    }
    if (m.section) push(3, `<direction placement="above"><direction-type><rehearsal>${esc(m.section)}</rehearsal></direction-type></direction>`);

    // tempo marks: those on the downbeat here, the rest just before the note or rest they fall on
    const pending = tempos.filter((te) => te.u >= ms && te.u < me);
    const flushTempo = (at: number, emit: (s: string) => void) => {
      while (pending.length && pending[0].u <= at) {
        const te = pending.shift()!;
        emit(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${te.bpm}</per-minute></metronome></direction-type>${twoStaves ? '<staff>1</staff>' : ''}<sound tempo="${te.bpm}"/></direction>`);
      }
    };
    flushTempo(ms, (x) => push(3, x));

    const blocks: string[][] = [];
    for (const staff of staves) {
      const vs = voices.get(staff)!;
      const count = Math.max(1, vs.length);
      for (let vi = 0; vi < count; vi++) {
        const v = vs[vi];
        const busy = v?.chords.some((c) => c.s < me && c.e > ms);
        if (vi > 0 && !busy) continue;
        const out: string[] = [];
        const vnum = voiceBase.get(staff)! + vi;
        const tempoHook = staff === 1 && vi === 0 ? (at: number) => flushTempo(at, (x) => out.push(x)) : undefined;
        writeVoice(out, v?.chords ?? [], ms, me, vi === 0, vnum, twoStaves ? staff : 0, values, tempoHook);
        blocks.push(out);
      }
    }
    blocks.forEach((b, k) => {
      for (const l of b) push(3, l);
      if (k < blocks.length - 1) push(3, `<backup><duration>${len}</duration></backup>`);
    });
    push(2, '</measure>');
  });

  push(1, '</part>');
  push(0, '</score-partwise>');
  return lines.join('\n') + '\n';
}

/** Group a staff's notes into chords (same start and end) and lay them out in non-overlapping voices. */
function buildVoices(notes: ScoreNote[], q: (b: number) => number, pieceEnd: number, upper: boolean): Voice[] {
  const byKey = new Map<string, Chord>();
  for (const n of notes) {
    const s = q(n.t);
    const e = Math.min(pieceEnd, Math.max(s + 1, q(n.t + n.dur)));
    if (s >= pieceEnd) continue;
    const k = `${s}|${e}`;
    const c = byKey.get(k);
    if (c) c.notes.push(n);
    else byKey.set(k, { s, e, notes: [n] });
  }
  const outer = (c: Chord) => (upper ? Math.max(...c.notes.map((n) => n.pitch)) : -Math.min(...c.notes.map((n) => n.pitch)));
  const chords = [...byKey.values()].sort((a, b) => a.s - b.s || outer(b) - outer(a));
  for (const c of chords) c.notes.sort((a, b) => a.pitch - b.pitch);
  const voices: Voice[] = [];
  for (const c of chords) {
    let v = voices.find((x) => x.end <= c.s);
    if (!v) voices.push((v = { chords: [], end: 0 }));
    v.chords.push(c);
    v.end = c.e;
  }
  return voices;
}

function writeVoice(
  out: string[],
  chords: Chord[],
  ms: number,
  me: number,
  primary: boolean,
  voice: number,
  staff: number,
  values: Piece[],
  tempoHook?: (at: number) => void,
): void {
  const staffEl = staff ? `<staff>${staff}</staff>` : '';
  let cur = ms;
  const gap = (a: number, b: number) => {
    if (b <= a) return;
    if (!primary) {
      out.push(`<forward><duration>${b - a}</duration><voice>${voice}</voice>${staffEl}</forward>`);
      return;
    }
    if (a === ms && b === me) {
      tempoHook?.(a);
      out.push(`<note><rest measure="yes"/><duration>${b - a}</duration><voice>${voice}</voice>${staffEl}</note>`);
      return;
    }
    let at = a;
    for (const p of split(b - a, values)) {
      tempoHook?.(at);
      out.push(`<note><rest/><duration>${p.units}</duration><voice>${voice}</voice>${typeXml(p)}${staffEl}</note>`);
      at += p.units;
    }
  };
  for (const c of chords) {
    if (c.e <= ms || c.s >= me) continue;
    const a = Math.max(c.s, ms);
    const b = Math.min(c.e, me);
    gap(cur, a);
    const pieces = split(b - a, values);
    let at = a;
    pieces.forEach((p, k) => {
      tempoHook?.(at);
      const tieIn = a > c.s || k > 0;
      const tieOut = b < c.e || k < pieces.length - 1;
      c.notes.forEach((n, j) => out.push(noteXml(n, p, j > 0, tieIn, tieOut, voice, staffEl)));
      at += p.units;
    });
    cur = b;
  }
  gap(cur, me);
}

function noteXml(n: ScoreNote, p: Piece, chord: boolean, tieIn: boolean, tieOut: boolean, voice: number, staffEl: string): string {
  const [step, alter] = SPELL[((n.pitch % 12) + 12) % 12];
  const octave = Math.floor(n.pitch / 12) - 1;
  let x = '<note>';
  if (chord) x += '<chord/>';
  x += `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;
  x += `<duration>${p.units}</duration>`;
  if (tieIn) x += '<tie type="stop"/>';
  if (tieOut) x += '<tie type="start"/>';
  x += `<voice>${voice}</voice>${typeXml(p)}${staffEl}`;
  const notations: string[] = [];
  if (tieIn) notations.push('<tied type="stop"/>');
  if (tieOut) notations.push('<tied type="start"/>');
  if (n.finger && !tieIn) notations.push(`<technical><fingering>${n.finger}</fingering></technical>`);
  if (notations.length) x += `<notations>${notations.join('')}</notations>`;
  return x + '</note>';
}

function typeXml(p: Piece): string {
  if (!p.type) return '';
  let x = `<type>${p.type}</type>` + '<dot/>'.repeat(p.dots);
  if (p.tuplet) x += '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
  return x;
}

/** Every single note value (plain, dotted, double-dotted, triplet) that is a whole number of divisions, longest first. */
function noteValues(div: number): Piece[] {
  const out: Piece[] = [];
  for (const [type, beats] of TYPES) {
    for (const [dots, mul] of [[0, 1], [1, 1.5], [2, 1.75]] as const) {
      const u = beats * mul * div;
      if (u >= 1 - EPS && isInt(u)) out.push({ units: Math.round(u), type, dots, tuplet: false });
    }
    const tu = ((beats * 2) / 3) * div;
    if (tu >= 1 - EPS && isInt(tu)) out.push({ units: Math.round(tu), type, dots: 0, tuplet: true });
  }
  return out.sort((a, b) => b.units - a.units || Number(a.tuplet) - Number(b.tuplet));
}

/** Split a duration into note values, longest first; what no value covers is written without a type. */
function split(units: number, values: Piece[]): Piece[] {
  const out: Piece[] = [];
  let left = units;
  while (left > 0) {
    const v = values.find((x) => x.units <= left);
    if (!v) {
      out.push({ units: left, dots: 0, tuplet: false });
      break;
    }
    out.push(v);
    left -= v.units;
  }
  return out;
}

/** A time signature for a bar of `beats` quarter notes, keeping the piece's beat type when it can. */
function sigFor(beats: number, den: number): [number, number] {
  for (const d of [den, 4, 8, 16, 2]) {
    const n = (beats * d) / 4;
    if (isInt(n) && n >= 1) return [Math.round(n), d];
  }
  return [Math.max(1, Math.round(beats)), 4];
}

function clefFor(score: Score, staff: number, twoStaves: boolean): string {
  const hand: Hand = twoStaves && staff === 2 ? 'L' : 'R';
  const ps = score.notes.filter((n) => n.hand === hand).map((n) => n.pitch);
  const mean = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : hand === 'R' ? 67 : 50;
  const bass = hand === 'L' ? mean < 64 : mean < 55;
  const num = twoStaves ? ` number="${staff}"` : '';
  return bass ? `<clef${num}><sign>F</sign><line>4</line></clef>` : `<clef${num}><sign>G</sign><line>2</line></clef>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
