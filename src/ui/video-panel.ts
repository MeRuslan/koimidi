/**
 * The video a piece was recognised from, on the practice screen: YouTube's own
 * player (koimidi keeps only the link) between the strip of bars and the
 * stage, kept in step with the bars by VideoSync. A switch in the rail turns
 * it off and on. Offline, or when the player does not come up, a line says so
 * and the piece works as before.
 */
import type { PieceVideo } from '../app';
import { t } from '../i18n';
import type { Engine } from '../practice/engine';
import { VideoSync, type VideoControl } from '../practice/video-sync';
import type { Score } from '../score/model';
import { YouTubePlayer, YT_STATE, youTubeId, youTubeProblemOf, type YouTubeProblem } from '../video/youtube';
import { $, el } from './dom';

type Why = YouTubeProblem | 'unreachable' | 'offline';
type Status = 'off' | 'loading' | 'ready' | 'failed';

/** The YouTube player as VideoSync drives it. */
function control(yt: YouTubePlayer): VideoControl {
  return {
    get time() {
      return yt.time;
    },
    get running() {
      return yt.state === YT_STATE.PLAYING;
    },
    play: () => yt.play(),
    pause: () => yt.pause(),
    seek: (s) => yt.seek(s),
    setSpeed: (r) => yt.setSpeed(r),
    mute: () => yt.mute(),
    unmute: () => yt.unmute(),
  };
}

export class VideoPanel {
  private root = $('videoPanel');
  private box = $('videoBox');
  private note = $('videoNote');
  private field = $('videoField');
  private toggle = $<HTMLInputElement>('videoOn');
  private piece: PieceVideo | null = null;
  private score: Score | null = null;
  private yt: YouTubePlayer | null = null;
  private sync_: VideoSync | null = null;
  private status: Status = 'off';
  private why: Why = 'unreachable';
  private on = false;
  /** bumped by every load and close: the player of an older one is dropped when it arrives */
  private gen = 0;

  constructor() {
    document.addEventListener('visibilitychange', () => document.hidden && this.sync_?.hide());
    addEventListener('online', () => {
      if (this.on && this.piece && this.status === 'failed' && this.why === 'offline') void this.load();
    });
  }

  /** A piece is open: its video, if it has one, and whether the player is wanted. */
  open(piece: PieceVideo | null, score: Score, on: boolean): void {
    this.close();
    this.piece = piece;
    this.score = score;
    this.on = on;
    this.render();
    if (piece && on) void this.load();
  }

  close(): void {
    this.drop();
    this.piece = null;
    this.score = null;
    this.render();
  }

  /** The switch in the rail. */
  setOn(on: boolean): void {
    this.on = on;
    if (on && this.piece) void this.load();
    else this.drop();
    this.render();
  }

  /** Listen mode plays the sound of the video: the synth keeps quiet then. */
  get sounding(): boolean {
    return this.status === 'ready' && !!this.sync_?.sound;
  }

  /** Every frame: the player where the bars are, playing when they move. */
  sync(e: Engine, now: number): void {
    if (this.status === 'ready') this.sync_?.sync(e, now);
  }

  refreshTexts(): void {
    this.render();
  }

  private drop(): void {
    this.gen++;
    this.yt?.destroy();
    this.yt = null;
    this.sync_ = null;
    this.box.replaceChildren();
    this.status = 'off';
  }

  private async load(): Promise<void> {
    const piece = this.piece;
    const score = this.score;
    if (!piece || !score) return;
    this.drop();
    const gen = this.gen;
    const id = youTubeId(piece.link);
    if (!id) {
      this.fail('missing');
      return;
    }
    if (!navigator.onLine) {
      this.fail('offline');
      return;
    }
    this.status = 'loading';
    this.render();
    const host = el('div');
    this.box.replaceChildren(host);
    try {
      const yt = await YouTubePlayer.create(host, id, Math.max(0, piece.start));
      if (gen !== this.gen) {
        yt.destroy();
        return;
      }
      this.yt = yt;
      yt.onProblem = (p) => gen === this.gen && this.fail(p);
      yt.mute();
      this.sync_ = new VideoSync(control(yt), piece.start, score);
      this.status = 'ready';
      this.render();
    } catch (e) {
      if (gen !== this.gen) return;
      this.fail(youTubeProblemOf(e) ?? 'unreachable');
    }
  }

  private fail(why: Why): void {
    this.yt?.destroy();
    this.yt = null;
    this.sync_ = null;
    this.box.replaceChildren();
    this.status = 'failed';
    this.why = why;
    this.render();
  }

  private render(): void {
    this.field.hidden = !this.piece;
    this.toggle.checked = this.on;
    this.root.hidden = !this.piece || !this.on;
    this.box.hidden = this.status !== 'ready' && this.status !== 'loading';
    const note = this.note;
    if (this.status === 'loading') note.replaceChildren(t('video.loading'));
    else if (this.status === 'failed') {
      const key = this.why === 'missing' ? 'video.yt.missing' : this.why === 'error' ? 'video.yt.error' : (`video.panel.${this.why}` as const);
      note.replaceChildren(t(key));
      if (this.why === 'embed' && this.piece) note.append(' ', el('a', { href: this.piece.link, target: '_blank', rel: 'noopener', text: t('video.yt.openThere') }));
    } else note.replaceChildren();
    note.hidden = !note.childNodes.length;
  }
}
