import { describe, expect, it, vi } from 'vitest';
import { Engine, type EngineEvents } from '../src/practice/engine';
import { HOLD_INTO, TOLERANCE, VideoSync, type VideoControl } from '../src/practice/video-sync';
import { parseNotation } from '../src/score/notation';

/**
 * A player as the YouTube one behaves: after play or a seek it stands still
 * for a while (buffering), then runs at its rate; a seek while paused shows
 * the new frame and stays paused.
 */
class FakePlayer implements VideoControl {
  time = 0;
  rate = 1;
  muted = true;
  private wanted = false;
  private holdUntil = 0;
  private now = 0;
  seeks: number[] = [];
  plays = 0;
  pauses = 0;

  constructor(private latency: number) {}

  get running(): boolean {
    return this.wanted && this.now >= this.holdUntil;
  }

  /** The wall clock moves on by `dt` seconds. */
  advance(dt: number): void {
    this.now += dt;
    if (this.running) this.time += dt * this.rate;
  }

  play(): void {
    this.plays++;
    if (!this.wanted) this.holdUntil = this.now + this.latency;
    this.wanted = true;
  }

  pause(): void {
    this.pauses++;
    this.wanted = false;
  }

  seek(t: number): void {
    this.seeks.push(t);
    this.time = t;
    this.holdUntil = this.now + this.latency;
  }

  setSpeed(r: number): void {
    this.rate = r;
  }

  mute(): void {
    this.muted = true;
  }

  unmute(): void {
    this.muted = false;
  }
}

const START = 10; // the second of the video where the piece begins

function setup(mode: 'learn' | 'tempo' | 'listen', speed = 0.5, latency = 0.2) {
  const { score } = parseNotation('time: 4/4\ntempo: 120\nR: C4 D4 E4 F4 | G4 A4 B4 C5 | C5 B4 A4 G4 | F4 E4 D4 C4 |', 'v');
  const ev: EngineEvents = { flash: vi.fn(), ripple: vi.fn(), sound: vi.fn(), wrongNote: vi.fn(), octaveHint: vi.fn(), finished: vi.fn(), change: vi.fn(), tick: vi.fn(), pass: vi.fn() };
  const e = new Engine(score, ev);
  e.loop = false;
  e.countIn = false;
  e.setMode(mode);
  e.speed = speed;
  const player = new FakePlayer(latency);
  const sync = new VideoSync(player, START, score);
  let now = 1000;
  /** one frame: the wall clock, the engine, then the sync, as the practice screen does it */
  const frame = (dt = 1 / 60) => {
    now += dt * 1000;
    player.advance(dt);
    e.step(dt);
    sync.sync(e, now);
  };
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) frame();
  };
  return { e, player, sync, frame, frames, now: () => now };
}

