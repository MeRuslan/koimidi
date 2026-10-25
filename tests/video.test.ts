import { describe, expect, it } from 'vitest';
import { libraryScore } from '../src/library';
import { PIECES } from '../src/library/pieces';
import { parseMidi } from '../src/score/midi';
import { beatsToSeconds, type Score } from '../src/score/model';
import type { Frame } from '../src/video/frame';
import { detectKeyboard } from '../src/video/keyboard';
import { syntheticVideo, type SynthNote, type SynthOptions } from '../src/video/synthetic';
import { KeyTracker, playable, type RawNote } from '../src/video/tracker';
import { guessMeter, handsByColor, toMidi, transcribe, type OnsetInBeats } from '../src/video/transcribe';
import { youTubeId, youTubeStart } from '../src/video/youtube';

const LEAD = 1;

/** A library piece as notes in seconds; `gate` < 1 leaves a gap before the next note, as most videos do. */
function synthNotes(s: Score, gate = 1): SynthNote[] {
  return s.notes.map((n) => {
    const on = LEAD + beatsToSeconds(s, n.t);
    const off = LEAD + beatsToSeconds(s, n.t + n.dur);
    return { pitch: n.pitch, on, off: on + (off - on) * gate, hand: n.hand };
  });
}

function rows(f: Frame, top: number, bottom: number): Frame {
  return { width: f.width, height: bottom - top + 1, data: f.data.slice(top * f.width * 4, (bottom + 1) * f.width * 4) };
}

function track(notes: SynthNote[], o: SynthOptions & { fps?: number } = {}) {
  const v = syntheticVideo(notes, { width: 480, height: 270, ...o });
  const fps = o.fps ?? 30;
  const calib = v.frameAt(LEAD - 0.5);
  const layout = detectKeyboard(calib);
  if (!layout) throw new Error('no keyboard');
  const tracker = new KeyTracker(layout, calib);
  const { top, bottom } = tracker.band;
  const end = Math.max(...notes.map((n) => n.off)) + 0.5;
  for (let i = 0; i / fps <= end; i++) tracker.push(rows(v.frameAt(i / fps), top, bottom), i / fps, top);
  return { layout, raw: tracker.finish(), tracker, video: v };
}

/** Share of the expected notes found with the right pitch within `tol` seconds, and share of found notes that were expected. */
function match(expected: SynthNote[], found: RawNote[], tol: number) {
  const used = new Set<number>();
  let hits = 0;
  for (const e of expected) {
    const i = found.findIndex((f, k) => !used.has(k) && f.pitch === e.pitch && Math.abs(f.on - e.on) <= tol);
    if (i >= 0) {
      used.add(i);
      hits++;
    }
  }
  return { recall: hits / expected.length, precision: hits / Math.max(1, found.length) };
}

