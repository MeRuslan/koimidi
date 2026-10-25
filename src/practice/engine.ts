/**
 * Practice engine: time position, modes, hit detection, waiting, loop range.
 * It knows nothing about the DOM or the canvas; the UI subscribes to events.
 *
 * Position is in beats. In "learn" mode time stops on the next note group until
 * every note in it is played; a note played before its bar reaches the
 * keyboard is accepted at once and the bars catch up smoothly (no jump).
 *
 * In "tempo" mode an optional count-in of one bar precedes the range, and the
 * metronome (tempo and listen modes) clicks on every beat. Clicks are handed
 * to the synth slightly ahead with their exact delay, so they do not jitter
 * with the frame rate.
 *
 * When one hand of a two-hand piece is practised, the trainer can play the
 * other hand. In learn mode its notes wait with the timeline, so a chord that
 * starts together with your note sounds when you play it.
 *
 * Every pass through the range is counted per bar (hits, wrong keys, misses)
 * and reported with `pass` when it ends or is interrupted, with its rhythm:
 * how close the right notes came to their time in tempo mode, or to the gaps
 * between them at your own tempo in learn mode (see rhythm.ts).
 */
import { beatsToSeconds, bpmAt, groupByOnset, type Hand, type NoteGroup, type Score, type ScoreNote } from '../score/model';
import { RhythmTally, type RhythmSummary } from './rhythm';

export type Mode = 'learn' | 'tempo' | 'listen';
export type HandSel = 'R' | 'L' | 'both';
export type FlashKind = 'ok' | 'bad' | 'early';

/** 0 pending, 1 hit, 2 missed */
export type NoteState = 0 | 1 | 2;

export interface EngineEvents {
  flash(pitch: number, kind: FlashKind): void;
  ripple(pitch: number, note: ScoreNote): void;
  /** play a note through the synth (listen mode or sound feedback) */
  sound(pitch: number, velocity: number, seconds: number, note?: ScoreNote): void;
  wrongNote(pressed: number, wanted: ScoreNote[]): void;
  octaveHint(pressed: number, wanted: number): void;
  finished(summary: Summary): void;
  change(): void;
  /** metronome click `delay` seconds from now; `accent` on the first beat of a bar */
  tick(delay: number, accent: boolean): void;
  /** a pass through the range ended (complete) or was cut short */
  pass(stats: PassStats): void;
}

export interface BarTally {
  hits: number;
  wrong: number;
  misses: number;
  /** rhythm: summed scores (0–1) of the notes judged, and how many there were */
  onTime?: number;
  timed?: number;
}

type Count = 'hits' | 'wrong' | 'misses';

/** One pass through the loop range, or the part of it played before stopping. */
export interface PassStats extends BarTally {
  from: number;
  to: number;
  mode: Mode;
  hand: HandSel;
  speed: number;
  /** seconds of practice, long idle waits left out */
  seconds: number;
  /** played to the end of the range */
  complete: boolean;
  /** per bar number */
  bars: Record<number, BarTally>;
  /** tempo mode: played early (-1) or late (1) on the whole */
  lean?: -1 | 1;
  /** learn mode: your own tempo as a share of the piece's */
  pace?: number;
}

interface Click {
  t: number;
  accent: boolean;
}

/** Counts of the pass that just reached the end of the range. */
export interface Summary {
  hits: number;
  wrong: number;
  misses: number;
  mode: Mode;
}

const LEAD = 2; // beats of lead-in before the range starts
const HIT_WIN = 0.45; // beats, "in tempo" mode
const EARLY = 0.6; // beats: when a press starts the lesson, jump this close to the note
const CATCH_UP = 5; // speed multiplier while bars catch up after an early press
const CLICK_AHEAD = 0.12; // seconds: metronome clicks are scheduled this far ahead
const IDLE_MAX = 15; // seconds: waiting longer than this for a key does not count as practice
const ACC_GAIN = 0.75; // the trainer's hand plays a little softer than yours

export class Engine {
  score: Score;
  mode: Mode = 'learn';
  speed = 0.5;
  hand: HandSel = 'R';
  loop = true;
  anyOctave = true;
  /** one bar of clicks before the range in tempo mode */
  countIn = true;
  /** click every beat in tempo and listen modes */
  metronome = false;
  /** play the other hand when one hand of a two-hand piece is practised */
  accompany = true;
  /** a steady clock in seconds, for when keys go down (frames come late or not at all; tests drive their own) */
  now: () => number = () => performance.now() / 1000;