describe('video in step with the bars', () => {
  it('Listen: the video plays along, within the tolerance, and brings the sound', () => {
    const { e, player, sync, frames, frame } = setup('listen');
    e.setPlaying(true);
    frames(60); // the first second: play, seek ahead, the player gets going
    expect(player.plays).toBe(1);
    expect(player.muted).toBe(false);
    expect(player.rate).toBe(0.5);
    let worst = 0;
    for (let i = 0; i < 60 * 12; i++) {
      frame();
      if (player.running) worst = Math.max(worst, Math.abs(player.time - sync.timeAt(e.pos)));
    }
    expect(worst).toBeLessThan(0.2);
    // the lead settled on the player's latency, give or take the frame rate
    expect(sync.lead).toBeGreaterThan(0.1);
    expect(sync.lead).toBeLessThan(0.3);
  });

  it('Listen: a drift is taken up by a nudge of the rate, a big one by a seek', () => {
    const { e, player, sync, frames, frame } = setup('listen');
    e.setPlaying(true);
    frames(60 * 3);
    const seeks = player.seeks.length;
    player.time -= 0.3; // the video fell behind by more than the tolerance
    frames(65);
    expect(player.rate).toBeGreaterThan(0.5); // faster for a while
    expect(player.seeks.length).toBe(seeks);
    frames(60 * 3);
    expect(player.rate).toBe(0.5); // and back in step
    expect(Math.abs(player.time - sync.timeAt(e.pos))).toBeLessThan(TOLERANCE);
    player.time += 2; // a stall or a skip in the video: too far for a nudge
    frames(65);
    expect(player.seeks.length).toBe(seeks + 1);
    frame();
  });

  it('Learn: the video waits on the note with the bars and goes on when the key is played', () => {
    const { e, player, sync, frames } = setup('learn');
    e.setPlaying(true);
    frames(60 * 3); // the lead-in, then the wait on the first note
    expect(e.waiting).toBe(true);
    expect(player.running).toBe(false);
    expect(player.muted).toBe(true);
    // paused on the frame where the first key lights up
    expect(player.time).toBeCloseTo(sync.timeAt(0) + HOLD_INTO, 2);
    const pauses = player.pauses;
    e.press(60); // C4
    frames(30);
    expect(player.running).toBe(true);
    frames(60 * 2); // the next note comes at beat 1: a wait again
    expect(e.waiting).toBe(true);
    expect(player.running).toBe(false);
    expect(player.pauses).toBe(pauses + 1);
    expect(player.time).toBeCloseTo(sync.timeAt(1) + HOLD_INTO, 2);
  });

  it('Learn: a short wait, in rhythm, does not stop the video', () => {
    const { e, player, frames, frame } = setup('learn');
    e.setPlaying(true);
    frames(60 * 3);
    e.press(60);
    const pauses = player.pauses;
    while (!e.waiting) frame(); // on to the next note, at beat 1
    for (let i = 0; i < 5; i++) frame(); // less than the grace: the player plays on
    e.press(62);
    frames(10);
    expect(player.pauses).toBe(pauses);
    expect(player.running).toBe(true);
  });

  it('a click on a bar, or a restart, seeks the video there', () => {
    const { e, player, sync, frames, frame } = setup('listen');
    e.setPlaying(true);
    frames(60 * 2);
    const seeks = player.seeks.length;
    e.setRangeMeasures(3, 4); // bars 3–4: the lead-in starts two beats before beat 8
    e.setPlaying(true);
    frame();
    expect(player.seeks.length).toBe(seeks + 1);
    expect(player.seeks[seeks]).toBeCloseTo(sync.timeAt(6) + sync.lead, 1);
    frames(60);
    e.restart();
    e.setPlaying(true);
    frame();
    expect(player.seeks[player.seeks.length - 1]).toBeCloseTo(sync.timeAt(6) + sync.lead, 1);
  });

  it('In tempo: the video follows the tempo slider within what the player can do', () => {
    const { e, player, frames } = setup('tempo', 1);
    e.setPlaying(true);
    frames(10);
    expect(player.rate).toBe(1);
    e.speed = 0.2;
    frames(10);
    expect(player.rate).toBe(0.25);
    e.speed = 0.65;
    frames(10);
    expect(player.rate).toBe(0.65);
  });

  it('pauses with the Start button and when the page is hidden, and does not start before the video', () => {
    const { e, player, sync, frames, frame } = setup('listen');
    e.setPlaying(true);
    frames(60);
    expect(player.running).toBe(true);
    e.setPlaying(false);
    frame();
    expect(player.running).toBe(false);
    expect(player.time).toBeCloseTo(sync.timeAt(e.pos), 2);
    e.setPlaying(true);
    frames(60);
    sync.hide();
    expect(player.running).toBe(false);
    const plays = player.plays;
    frames(20); // the frames came back: the player is started again
    expect(player.plays).toBe(plays + 1);
    expect(player.running).toBe(true);
    // a piece that begins at the very start of its video: the lead-in waits at frame 0
    const early = setup('listen');
    const esync = new VideoSync(early.player, 0.5, early.e.score);
    early.e.setPlaying(true);
    early.player.advance(1 / 60);
    early.e.step(1 / 60);
    esync.sync(early.e, 1016);
    expect(early.player.plays).toBe(0);
  });
});