describe('keyboard detection', () => {
  it('finds all 88 keys of a full keyboard and names them A0–C8', () => {
    for (const [w, h] of [
      [640, 360],
      [1280, 720],
      [426, 240],
    ]) {
      const f = syntheticVideo([], { width: w, height: h }).frameAt(0);
      const k = detectKeyboard(f)!;
      expect(k, `${w}x${h}`).not.toBeNull();
      expect(k.keys.length, `${w}x${h}`).toBe(88);
      expect(k.keys[0].pitch).toBe(21);
      expect(k.keys[87].pitch).toBe(108);
      expect(k.octaveSure).toBe(true);
      expect(k.keys.filter((x) => x.black).length).toBe(36);
    }
  });

  it('finds the whole keyboard while keys are lit, the end keys too', () => {
    const lit: SynthNote[] = [21, 48, 60, 64, 67, 70, 108].map((pitch) => ({ pitch, on: 0, off: 1, hand: pitch < 60 ? 'L' : 'R' }));
    const k = detectKeyboard(syntheticVideo(lit, { width: 1280, height: 720 }).frameAt(0.5))!;
    expect(k.keys.length).toBe(88);
    expect(k.keys[0].pitch).toBe(21);
  });

  it('knows a 61-key keyboard and guesses middle C on a cut-out one', () => {
    const k61 = detectKeyboard(syntheticVideo([], { low: 36, high: 96 }).frameAt(0))!;
    expect(k61.keys.length).toBe(61);
    expect(k61.keys[0].pitch).toBe(36);
    const part = detectKeyboard(syntheticVideo([], { low: 48, high: 84 }).frameAt(0))!;
    expect(part.keys.length).toBe(37);
    expect(part.keys[0].pitch).toBe(48);
    expect(part.octaveSure).toBe(false);
  });

  it('finds the keyboard inside a larger frame, with a white page around the video', () => {
    const v = syntheticVideo([], { width: 640, height: 360, felt: true }).frameAt(0);
    const W = 960;
    const H = 640;
    const data = new Uint8ClampedArray(W * H * 4).fill(250);
    for (let y = 0; y < 360; y++) data.set(v.data.subarray(y * 640 * 4, (y + 1) * 640 * 4), ((y + 140) * W + 160) * 4);
    const k = detectKeyboard({ width: W, height: H, data })!;
    expect(k).not.toBeNull();
    // the page beside the video is not a key; C8 is lost against the white page, so the octave is guessed from the centre
    expect(k.keys[0].pitch).toBe(21);
    expect(k.keys.length).toBeGreaterThanOrEqual(87);
    expect(k.keys.length).toBeLessThanOrEqual(88);
    expect(k.keys[0].x).toBeGreaterThan(160);
  });

  it('finds nothing in a frame without a keyboard', () => {
    expect(detectKeyboard(syntheticVideo([], { keyboardFrom: 10 }).frameAt(0))).toBeNull();
    const white = { width: 320, height: 180, data: new Uint8ClampedArray(320 * 180 * 4).fill(255) };
    expect(detectKeyboard(white)).toBeNull();
  });
});

describe('key tracking', () => {
  it('reads every note of a two-hand piece within a frame', () => {
    const s = libraryScore('ode-to-joy');
    // the gap before a repeated note at least a frame long, as videos that darken the key between presses make it
    const notes = synthNotes(s, 0.85);
    const { raw } = track(notes, { noise: 6 });
    const m = match(notes, raw, 1 / 30 + 0.01);
    expect(m.recall).toBeGreaterThanOrEqual(0.99);
    expect(m.precision).toBeGreaterThanOrEqual(0.99);
  });

  it('splits a key held across repeated notes of the same pitch by watching the falling bars', () => {
    const s = libraryScore('twinkle');
    const notes = synthNotes(s, 1); // legato: C C G G … with no gap between the bars' lights
    const { raw, tracker } = track(notes, { felt: true });
    expect(tracker.speed).not.toBeNull();
    const m = match(notes, raw, 1 / 30 + 0.02);
    expect(m.recall).toBeGreaterThanOrEqual(0.97);
    expect(m.precision).toBeGreaterThanOrEqual(0.97);
  });

  it('ignores the title card before the keyboard appears', () => {
    const notes: SynthNote[] = [
      { pitch: 60, on: 2, off: 2.5, hand: 'R' },
      { pitch: 64, on: 2.5, off: 3, hand: 'R' },
    ];
    const v = syntheticVideo(notes, { keyboardFrom: 1 });
    const calib = v.frameAt(1.5);
    const tracker = new KeyTracker(detectKeyboard(calib)!, calib);
    for (let i = 0; i <= 120; i++) tracker.push(v.frameAt(i / 30), i / 30);
    expect(tracker.finish().map((n) => n.pitch)).toEqual([60, 64]);
    expect(tracker.skipped).toBeGreaterThan(20);
  });

  it('lets go of held keys across a hole in the frames (a stalled video)', () => {
    const notes: SynthNote[] = [
      { pitch: 60, on: 1, off: 6, hand: 'R' },
      { pitch: 64, on: 4.5, off: 5, hand: 'R' },
    ];
    const v = syntheticVideo(notes);
    const calib = v.frameAt(0.5);
    const tracker = new KeyTracker(detectKeyboard(calib)!, calib);
    // frames up to 2 s and from 4 s: nothing in between
    for (let i = 0; i <= 180; i++) if (i / 30 <= 2 || i / 30 >= 4) tracker.push(v.frameAt(i / 30), i / 30);
    const raw = tracker.finish();
    const c4 = raw.filter((n) => n.pitch === 60);
    expect(c4.length).toBe(2);
    expect(c4[0].off).toBeLessThanOrEqual(2.01);
    expect(c4[1].on).toBeGreaterThanOrEqual(3.99);
  });

  it('tells the hands apart by colour', () => {
    const notes = synthNotes(libraryScore('ode-to-joy'), 0.9);
    const { raw } = track(notes);
    const hands = handsByColor(raw)!;
    expect(hands).not.toBeNull();
    let right = 0;
    raw.forEach((n, i) => {
      const e = notes.find((x) => x.pitch === n.pitch && Math.abs(x.on - n.on) < 0.05);
      if (e && e.hand === hands[i]) right++;
    });
    expect(right / raw.length).toBeGreaterThanOrEqual(0.99);
  });
});