  pos = 0;
  playing = false;
  waiting = false;
  finished = false;
  range: [number, number] = [0, 0];
  rangeMeasures: [number, number] = [1, 1];

  hits = 0;
  wrong = 0;
  misses = 0;

  groups: NoteGroup[] = [];
  state = new Map<ScoreNote, NoteState>();
  next = 0;
  /** keys currently down: pitch → who pressed them (the player, listen mode, the trainer's other hand) */
  keys = new Map<number, 'user' | 'auto' | 'acc'>();
  private catchUpTo = -Infinity;
  private autoTimers: ReturnType<typeof setTimeout>[] = [];
  private clicks: Click[] = [];
  private nextClick = 0;
  private acc: ScoreNote[] = [];
  private nextAcc = 0;
  /** the note that last lit each key automatically (the keyboard takes its finger colour) */
  readonly keyNote = new Map<number, ScoreNote>();
  private cur: PassStats | null = null;
  private idle = 0;
  /** timing of the pass under way, and of everything played since the mode was chosen (the HUD) */
  private timing = new RhythmTally();
  private timingAll = new RhythmTally();
  /** when the position was last moved */
  private stepAt = 0;
  /** learn mode: the last note group played, when and at which beat */
  private lastOnset: { i: number; at: number; t: number } | null = null;

  constructor(score: Score, private ev: EngineEvents) {
    this.score = score;
    this.setHand(this.pickHand());
    this.setRangeMeasures(1, this.lastMeasure());
  }

  /* ---------- configuration ---------- */

  pickHand(): HandSel {
    if (this.score.hands.R && !this.score.hands.L) return 'R';
    if (this.score.hands.L && !this.score.hands.R) return 'L';
    return 'both';
  }

  lastMeasure(): number {
    const ms = this.score.measures;
    return ms.length ? ms[ms.length - 1].number : 1;
  }

  /** Notes selected for practice (by hand). */
  get activeNotes(): ScoreNote[] {
    return this.score.notes.filter((n) => this.hand === 'both' || n.hand === (this.hand as Hand));
  }

  setHand(h: HandSel): void {
    this.endPass(false);
    this.hand = h;
    this.groups = groupByOnset(this.activeNotes);
    this.buildAccompaniment();
    this.restart();
  }

  setMode(m: Mode): void {
    this.endPass(false);
    this.mode = m;
    this.hits = this.wrong = this.misses = 0;
    this.timingAll = new RhythmTally();
    this.restart();
  }

  setRangeMeasures(from: number, to: number): void {
    this.endPass(false);
    const last = this.lastMeasure();
    from = Math.max(1, Math.min(from, last));
    to = Math.max(from, Math.min(to, last));
    this.rangeMeasures = [from, to];
    const ms = this.score.measures;
    const a = ms.find((m) => m.number === from)!;
    const b = ms.find((m) => m.number === to)!;
    this.range = [a.t, to === last ? this.score.end : b.t + b.beats];
    this.restart();
  }

  setMetronome(on: boolean): void {
    this.metronome = on;
    this.buildClicks();
  }

  setCountIn(on: boolean): void {
    this.countIn = on;
    if (this.mode === 'tempo') this.restart();
  }

  setAccompany(on: boolean): void {
    this.accompany = on;
    this.buildAccompaniment();
    this.seekAccompaniment(this.pos);
    for (const [p, src] of [...this.keys]) if (src === 'acc') this.keys.delete(p);
    this.ev.change();
  }

  /* ---------- the other hand ---------- */

  /** Is the trainer playing the other hand right now? */
  get accompanying(): boolean {
    return this.accompany && this.hand !== 'both' && this.score.hands.R && this.score.hands.L;
  }

  /** Notes the trainer plays for the other hand (empty when it does not). */
  get accompaniment(): ScoreNote[] {
    return this.acc;
  }

  private buildAccompaniment(): void {
    this.acc = this.accompanying ? this.score.notes.filter((n) => n.hand !== this.hand).sort((a, b) => a.t - b.t) : [];
  }

