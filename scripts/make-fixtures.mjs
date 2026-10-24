// Generates small MIDI / MusicXML / MXL fixtures for tests and manual checks.
import { writeFileSync } from 'node:fs';
import midiPkg from '@tonejs/midi';
const { Midi } = midiPkg;
import { zipSync, strToU8 } from 'fflate';

const out = process.argv[2];
const m = new Midi();
m.name = 'Ode to Joy (test)';
m.header.setTempo(112);
m.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
const ppq = m.header.ppq;
const r = m.addTrack(); r.name = 'Right hand';
const mel = [64,64,65,67,67,65,64,62,60,60,62,64,64,62,62];
const durs = [1,1,1,1,1,1,1,1,1,1,1,1,1.5,0.5,2];
let t = 0;
mel.forEach((p, i) => { r.addNote({ midi: p, ticks: Math.round(t * ppq), durationTicks: Math.round(durs[i] * ppq), velocity: 0.8 }); t += durs[i]; });
const l = m.addTrack(); l.name = 'Left hand';
[[48,4],[43,4],[48,4],[43,2],[48,2]].reduce((tt, [p, d]) => { l.addNote({ midi: p, ticks: Math.round(tt * ppq), durationTicks: Math.round(d * ppq), velocity: 0.6 }); return tt + d; }, 0);
writeFileSync(`${out}/ode-two-tracks.mid`, m.toArray());

const note = (step, oct, dur, staff, alter = 0, extra = '') => `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${oct}</octave></pitch><duration>${dur}</duration><voice>${staff}</voice><type>quarter</type><staff>${staff}</staff>${extra}</note>`;
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>Scale Study</work-title></work>
  <identification><creator type="composer">Test Composer</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <direction placement="above"><direction-type><rehearsal>A</rehearsal></direction-type><sound tempo="96"/></direction>
      ${note('C',5,1,1,0,'<notations><technical><fingering>1</fingering></technical></notations>')}${note('D',5,1,1)}${note('E',5,1,1)}${note('F',5,1,1)}
      <backup><duration>4</duration></backup>
      ${note('C',3,2,2)}${note('G',3,2,2)}
    </measure>
    <measure number="2">
      ${note('G',5,1,1)}${note('A',5,1,1)}${note('B',5,1,1)}${note('C',6,1,1,0,'<tie type="start"/><notations><tied type="start"/></notations>')}
      <backup><duration>4</duration></backup>
      ${note('E',3,2,2)}${note('G',3,2,2)}
    </measure>
    <measure number="3">
      <direction placement="above"><direction-type><rehearsal>B</rehearsal></direction-type></direction>
      ${note('C',6,2,1,0,'<tie type="stop"/><notations><tied type="stop"/></notations>')}${note('B',5,1,1,-1)}${note('A',5,1,1)}
      <backup><duration>4</duration></backup>
      ${note('F',3,2,2)}${note('G',3,2,2)}
    </measure>
    <measure number="4">
      ${note('G',5,2,1)}<note><rest/><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      ${note('C',3,4,2)}
    </measure>
  </part>
</score-partwise>`;
writeFileSync(`${out}/scale-study.musicxml`, xml);
const zip = zipSync({
  'META-INF/container.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="scale-study.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'),
  'scale-study.musicxml': strToU8(xml),
});
writeFileSync(`${out}/scale-study.mxl`, zip);
console.log('fixtures written');
