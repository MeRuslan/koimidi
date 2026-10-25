/**
 * Keeps a video player where the bars are. The engine is the clock; the
 * player follows: it plays while the bars move, pauses while they wait for a
 * key (Learn mode) or stand still, jumps with a restart or a click on a bar,
 * and slows down with the tempo. A player starts late by a fraction of a
 * second after every seek, so seeks aim a little ahead by an amount that is
 * learnt as it goes; a small drift is taken up by nudging the rate for a
 * second, a large one by a seek. In Listen mode the sound is the video's.
 */
import type { Score } from '../score/model';
import { videoRate, videoTime } from '../video/clock';
import type { Engine } from './engine';

/** What the sync needs of a player (the YouTube player on the practice screen, a fake in the tests). */
export interface VideoControl {
  /** seconds into the video */
  readonly time: number;
  /** the picture is moving (not paused, not buffering, not seeking) */
  readonly running: boolean;
  play(): void;
  pause(): void;
  seek(t: number): void;
  setSpeed(r: number): void;
  mute(): void;
  unmute(): void;
}

/** seconds: further off than this while playing, the rate is nudged */
export const TOLERANCE = 0.15;
/** seconds: further off than this, the video is put right with a seek */
const RESYNC = 0.6;
/** seconds: a change of the position not explained by time passing (a restart, a click on a bar) */
const JUMP = 0.3;
/** how often the player's time is read against the bars */
const CHECK_MS = 1000;
/** after a seek or play the player's time says nothing yet */
const SETTLE_MS = 700;
/** Learn mode: a wait for a key shorter than this, in rhythm, does not stop the video */
const GRACE_MS = 150;
/** Learn mode: while the bars wait on a note, the video stands this far into it, so the lit key shows */
export const HOLD_INTO = 0.08;
/** the rate is nudged by at most this share to take up a drift */
const NUDGE = 0.25;

export class VideoSync {
  /** the player as the trainer last set it */
  playing = false;
  sound = false;
  rate = 0;
  /** seconds a seek aims ahead of the bars, for the time the player takes to get going */
  lead = 0.15;
  private started = false;
  private nudge = 0;
  private lastWant = NaN;
  private lastAt = 0;
  private lastMoving = false;
  private lastCheck = 0;
  private settleUntil = 0;
  private drifts: number[] = [];
  private leadPending = false;
  private waitSince = 0;

  constructor(
    private player: VideoControl,
    /** the second of the video where the piece's beat 0 is */
    private start: number,
    private score: Score,
  ) {}

  /** The second of the video for a position in the piece. */
  timeAt(beats: number): number {
    return videoTime(this.start, this.score, beats);
  }

  /** The page went out of sight: no frames come, so the video must not run on alone. */
  hide(): void {
    if (!this.playing) return;
    this.player.pause();
    this.playing = false;
  }

  /** Every frame (`now` in milliseconds, as the frame clock gives it). */
  sync(e: Engine, now: number): void {
    const p = this.player;
    const want = this.timeAt(e.pos);
    const moving = e.playing && !e.waiting;
    let shouldPlay = moving && want >= 0;
    if (e.playing && e.waiting) {
      if (!this.waitSince) this.waitSince = now;
      if (this.playing && now - this.waitSince < GRACE_MS) shouldPlay = true;
    } else this.waitSince = 0;

    const sound = e.mode === 'listen';
    if (sound !== this.sound) {
      if (sound) p.unmute();
      else p.mute();
      this.sound = sound;
    }

    // the position moved otherwise than by time passing at the trainer's speed: follow it
    const dt = (now - this.lastAt) / 1000;
    const predicted = Number.isNaN(this.lastWant) ? want : this.lastWant + (this.lastMoving ? dt * e.speed : 0);
    const jumped = Math.abs(want - predicted) > JUMP;
    this.lastWant = want;
    this.lastAt = now;
    this.lastMoving = moving;

    if (shouldPlay !== this.playing) {
      this.playing = shouldPlay;
      this.nudge = 0;
      this.setRate(e.speed);
      if (shouldPlay) {
        this.seek(want + this.lead, now);
        p.play();
        this.started = true;
      } else {
        p.pause();
        // paused on a note the player is to play: the frame where its key lights up
        if (this.started) this.seek(want + (e.waiting ? HOLD_INTO : 0), now);
      }
      return;
    }
    if (jumped) {
      this.nudge = 0;
      this.setRate(e.speed);
      if (shouldPlay) this.seek(want + this.lead, now);
      else if (this.started) this.seek(want + (e.waiting ? HOLD_INTO : 0), now);
      return;
    }
    if (!shouldPlay) return;
    this.setRate(e.speed);
    if (now < this.settleUntil || !p.running) return;
    this.drifts.push(p.time - want);
    if (now - this.lastCheck < CHECK_MS) return;
    this.lastCheck = now;
    const drift = this.drifts.reduce((a, b) => a + b, 0) / this.drifts.length;
    this.drifts = [];
    if (this.leadPending) {
      // the seek landed this far from where it aimed: aim further next time
      this.lead = Math.max(0, Math.min(0.6, this.lead - drift));
      this.leadPending = false;
    }
    if (Math.abs(drift) > RESYNC) {
      this.nudge = 0;
      this.seek(want + this.lead, now);
    } else {
      // a little behind: a little faster for the next second; a little ahead: a little slower
      this.nudge = Math.abs(drift) > TOLERANCE ? Math.max(-NUDGE, Math.min(NUDGE, -drift)) : 0;
      this.setRate(e.speed);
    }
  }

  private setRate(speed: number): void {
    const rate = Math.round(videoRate(speed * (1 + this.nudge)) * 100) / 100;
    if (rate === this.rate) return;
    this.rate = rate;
    this.player.setSpeed(rate);
  }

  private seek(to: number, now: number): void {
    this.player.seek(Math.max(0, to));
    this.settleUntil = now + SETTLE_MS;
    this.lastCheck = now;
    this.drifts = [];
    this.leadPending = this.playing;
  }
}