  private seekAccompaniment(t: number): void {
    const i = this.acc.findIndex((n) => n.t >= t - 1e-6);
    this.nextAcc = i < 0 ? this.acc.length : i;
  }

  /**
   * Sound the other hand's notes up to beat `until`. The timeline calls it
   * with `inclusive` false while it waits on a note, so the chord that starts
   * with that note holds until the player plays it; then (even ahead of the
   * bars) it is called up to that note, inclusive.
   */
  private playAccompaniment(until: number, inclusive: boolean): void {
    const [start, end] = this.range;
    while (this.nextAcc < this.acc.length) {
      const n = this.acc[this.nextAcc];
      if (n.t >= end - 1e-6) break;
      if (inclusive ? n.t > until + 1e-6 : n.t >= until - 1e-9) break;
      this.nextAcc++;
      if (n.t >= start - 1e-6) this.autoPlay(n, 'acc', ACC_GAIN);
    }
  }

  private autoPlay(n: ScoreNote, src: 'auto' | 'acc', gain = 1): void {
    const secs = (n.dur * 60) / (bpmAt(this.score, n.t) * this.speed);
    this.ev.sound(n.pitch, (n.velocity ?? 0.7) * gain, secs, n);
    this.keys.set(n.pitch, src);
    this.keyNote.set(n.pitch, n);
    // release the key only if this note still holds it (the next note may repeat the same key)
    this.autoTimers.push(setTimeout(() => {
      if (this.keyNote.get(n.pitch) !== n) return;
      this.keyNote.delete(n.pitch);
      if (this.keys.get(n.pitch) === src) this.keys.delete(n.pitch);
    }, Math.max(120, secs * 1000 - 40)));
  }

  /* ---------- pass statistics ---------- */

  private startPass(): void {
    const [from, to] = this.rangeMeasures;
    this.cur = { from, to, mode: this.mode, hand: this.hand, speed: this.speed, hits: 0, wrong: 0, misses: 0, seconds: 0, complete: false, bars: {} };
    this.idle = 0;
    this.timing = new RhythmTally();
    this.lastOnset = null;
  }

  /** Report the pass so far (listen mode and passes without a single note are not practice). */
  private endPass(complete: boolean): void {
    const p = this.cur;
    this.cur = null;
    if (!p || p.mode === 'listen' || p.hits + p.wrong + p.misses === 0) return;
    p.complete = complete;
    p.speed = this.speed;
    this.addRhythm(p);
    this.ev.pass(p);
  }

  /** A copy of the pass in progress, when it has any notes in it. */
  get currentPass(): PassStats | null {
    const p = this.cur;
    if (!p || p.mode === 'listen' || p.hits + p.wrong + p.misses === 0) return null;
    const c = { ...structuredClone(p), speed: this.speed };
    this.addRhythm(c);
    return c;
  }

  /** Rhythm of everything played since the mode was chosen, for the HUD (null until a few notes are timed). */
  get rhythm(): RhythmSummary | null {
    return this.timingAll.summary;
  }

  /** Put the pass's rhythm into its counts, per bar and in all. */
  private addRhythm(p: PassStats): void {
    const r = this.timing.summary;
    if (!r) return;
    p.onTime = r.onTime;
    p.timed = r.timed;
    for (const [k, b] of Object.entries(r.bars)) Object.assign((p.bars[+k] ??= { hits: 0, wrong: 0, misses: 0 }), b);
    if (r.lean) p.lean = r.lean;
    if (r.pace !== null) p.pace = r.pace;
  }

  private tally(measure: number, kind: Count): void {
    const p = this.cur;
    if (!p) return;
    p[kind]++;
    const b = (p.bars[measure] ??= { hits: 0, wrong: 0, misses: 0 });
    b[kind]++;
  }

  /* ---------- beats, count-in, metronome ---------- */

  /** Length of one metronome beat in quarter notes: dotted quarter in 6/8, 9/8, 12/8. */
  beatUnit(): number {
    const [num, den] = this.score.timeSig;
    return den === 8 && num % 3 === 0 && num > 3 ? 1.5 : 4 / den;
  }

  /** One full bar of the piece's time signature, in beats. */
  barBeats(): number {
    const [num, den] = this.score.timeSig;
    return (num * 4) / den;
  }

