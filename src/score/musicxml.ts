/**
 * MusicXML importer (score-partwise, .musicxml/.xml and compressed .mxl).
 * Runs entirely in the browser with DOMParser; nothing leaves the device.
 *
 * Handled: divisions, time signatures, tempo (<sound tempo> and <metronome>),
 * chords, rests, ties (merged), tuplets (via <duration>), <backup>/<forward>,
 * staves (staff 1 = right hand, staff 2+ = left), <fingering>, <rehearsal>
 * marks as sections, <transpose> (sounding pitch), pickup measures.
 * Ignored: repeats and endings, grace and cue notes, lyrics, dynamics.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { buildMeasures, finalizeScore, type Finger, type Hand, type Score, type ScoreNote, EPS } from './model';

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

interface RawNote {
  offset: number; // beats from measure start
  dur: number;
  pitch: number;
  staff: number;
  voice: string;
  tieStart: boolean;
  tieStop: boolean;
  finger?: Finger;
}

interface RawMeasure {
  content: number; // beats actually filled
  nominal: number; // beats by time signature
  implicit: boolean;
  sig?: { num: number; den: number };
  notes: RawNote[];
  tempos: { offset: number; bpm: number }[];
  section?: string;
}

interface RawPart {
  id: string;
  name: string;
  staves: number;
  measures: RawMeasure[];
  noteCount: number;
  meanPitch: number;
}

export function parseMusicXML(xmlText: string, id: string, fileName = ''): Score {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const perr = doc.getElementsByTagName('parsererror')[0];
  if (perr) throw new Error('Not a valid XML file');
  const root = doc.documentElement;
  if (!root || root.tagName !== 'score-partwise') {
    throw new Error(root?.tagName === 'score-timewise' ? 'score-timewise MusicXML is not supported yet' : 'Not a MusicXML score');
  }
  const title =
    textOf(firstByPath(root, ['work', 'work-title'])) ||
    textOf(firstByPath(root, ['movement-title'])) ||
    fileName.replace(/\.[^.]+$/, '') ||
    'Untitled';
  let composer: string | undefined;
  for (const c of childrenNamed(firstByPath(root, ['identification']), 'creator')) {
    if (c.getAttribute('type') === 'composer' || !composer) composer = textOf(c) || composer;
  }
  const partNames = new Map<string, string>();
  for (const sp of childrenNamed(firstByPath(root, ['part-list']), 'score-part')) {
    partNames.set(sp.getAttribute('id') || '', textOf(firstByPath(sp, ['part-name'])));
  }

  const parts: RawPart[] = childrenNamed(root, 'part').map((p) => parsePart(p, partNames));
  const withNotes = parts.filter((p) => p.noteCount > 0);
  if (!withNotes.length) throw new Error('The score has no notes');

  // Which parts become which hand.
  const assign: { part: RawPart; byStaff: boolean; hand: Hand }[] = [];
  const piano = withNotes.find((p) => p.staves >= 2);
  if (piano) assign.push({ part: piano, byStaff: true, hand: 'R' });
  else if (withNotes.length >= 2) {
    const sorted = [...withNotes].sort((a, b) => b.noteCount - a.noteCount).slice(0, 2);
    sorted.sort((a, b) => b.meanPitch - a.meanPitch);
    assign.push({ part: sorted[0], byStaff: false, hand: 'R' }, { part: sorted[1], byStaff: false, hand: 'L' });
  } else assign.push({ part: withNotes[0], byStaff: false, hand: 'R' });

  // Global measure timeline: agree across parts.
  const nMeasures = Math.max(...parts.map((p) => p.measures.length));
  const starts: number[] = [];
  const lengths: number[] = [];
  const sigs: { t: number; num: number; den: number }[] = [];
  let t = 0;
  let curSig = { num: 4, den: 4 };
  for (let i = 0; i < nMeasures; i++) {
    const ms = parts.map((p) => p.measures[i]).filter(Boolean) as RawMeasure[];
    const sig = ms.find((m) => m.sig)?.sig;
    if (sig && (sig.num !== curSig.num || sig.den !== curSig.den || i === 0)) {
      curSig = sig;
      sigs.push({ t, num: sig.num, den: sig.den });
    } else if (i === 0) sigs.push({ t: 0, num: curSig.num, den: curSig.den });
    const nominal = (curSig.num * 4) / curSig.den;
    const content = Math.max(0, ...ms.map((m) => m.content));
    const implicit = ms.some((m) => m.implicit);
    let len = nominal;
    if (content > nominal + EPS) len = content;
    else if (content > EPS && content < nominal - EPS && (implicit || i === 0 || i === nMeasures - 1)) len = content;
    starts.push(t);
    lengths.push(len);
    t += len;
  }
  const end = t;

  const notes: ScoreNote[] = [];
  const tempo: { t: number; bpm: number }[] = [];
  const sections = new Map<number, string>();
  for (const a of assign) {
    const open = new Map<string, ScoreNote>(); // tie continuation by hand|voice|pitch
    a.part.measures.forEach((m, i) => {
      const base = starts[i];
      for (const te of m.tempos) tempo.push({ t: base + te.offset, bpm: te.bpm });
      if (m.section && !sections.has(i)) sections.set(i, m.section);
      for (const rn of m.notes) {
        const hand: Hand = a.byStaff ? (rn.staff >= 2 ? 'L' : 'R') : a.hand;
        const key = `${hand}|${rn.voice}|${rn.pitch}`;
        const start = base + rn.offset;
        const prev = open.get(key);
        if (rn.tieStop && prev && Math.abs(prev.t + prev.dur - start) < 0.05) {
          prev.dur = start + rn.dur - prev.t;
          if (!rn.tieStart) open.delete(key);
          continue;
        }
        open.delete(key);
        const n: ScoreNote = { pitch: rn.pitch, t: start, dur: rn.dur, hand, measure: i + 1 };
        if (rn.finger) {
          n.finger = rn.finger;
          n.fingerSource = 'file';
        }
        notes.push(n);
        if (rn.tieStart) open.set(key, n);
      }
    });
  }
  // de-duplicate tempo events at the same beat (parts repeat them)
  const tempoMap = new Map<number, number>();
  for (const te of tempo) if (te.bpm > 0) tempoMap.set(Math.round(te.t * 1000) / 1000, te.bpm);
  const tempoEvents = [...tempoMap].map(([tt, bpm]) => ({ t: tt, bpm })).sort((x, y) => x.t - y.t);
  if (!tempoEvents.length || tempoEvents[0].t > EPS) tempoEvents.unshift({ t: 0, bpm: tempoEvents[0]?.bpm ?? 100 });

  const measures = buildMeasures(sigs, end);
  // replace generated measure lengths with the actual per-measure lengths
  const fixed = starts.map((s, i) => ({ number: i + 1, t: s, beats: lengths[i], section: sections.get(i) }));
  const timeSig: [number, number] = [sigs[0]?.num ?? 4, sigs[0]?.den ?? 4];
  void measures;
  return finalizeScore({ id, title, composer, timeSig, tempo: tempoEvents, measures: fixed, notes, source: 'musicxml' });
}

/** Compressed MusicXML (.mxl): a zip with META-INF/container.xml pointing at the score. */
export function parseMXL(bytes: Uint8Array, id: string, fileName = ''): Score {
  const files = unzipSync(bytes);
  let rootPath = '';
  const container = files['META-INF/container.xml'];
  if (container) {
    const m = /full-path="([^"]+)"/.exec(strFromU8(container));
    if (m && files[m[1]]) rootPath = m[1];
  }
  if (!rootPath) {
    rootPath = Object.keys(files).find((k) => !k.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(k)) || '';
  }
  if (!rootPath) throw new Error('No MusicXML score inside the .mxl archive');
  return parseMusicXML(strFromU8(files[rootPath]), id, fileName);
}

