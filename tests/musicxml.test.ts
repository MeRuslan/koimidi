import { describe, expect, it } from 'vitest';
import { parseMusicXML } from '../src/score/musicxml';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Test Piece</work-title></work>
  <identification><creator type="composer">Someone</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
      </attributes>
      <direction placement="above">
        <direction-type><rehearsal>A</rehearsal></direction-type>
        <sound tempo="90"/>
      </direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff>
        <notations><technical><fingering>3</fingering></technical></notations></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff>
        <tie type="start"/><notations><tied type="start"/></notations></note>
      <note><chord/><pitch><step>B</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>6</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>6</duration><voice>2</voice><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff>
        <tie type="stop"/><notations><tied type="stop"/></notations></note>
      <note><rest/><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>6</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>6</duration><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

describe('musicxml', () => {
  it('reads title, tempo, staves as hands, ties, chords and fingering', () => {
    const s = parseMusicXML(XML, 'x');
    expect(s.title).toBe('Test Piece');
    expect(s.composer).toBe('Someone');
    expect(s.timeSig).toEqual([3, 4]);
    expect(s.tempo[0].bpm).toBe(90);
    expect(s.measures.length).toBe(2);
    expect(s.measures[0].section).toBe('A');
    const R = s.notes.filter((n) => n.hand === 'R');
    const L = s.notes.filter((n) => n.hand === 'L');
    expect(R.map((n) => [n.pitch, n.t, n.dur])).toEqual([
      [72, 0, 1],
      [76, 1, 1],
      [79, 2, 2], // tied across the barline: 1 + 1
      [83, 2, 1],
      [66, 5, 1],
    ]);
    expect(R[0].finger).toBe(3);
    expect(R[0].fingerSource).toBe('file');
    expect(L.map((n) => [n.pitch, n.t, n.dur])).toEqual([
      [48, 0, 3],
      [43, 3, 3],
    ]);
    expect(s.end).toBe(6);
  });

  it('rejects non-MusicXML', () => {
    expect(() => parseMusicXML('<html></html>', 'x')).toThrow();
  });
});

describe('fixtures', () => {
  it('imports .musicxml and .mxl fixtures identically', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseMXL } = await import('../src/score/musicxml');
    const xml = readFileSync(`${process.cwd()}/tests/fixtures/scale-study.musicxml`, 'utf8');
    const mxl = readFileSync(`${process.cwd()}/tests/fixtures/scale-study.mxl`);
    const a = parseMusicXML(xml, 'a', 'scale-study.musicxml');
    const b = parseMXL(new Uint8Array(mxl), 'a', 'scale-study.mxl');
    expect(a.title).toBe('Scale Study');
    expect(a.measures.length).toBe(4);
    expect(a.measures[0].section).toBe('A');
    expect(a.measures[2].section).toBe('B');
    expect(a.tempo[0].bpm).toBe(96);
    expect(a.notes.length).toBe(b.notes.length);
    const tied = a.notes.find((n) => n.pitch === 84);
    expect(tied?.dur).toBe(3);
    expect(a.notes.filter((n) => n.hand === 'L').length).toBe(7);
  });
});