  private get counting(): boolean {
    return this.mode === 'tempo' && this.countIn;
  }

  /** Beats before the range starts: a bar of count-in, or a short lead-in. */
  leadBeats(): number {
    return this.counting ? this.barBeats() : LEAD;
  }

  /** During the count-in: which beat (1-based) and how far into it, else null. */
  countInBeat(): { beat: number; of: number; frac: number } | null {
    if (!this.counting || !this.playing) return null;
    const start = this.range[0];
    const lead = this.barBeats();
    if (this.pos >= start || this.pos < start - lead) return null;
    const unit = this.beatUnit();
    const x = (this.pos - (start - lead)) / unit;
    return { beat: Math.floor(x + 1e-6) + 1, of: Math.round(lead / unit), frac: x - Math.floor(x + 1e-6) };
  }

  /** Click positions for the current range: count-in, then every beat when the metronome is on. */
  private buildClicks(): void {
    const out: Click[] = [];
    const [start, end] = this.range;
    const unit = this.beatUnit();
    if (this.counting) {
      const n = Math.max(1, Math.round(this.barBeats() / unit));
      for (let k = 0; k < n; k++) out.push({ t: start - this.barBeats() + k * unit, accent: k === 0 });
    }
    if (this.metronome && this.mode !== 'learn') {
      const nominal = this.barBeats();
      this.score.measures.forEach((m, i) => {
        if (m.t + m.beats <= start + 1e-6 || m.t >= end - 1e-6) return;
        const beats: Click[] = [];
        if (i === 0 && m.beats < nominal - 1e-6) {
          // pickup bar: its beats are the last ones of a full bar, no accent
          for (let b = m.t + m.beats - unit; b >= m.t - 1e-6; b -= unit) beats.unshift({ t: b, accent: false });
        } else for (let k = 0; m.t + k * unit < m.t + m.beats - 1e-6; k++) beats.push({ t: m.t + k * unit, accent: k === 0 });
        for (const c of beats) if (c.t >= start - 1e-6 && c.t < end - 1e-6) out.push(c);
      });
    }
    this.clicks = out.sort((a, b) => a.t - b.t);
    this.nextClick = this.clicks.findIndex((c) => c.t >= this.pos - 1e-6);
    if (this.nextClick < 0) this.nextClick = this.clicks.length;
  }

  private scheduleClicks(np: number, beatsPerSec: number): void {
    if (this.mode === 'learn' || beatsPerSec <= 0) return;
    const horizon = np + CLICK_AHEAD * beatsPerSec;
    while (this.nextClick < this.clicks.length && this.clicks[this.nextClick].t <= horizon) {
      const c = this.clicks[this.nextClick++];
      this.ev.tick(Math.max(0, (c.t - np) / beatsPerSec), c.accent);
    }
  }

  /* ---------- transport ---------- */

  restart(keepPlaying = false): void {
    this.endPass(false);
    this.startPass();
    this.clearAuto();
    const [start] = this.range;
    this.pos = start - this.leadBeats();
    this.catchUpTo = -Infinity;
    this.waiting = false;
    this.finished = false;
    this.next = this.firstGroupAtOrAfter(start);
    for (const g of this.groups) if (g.t >= start - 1e-6) for (const n of g.notes) this.state.set(n, 0);
    for (const [p, src] of [...this.keys]) if (src !== 'user') this.keys.delete(p);
    if (!keepPlaying) this.playing = false;
    this.seekAccompaniment(start);
    this.buildClicks();
    this.ev.change();
  }

  /**
   * Carry on from beat `t` inside the range as if the pass had started there
   * (after the notes were edited around it); outside the range, restart.
   */
  seek(t: number): void {
    const [start, end] = this.range;
    if (t < start - this.leadBeats() - 1e-6 || t >= end - 1e-6) {
      this.restart();
      return;
    }
    this.endPass(false);
    this.startPass();
    this.clearAuto();
    this.pos = t;
    this.catchUpTo = -Infinity;
    this.waiting = false;
    this.finished = false;
    this.playing = false;
    for (const [p, src] of [...this.keys]) if (src !== 'user') this.keys.delete(p);
    this.resync();
  }