describe('real video styles', () => {
  /** Detected keys against the drawn ones, after lining up the octave (a close-up cannot tell it). */
  function checkKeys(o: SynthOptions, notes: SynthNote[] = []) {
    const v = syntheticVideo(notes, o);
    const k = detectKeyboard(v.frameAt(0))!;
    expect(k, 'keyboard').not.toBeNull();
    return k;
  }

  it('close-up with real piano proportions, cut-off end keys, a logo and note names on the bars', () => {
    const o: SynthOptions = { width: 640, height: 360, low: 40, high: 96, visibleWhites: 30, shift: 0.4, geometry: 'piano', lit: 'stripe', watermark: true, felt: true, barLabels: true };
    const k = checkKeys(o);
    // 30 white keys fit, the first one cut: E2 is mostly off-screen, F2 is the first key whose centre shows
    const whites = k.keys.filter((x) => !x.black);
    expect(whites.length).toBeGreaterThanOrEqual(29);
    expect(whites.length).toBeLessThanOrEqual(31);
    expect(k.keys.filter((x) => x.black).length).toBeGreaterThanOrEqual(20);
    // every white key centred on a drawn key, every black key on a drawn black key
    const ww = 640 / 30;
    for (const key of k.keys) {
      if (key.black) continue;
      const rel = (key.x + 0.4 * ww) / ww - 0.5;
      expect(Math.abs(rel - Math.round(rel)), `white ${key.pitch}`).toBeLessThan(0.2);
    }
    const notes = synthNotes(libraryScore('ode-to-joy'), 0.9);
    const { raw } = track(notes, o);
    const shift = mode(raw.map((r) => r.pitch - (notes.find((n) => Math.abs(n.on - r.on) < 0.05)?.pitch ?? NaN)).filter((d) => !Number.isNaN(d)));
    expect(shift % 12).toBe(0);
    const m = match(notes, raw.map((r) => ({ ...r, pitch: r.pitch - shift })), 1 / 30 + 0.01);
    expect(m.recall).toBeGreaterThanOrEqual(0.97);
    expect(m.precision).toBeGreaterThanOrEqual(0.97);
  }, 30000);

  it('keys lit only above, letters on the keys, a picture and note names on the bars', () => {
    const o: SynthOptions = { width: 640, height: 360, low: 45, high: 74, geometry: 'piano', lit: 'top', labels: true, picture: true, felt: true, barLabels: true };
    const k = checkKeys(o);
    expect(k.keys.length).toBe(30);
    expect(k.keys[0].pitch % 12).toBe(9); // A
    // 60 frames a second, as most tutorials: the letters on the bars pass the keys in enough frames to look like gaps
    const notes = synthNotes(libraryScore('twinkle'), 1);
    const { raw } = track(notes, { ...o, fps: 60 });
    const shift = k.keys[0].pitch - 45;
    const m = match(notes, raw.map((r) => ({ ...r, pitch: r.pitch - shift })), 1 / 30 + 0.02);
    expect(m.recall).toBeGreaterThanOrEqual(0.95);
    expect(m.precision).toBeGreaterThanOrEqual(0.95);
  }, 30000);
});