/* ---------- helpers ---------- */

function parsePart(part: Element, names: Map<string, string>): RawPart {
  const id = part.getAttribute('id') || '';
  let divisions = 1;
  let staves = 1;
  let transpose = 0;
  let noteCount = 0;
  let pitchSum = 0;
  const measures: RawMeasure[] = [];
  let curSig = { num: 4, den: 4 };
  for (const me of childrenNamed(part, 'measure')) {
    const rm: RawMeasure = { content: 0, nominal: (curSig.num * 4) / curSig.den, implicit: me.getAttribute('implicit') === 'yes', notes: [], tempos: [] };
    let pos = 0;
    let lastStart = 0;
    for (const el of Array.from(me.children)) {
      switch (el.tagName) {
        case 'attributes': {
          const d = parseFloat(textOf(firstByPath(el, ['divisions'])));
          if (d > 0) divisions = d;
          const time = firstByPath(el, ['time']);
          if (time) {
            const num = parseInt(textOf(firstByPath(time, ['beats'])), 10);
            const den = parseInt(textOf(firstByPath(time, ['beat-type'])), 10);
            if (num > 0 && den > 0) {
              curSig = { num, den };
              rm.sig = curSig;
              rm.nominal = (num * 4) / den;
            }
          }
          const st = parseInt(textOf(firstByPath(el, ['staves'])), 10);
          if (st > staves) staves = st;
          const tr = firstByPath(el, ['transpose']);
          if (tr) {
            const chrom = parseInt(textOf(firstByPath(tr, ['chromatic'])) || '0', 10);
            const oct = parseInt(textOf(firstByPath(tr, ['octave-change'])) || '0', 10);
            transpose = chrom + 12 * oct;
          }
          break;
        }
        case 'direction': {
          const snd = firstByPath(el, ['sound']);
          const tempoAttr = snd?.getAttribute('tempo');
          if (tempoAttr && parseFloat(tempoAttr) > 0) rm.tempos.push({ offset: pos, bpm: parseFloat(tempoAttr) });
          else {
            const met = firstByPath(el, ['direction-type', 'metronome']);
            if (met) {
              const unit = textOf(firstByPath(met, ['beat-unit']));
              const dotted = childrenNamed(met, 'beat-unit-dot').length > 0;
              const pm = parseFloat(textOf(firstByPath(met, ['per-minute'])));
              const factor = ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 } as Record<string, number>)[unit] ?? 1;
              if (pm > 0) rm.tempos.push({ offset: pos, bpm: pm * factor * (dotted ? 1.5 : 1) });
            }
          }
          const reh = firstByPath(el, ['direction-type', 'rehearsal']);
          if (reh && textOf(reh)) rm.section = textOf(reh);
          break;
        }
        case 'sound': {
          const tempoAttr = el.getAttribute('tempo');
          if (tempoAttr && parseFloat(tempoAttr) > 0) rm.tempos.push({ offset: pos, bpm: parseFloat(tempoAttr) });
          break;
        }
        case 'backup':
          pos -= parseFloat(textOf(firstByPath(el, ['duration'])) || '0') / divisions;
          if (pos < 0) pos = 0;
          break;
        case 'forward':
          pos += parseFloat(textOf(firstByPath(el, ['duration'])) || '0') / divisions;
          rm.content = Math.max(rm.content, pos);
          break;
        case 'note': {
          if (firstByPath(el, ['grace']) || firstByPath(el, ['cue'])) break;
          const isChord = !!firstByPath(el, ['chord']);
          const dur = parseFloat(textOf(firstByPath(el, ['duration'])) || '0') / divisions;
          const start = isChord ? lastStart : pos;
          const pitchEl = firstByPath(el, ['pitch']);
          if (pitchEl) {
            const step = STEP[textOf(firstByPath(pitchEl, ['step'])).toUpperCase()] ?? 0;
            const alter = parseFloat(textOf(firstByPath(pitchEl, ['alter'])) || '0');
            const octave = parseInt(textOf(firstByPath(pitchEl, ['octave'])) || '4', 10);
            const pitch = 12 * (octave + 1) + step + Math.round(alter) + transpose;
            const staff = parseInt(textOf(firstByPath(el, ['staff'])) || '1', 10);
            const voice = textOf(firstByPath(el, ['voice'])) || '1';
            let tieStart = false;
            let tieStop = false;
            for (const tie of childrenNamed(el, 'tie')) {
              if (tie.getAttribute('type') === 'start') tieStart = true;
              if (tie.getAttribute('type') === 'stop') tieStop = true;
            }
            for (const nt of childrenNamed(el, 'notations')) {
              for (const tied of childrenNamed(nt, 'tied')) {
                if (tied.getAttribute('type') === 'start') tieStart = true;
                if (tied.getAttribute('type') === 'stop') tieStop = true;
              }
            }
            let finger: Finger | undefined;
            const fe = firstByPath(el, ['notations', 'technical', 'fingering']);
            const fv = fe ? parseInt(textOf(fe), 10) : NaN;
            if (fv >= 1 && fv <= 5) finger = fv as Finger;
            if (dur > 0) {
              rm.notes.push({ offset: start, dur, pitch, staff, voice, tieStart, tieStop, finger });
              noteCount++;
              pitchSum += pitch;
            }
          }
          if (!isChord) {
            lastStart = pos;
            pos += dur;
          }
          rm.content = Math.max(rm.content, isChord ? start + dur : pos);
          break;
        }
        default:
          break;
      }
    }
    measures.push(rm);
  }
  return { id, name: names.get(id) || id, staves, measures, noteCount, meanPitch: noteCount ? pitchSum / noteCount : 0 };
}

function childrenNamed(el: Element | null | undefined, name: string): Element[] {
  if (!el) return [];
  return Array.from(el.children).filter((c) => c.tagName === name);
}

function firstByPath(el: Element | null | undefined, path: string[]): Element | null {
  let cur: Element | null = el ?? null;
  for (const name of path) {
    if (!cur) return null;
    cur = childrenNamed(cur, name)[0] ?? null;
  }
  return cur;
}

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}