  /** The score's notes were edited: group them again and stay where the bars are. */
  reload(): void {
    this.groups = groupByOnset(this.activeNotes);
    this.lastOnset = null;
    this.buildAccompaniment();
    this.state.clear();
    this.resync();
  }

  /** Next note, note states, the other hand and the clicks from the current position on. */
  private resync(): void {
    const [start] = this.range;
    const from = Math.max(this.pos, start);
    this.next = this.firstGroupAtOrAfter(from);
    for (const g of this.groups) if (g.t >= start - 1e-6) for (const n of g.notes) this.state.set(n, g.t >= from - 1e-6 ? 0 : 1);
    this.seekAccompaniment(from);
    this.buildClicks();
    this.ev.change();
  }

  setPlaying(on: boolean): void {
    if (on && this.finished) this.restart();
    this.playing = on;
    if (!on) {
      this.clearAuto();
      this.lastOnset = null; // a pause is not a gap between notes
    }
    this.ev.change();
  }

  toggle(): void {
    this.setPlaying(!this.playing);
  }

  private firstGroupAtOrAfter(t: number): number {
    const i = this.groups.findIndex((g) => g.t >= t - 1e-6);
    return i < 0 ? this.groups.length : i;
  }

  /** Current target group (undefined past the end of the range). */
  get target(): NoteGroup | undefined {
    const g = this.groups[this.next];
    if (!g || g.t >= this.range[1] - 1e-6) return undefined;
    return g;
  }

  /** Notes of the target group not yet played. */
  get pendingTarget(): ScoreNote[] {
    const g = this.target;
    return g ? g.notes.filter((n) => this.state.get(n) !== 1) : [];
  }

  noteState(n: ScoreNote): NoteState {
    return this.state.get(n) ?? 0;
  }

  /* ---------- input ---------- */

  press(pitch: number, velocity = 0.8): void {
    this.keys.set(pitch, 'user');
    this.idle = 0;
    if (this.mode === 'listen' || this.finished) return;
    const target = this.target;
    if (!target) return;
    const matchNote = (n: ScoreNote) => n.pitch === pitch || (this.anyOctave && (n.pitch - pitch) % 12 === 0);

    // In learn mode the first correct note starts the lesson.
    if (!this.playing && this.mode === 'learn' && this.pendingTarget.some(matchNote)) {
      this.playing = true;
      this.pos = Math.max(this.pos, target.t - EARLY);
    }
    if (!this.playing) return;

    if (this.mode === 'learn') {
      const pending = this.pendingTarget;
      const hit = pending.find((n) => n.pitch === pitch) ?? pending.find(matchNote);
      if (hit) {
        if (pending.length === target.notes.length) this.onset(target, hit);
        this.accept(hit, pitch);
        if (this.pendingTarget.length === 0) {
          this.waiting = false;
          if (this.pos < target.t) this.catchUpTo = target.t; // bars catch up smoothly
          this.next++;
          this.playAccompaniment(target.t, true); // the other hand plays together with you
        }
      } else this.reject(pitch, pending);
    } else {
      // in tempo: look for a pending note within the hit window around now, which is a little past
      // the last step (no further than a step goes)
      const late = Math.min(0.1, Math.max(0, this.now() - this.stepAt));
      const now = this.pos + (late * bpmAt(this.score, Math.max(0, this.pos)) * this.speed) / 60;
      const candidates: ScoreNote[] = [];
      for (let i = this.next; i < this.groups.length; i++) {
        const g = this.groups[i];
        if (g.t - now > HIT_WIN) break;
        if (g.t >= this.range[1] - 1e-6) break;
        for (const n of g.notes) if (this.state.get(n) === 0 && Math.abs(n.t - now) <= HIT_WIN) candidates.push(n);
      }
      const hit = candidates.find((n) => n.pitch === pitch) ?? candidates.find(matchNote);
      if (hit) {
        const beat = 60 / (bpmAt(this.score, hit.t) * this.speed);
        for (const r of [this.timing, this.timingAll]) r.hit(hit.measure, (now - hit.t) * beat, beat);
        this.accept(hit, pitch);
        this.advancePastResolved();
      } else if (candidates.length) this.reject(pitch, candidates);
      else this.ev.flash(pitch, 'early');
    }
    this.ev.change();
  }

  release(pitch: number): void {
    if (this.keys.get(pitch) === 'user') this.keys.delete(pitch);
  }