function mode(xs: number[]): number {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

describe('playable notes', () => {
  it('takes a piece for playable and hands over a filmed piano for not', () => {
    const piece = synthNotes(libraryScore('ode-to-joy'), 0.9).map((n) => ({ pitch: n.pitch, on: n.on, off: n.off, color: [126, 226, 132] as [number, number, number] }));
    expect(playable(piece)).toBe(true);
    // a hand: five neighbouring keys "pressed" together, moving along the keyboard every second
    const hands: RawNote[] = [];
    for (let t = 0; t < 60; t++) for (let k = 0; k < 5; k++) hands.push({ pitch: 48 + (t % 12) + k, on: t + k * 0.01, off: t + 0.9, color: [200, 160, 130] });
    expect(playable(hands)).toBe(false);
  });
});

describe('hands by colour', () => {
  it('one hue in a light and a dark shade is one hand (white and black keys lit differently)', () => {
    const light: [number, number, number] = [181, 255, 72];
    const dark: [number, number, number] = [73, 166, 0];
    const raw: RawNote[] = [60, 61, 62, 63, 64, 66, 48, 49].map((pitch, i) => ({ pitch, on: i, off: i + 0.5, color: [1, 3, 6, 8, 10].includes(pitch % 12) ? dark : light }));
    expect(handsByColor(raw)).toBeNull();
  });

  it('a few grey "presses" (a caption over the keys) do not make a second hand', () => {
    const raw: RawNote[] = [];
    for (let i = 0; i < 60; i++) raw.push({ pitch: 59 + (i % 12), on: i, off: i + 0.5, color: i % 2 ? [181, 255, 72] : [73, 166, 0] });
    for (const pitch of [47, 65, 67, 69, 50, 52]) raw.push({ pitch, on: 0, off: 5, color: [178, 178, 178] });
    expect(handsByColor(raw)).toBeNull();
  });

  it('two hues are two hands, the higher one on the right', () => {
    const raw: RawNote[] = [72, 74, 76, 48, 50, 52].map((pitch, i) => ({ pitch, on: i, off: i + 0.5, color: pitch > 60 ? [126, 226, 132] : [124, 178, 255] }));
    expect(handsByColor(raw)).toEqual(['R', 'R', 'R', 'L', 'L', 'L']);
  });
});

describe('transcription', () => {
  /** Positions of a score's notes in beats from its first bar, with hands. */
  const shape = (s: Score) => s.notes.map((n) => `${n.hand}${n.pitch}@${Math.round(n.t * 24) / 24}`).sort();

  for (const id of ['ode-to-joy', 'twinkle', 'minuet-g', 'jingle-bells']) {
    it(`gives back ${id} note for note, with its hands and bars`, () => {
      const s = libraryScore(id);
      const notes = synthNotes(s, 0.9);
      const tr = transcribe(
        notes.map((n) => ({ pitch: n.pitch, on: n.on, off: n.off, color: n.hand === 'R' ? [126, 226, 132] : [124, 178, 255] })),
      );
      expect(tr.bpm).toBeCloseTo(s.tempo[0].bpm, -1);
      expect(tr.timeSig).toEqual(s.timeSig);
      const back = parseMidi(toMidi(tr, s.title), 'x', 'x.mid');
      const want = shape(s);
      const got = new Set(shape(back));
      const same = want.filter((x) => got.has(x)).length;
      expect(same / want.length, `${id}: ${want.filter((x) => !got.has(x)).slice(0, 8).join(' ')}`).toBeGreaterThanOrEqual(0.97);
      expect(back.measures.length).toBe(s.measures.length);
    });
  }

  it('writes a piece whose beats split in three in compound time (6/8 or 12/8), not as triplets in 4/4', () => {
    // long-short (two eighths and one) three times, then a dotted quarter; an eighth is a third of a second
    const fig: [number, number][] = [[72, 2], [74, 1], [72, 2], [76, 1], [74, 2], [72, 1], [71, 3]];
    const raw: RawNote[] = [];
    for (let bar = 0; bar < 6; bar++) {
      let at = 0;
      for (const [pitch, eighths] of fig) {
        const on = 1 + bar * 4 + at / 3;
        raw.push({ pitch, on, off: on + (eighths / 3) * 0.92, color: [126, 226, 132] });
        at += eighths;
      }
    }
    const tr = transcribe(raw);
    // the figure fills twelve eighths and nothing marks its middle: one bar of 12/8 or two of 6/8
    expect(tr.timeSig[1]).toBe(8);
    expect([6, 12]).toContain(tr.timeSig[0]);
    expect(tr.bpm).toBeCloseTo(90, 0);
    expect(tr.measures).toBe(tr.timeSig[0] === 12 ? 6 : 12);
    // a quarter and an eighth, in quarter notes
    expect(tr.notes.slice(0, 4).map((n) => [n.t, n.dur].map((x) => Math.round(x * 24) / 24))).toEqual([[0, 1], [1, 0.5], [1.5, 1], [2.5, 0.5]]);
  });

  it('keeps the bars with human timing: notes ±20 ms off and the tempo drifting', () => {
    const s = libraryScore('ode-to-joy');
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const notes = synthNotes(s, 0.85).map((n) => {
      const drift = 1 + 0.04 * Math.sin(n.on / 6);
      const on = LEAD + (n.on - LEAD) * drift + rnd() * 0.02;
      return { ...n, on, off: on + (n.off - n.on) };
    });
    const tr = transcribe(notes.map((n) => ({ pitch: n.pitch, on: n.on, off: n.off, color: n.hand === 'R' ? [126, 226, 132] : [124, 178, 255] })));
    const back = parseMidi(toMidi(tr, s.title), 'x', 'x.mid');
    const want = shape(s);
    const got = new Set(shape(back));
    expect(want.filter((x) => got.has(x)).length / want.length).toBeGreaterThanOrEqual(0.9);
  });

  it('half-speed playback gives the real tempo', () => {
    const s = libraryScore('twinkle');
    const notes = synthNotes(s, 0.9).map((n) => ({ pitch: n.pitch, on: n.on * 2, off: n.off * 2, color: [126, 226, 132] as [number, number, number] }));
    const tr = transcribe(notes, { speed: 0.5 });
    expect(tr.bpm).toBeCloseTo(100, -1);
    expect(tr.hands).toBe('none');
  });
});

describe('time signature', () => {
  it('tells 3/4 from 4/4 and finds the first downbeat for most library pieces', () => {
    let meters = 0;
    let downbeats = 0;
    const pieces = PIECES.filter((p) => !['fur-elise-a', 'greensleeves'].includes(p.id)); // 3/8 and an eighth-note pickup do not fit a quarter-beat grid
    for (const { id } of pieces) {
      const s = libraryScore(id);
      const by = new Map<number, OnsetInBeats>();
      for (const n of s.notes) {
        const o = by.get(n.t) ?? { t: n.t, bass: false, size: 0, long: 0 };
        if (n.hand === 'L') o.bass = true;
        o.size++;
        o.long = Math.max(o.long, n.dur);
        by.set(n.t, o);
      }
      const g = guessMeter([...by.values()]);
      const meter = (s.timeSig[0] * 4) / s.timeSig[1];
      const pickup = s.measures[0].beats < meter - 1e-6 ? s.measures[0].beats : 0;
      if (g.meter === meter) meters++;
      if (g.meter === meter && ((g.phase - pickup) % meter) === 0) downbeats++;
    }
    expect(meters).toBe(pieces.length);
    expect(downbeats).toBeGreaterThanOrEqual(pieces.length - 1);
  });
});

describe('YouTube links', () => {
  it('reads the video id from every kind of link', () => {
    for (const link of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2',
      'https://youtu.be/dQw4w9WgXcQ?t=42',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ?start=3',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      'dQw4w9WgXcQ',
    ]) {
      expect(youTubeId(link), link).toBe('dQw4w9WgXcQ');
    }
    expect(youTubeId('https://vimeo.com/123')).toBeNull();
    expect(youTubeId('hello')).toBeNull();
  });

  it('reads the start time', () => {
    expect(youTubeStart('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe(42);
    expect(youTubeStart('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toBe(90);
    expect(youTubeStart('https://www.youtube.com/embed/dQw4w9WgXcQ?start=7')).toBe(7);
    expect(youTubeStart('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(0);
  });
});