  private accept(n: ScoreNote, pitch: number): void {
    this.state.set(n, 1);
    this.hits++;
    this.tally(n.measure, 'hits');
    this.ev.flash(pitch, 'ok');
    this.ev.ripple(pitch, n);
    if (n.pitch !== pitch) this.ev.octaveHint(pitch, n.pitch);
  }

  /** Learn mode: the first note of the target group was played; time the gap from the group before. */
  private onset(g: NoteGroup, n: ScoreNote): void {
    const at = this.now();
    const prev = this.lastOnset;
    if (prev && prev.i === this.next - 1 && at - prev.at <= IDLE_MAX) {
      const due = beatsToSeconds(this.score, g.t) - beatsToSeconds(this.score, prev.t);
      for (const r of [this.timing, this.timingAll]) r.gap(n.measure, due, at - prev.at);
    }
    this.lastOnset = { i: this.next, at, t: g.t };
  }

  private reject(pitch: number, wanted: ScoreNote[]): void {
    this.wrong++;
    this.tally(wanted[0].measure, 'wrong');
    this.ev.flash(pitch, 'bad');
    const sameClass = wanted.find((n) => (n.pitch - pitch) % 12 === 0);
    if (sameClass && !this.anyOctave) this.ev.octaveHint(pitch, sameClass.pitch);
    else this.ev.wrongNote(pitch, wanted);
  }

  private advancePastResolved(): void {
    while (this.next < this.groups.length && this.groups[this.next].notes.every((n) => this.state.get(n) !== 0)) this.next++;
  }

  /* ---------- time ---------- */

  step(dt: number): void {
    this.stepAt = this.now();
    if (!this.playing) return;
    if (this.cur) {
      this.idle = this.waiting ? this.idle + dt : 0;
      if (this.idle <= IDLE_MAX) this.cur.seconds += dt;
    }
    const bps = bpmAt(this.score, Math.max(0, this.pos)) / 60;
    let adv = dt * bps * this.speed;
    if (this.pos < this.catchUpTo) {
      adv = Math.min(dt * bps * this.speed * CATCH_UP, 0.4);
      if (this.pos + adv >= this.catchUpTo) {
        adv = this.catchUpTo - this.pos;
        this.catchUpTo = -Infinity;
      }
    } else this.catchUpTo = -Infinity;
    let np = this.pos + adv;
    const [, end] = this.range;

    if (this.mode === 'learn') {
      const target = this.target;
      if (target && np >= target.t) {
        np = target.t;
        this.waiting = true;
      } else this.waiting = false;
    } else if (this.mode === 'tempo') {
      for (let i = this.next; i < this.groups.length; i++) {
        const g = this.groups[i];
        if (g.t >= end - 1e-6 || np <= g.t + HIT_WIN) break;
        for (const n of g.notes) {
          if (this.state.get(n) === 0) {
            this.state.set(n, 2);
            this.misses++;
            this.tally(n.measure, 'misses');
          }
        }
      }
      this.advancePastResolved();
    } else {
      while (this.next < this.groups.length && this.groups[this.next].t < end - 1e-6 && np >= this.groups[this.next].t) {
        const g = this.groups[this.next++];
        for (const n of g.notes) {
          this.state.set(n, 1);
          this.autoPlay(n, 'auto');
          this.ev.ripple(n.pitch, n);
        }
      }
    }
    this.playAccompaniment(np, !this.waiting);
    this.scheduleClicks(np, bps * this.speed);
    this.pos = np;

    if (this.pos >= end) {
      if (this.loop) {
        this.endPass(true);
        this.restart(true);
        return;
      }
      // let the last bars sink before stopping
      if (this.pos >= end + LEAD * 0.75) {
        const pass = this.cur ?? { hits: 0, wrong: 0, misses: 0 };
        this.endPass(true);
        this.finished = true;
        this.playing = false;
        this.clearAuto();
        this.ev.finished({ hits: pass.hits, wrong: pass.wrong, misses: pass.misses, mode: this.mode });
      }
    }
    this.ev.change();
  }

  private clearAuto(): void {
    for (const t of this.autoTimers) clearTimeout(t);
    this.autoTimers = [];
  }

  dispose(): void {
    this.endPass(false);
    this.clearAuto();
  }
}
