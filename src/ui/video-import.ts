/**
 * "From a video" screen: a YouTube link, another tab or a video file in, a
 * piece in "Your files" out. koimidi plays the video, finds the keyboard in
 * it, notes down every key that lights up, and turns that into bars.
 * Everything runs on this device.
 */
import type { App } from '../app';
import { barsLabel, keysLabel, noteName, notesLabel, t } from '../i18n';
import { AudioTake, decodeAudio, listen } from '../video/audio';
import { canCapture, captureOther, captureThisTab, StreamGrabber, VideoGrabber, type Grabbed, type Grabber } from '../video/capture';
import { KeyboardFinder } from '../video/finder';
import type { Frame } from '../video/frame';
import { sameKeyboard, type KeyboardLayout } from '../video/keyboard';
import { KeyTracker, playable, type RawNote } from '../video/tracker';
import { octaveHint, toMidi, transcribe, type Transcribed } from '../video/transcribe';
import { fitOffset, type ClockSample } from '../video/clock';
import { YouTubePlayer, YT_STATE, youTubeId, youTubeProblemOf, youTubeStart, type YouTubeProblem } from '../video/youtube';
import { onThemeChange, palette } from '../theme';
import { $, el, formatDuration } from './dom';

type Kind = 'youtube' | 'file' | 'tab';
/** idle → ready → finding → recording → done; or, without a keyboard, ready → listening → thinking → done */
type Phase = 'idle' | 'ready' | 'finding' | 'recording' | 'listening' | 'thinking' | 'done';
type Meter = 'auto' | '4/4' | '3/4' | '2/4' | '12/8' | '9/8' | '6/8';

/** Playback the recognition can steer: the YouTube player or a file. */
interface Control {
  time(): number;
  duration(): number;
  play(): void;
  pause(): void;
  seek(t: number): void;
  setSpeed(r: number): void;
  ended(): boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class VideoImportView {
  private kind: Kind | null = null;
  private phase: Phase = 'idle';
  private yt: YouTubePlayer | null = null;
  private video: HTMLVideoElement | null = null;
  private fileUrl = '';
  private file: File | null = null;
  /** No lit keyboard was found: offer to listen instead. */
  private noKeyboard = false;
  private take: AudioTake | null = null;
  private takeStream: MediaStream | null = null;
  /** The result was heard, not seen: a draft. */
  private fromAudio = false;
  private link = '';
  private linkStart = 0;
  private grabber: Grabber | null = null;
  private tracker: KeyTracker | null = null;
  private layout: KeyboardLayout | null = null;
  private calib: Grabbed | null = null;
  private foundAt = 0;
  private raw: RawNote[] = [];
  private result: Transcribed | null = null;
  private meter: Meter = 'auto';
  private shift = 0;
  private octave = 0;
  private speed = 1;
  private title = '';
  /** Bumped by every reset: async work of an older run sees it and stops. */
  private gen = 0;
  private live: ReturnType<typeof setInterval> | undefined;
  private lastBand: { frame: Frame; top: number } | null = null;
  private lastT = 0;
  /** Clock time recording started at (for a tab, which has no duration). */
  private recStart = NaN;
  private frozenSince: number | null = null;
  private frozenTotal = 0;
  private preview: ReturnType<typeof setTimeout>[] = [];
  /** The file was paused because the tab was hidden. */
  private heldHidden = false;
  /** Moments seen on both the capture clock and the YouTube player's, so the piece can be placed in the video. */
  private clock: ClockSample[] = [];
  private scratch = document.createElement('canvas');

  constructor(private app: App) {
    $('vBack').addEventListener('click', () => this.close());
    $<HTMLFormElement>('viLinkForm').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.openLink($<HTMLInputElement>('viLink').value);
    });
    $('viTab').addEventListener('click', () => this.pickTab());
    const input = $<HTMLInputElement>('viFileInput');
    $('viFile').addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = '';
      if (f) void this.openFile(f);
    });
    $('viStart').addEventListener('click', () => this.start());
    $('viStop').addEventListener('click', () => (this.phase === 'listening' ? void this.stopListening() : this.finish()));
    $('viAudio').addEventListener('click', () => this.listenInstead());
    $('viAnother').addEventListener('click', () => this.toSource());
    $<HTMLSelectElement>('viSpeed').addEventListener('change', (e) => (this.speed = +(e.target as HTMLSelectElement).value));
    $<HTMLSelectElement>('viMeter').addEventListener('change', (e) => {
      this.meter = (e.target as HTMLSelectElement).value as Meter;
      this.shift = 0;
      this.arrange();
    });
    $('viEarlier').addEventListener('click', () => this.nudge(-1));
    $('viLater').addEventListener('click', () => this.nudge(1));
    $('viOctDown').addEventListener('click', () => this.setOctave(this.octave - 1));
    $('viOctUp').addEventListener('click', () => this.setOctave(this.octave + 1));
    $('viListen').addEventListener('click', () => this.togglePreview());
    $('viOpen').addEventListener('click', () => void this.openPiece());
    $('viAgain').addEventListener('click', () => this.again());
    addEventListener('resize', () => {
      if (!$('viResult').hidden) this.drawRoll();
    });
    onThemeChange(() => {
      if (!$('viResult').hidden) this.drawRoll();
    });
    // a hidden tab gets no frames of a playing file: hold the file until the tab is back
    document.addEventListener('visibilitychange', () => {
      if (this.kind !== 'file' || !this.video || (this.phase !== 'finding' && this.phase !== 'recording')) return;
      if (document.hidden) {
        this.heldHidden = !this.video.paused;
        this.video.pause();
      } else if (this.heldHidden) {
        this.heldHidden = false;
        void this.video.play();
      }
    });
  }

  /* ---------- screens ---------- */

  open(): void {
    this.app.home.hide();
    $('home').hidden = true;
    $('vimport').hidden = false;
    this.toSource();
    $<HTMLInputElement>('viLink').focus();
  }

  close(): void {
    this.reset();
    $('vimport').hidden = true;
    this.app.showHome();
  }

  private toSource(): void {
    this.reset();
    this.show('source');
  }

  private show(step: 'source' | 'work' | 'result'): void {
    $('viSource').hidden = step !== 'source';
    $('viWork').hidden = step !== 'work';
    $('viResult').hidden = step !== 'result';
  }

  private status(text: string, kind: '' | 'ok' | 'warn' = ''): void {
    const s = $('viStatus');
    s.textContent = text;
    s.className = `vi-status ${kind}`;
  }

  /** Buttons for the current phase. */
  private buttons(): void {
    const p = this.phase;
    const start = $<HTMLButtonElement>('viStart');
    start.hidden = !(p === 'ready' || (p === 'finding' && this.kind === 'tab'));
    start.disabled = this.kind === 'tab' && !this.layout;
    start.textContent = this.kind === 'tab' ? t('video.record') : t('video.start');
    $('viSpeedRow').hidden = !(p === 'ready' && this.kind !== 'tab');
    $('viStop').hidden = p !== 'recording' && p !== 'listening';
    $('viAudio').hidden = !(this.noKeyboard && (p === 'ready' || (p === 'finding' && this.kind === 'tab' && !this.layout)));
    $('viSeen').hidden = !(this.layout && (p === 'recording' || p === 'finding'));
    $('viProgressRow').hidden = !((p === 'recording' || p === 'listening') && this.kind !== 'tab');
  }

  /** Stop everything this screen started. */
  private reset(): void {
    this.gen++;
    this.stopPreview();
    clearInterval(this.live);
    this.grabber?.stop();
    this.grabber = null;
    this.tracker = null;
    this.layout = null;
    this.calib = null;
    this.lastBand = null;
    this.yt?.destroy();
    this.yt = null;
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.srcObject = null;
      this.video = null;
    }
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = '';
    $('viPlayer').replaceChildren();
    void this.take?.stop();
    this.take = null;
    for (const tr of this.takeStream?.getTracks() ?? []) tr.stop();
    this.takeStream = null;
    this.file = null;
    this.noKeyboard = false;
    this.fromAudio = false;
    this.kind = null;
    this.phase = 'idle';
    this.raw = [];
    this.result = null;
    this.meter = 'auto';
    this.shift = 0;
    this.octave = 0;
    this.frozenSince = null;
    this.frozenTotal = 0;
    this.clock = [];
    this.status('');
    this.buttons();
  }

  /* ---------- sources ---------- */

  async openLink(text: string): Promise<void> {
    const id = youTubeId(text);
    if (!id) {
      $('viLinkNote').textContent = t('video.link.bad');
      return;
    }
    $('viLinkNote').textContent = '';
    this.reset();
    this.kind = 'youtube';
    this.link = `https://www.youtube.com/watch?v=${id}`;
    this.linkStart = youTubeStart(text);
    this.show('work');
    this.status(t('video.loading'));
    const host = el('div');
    $('viPlayer').replaceChildren(host);
    const gen = this.gen;
    try {
      const yt = await YouTubePlayer.create(host, id, this.linkStart);
      if (gen !== this.gen) {
        yt.destroy();
        return;
      }
      this.yt = yt;
      yt.onProblem = (p) => this.problem(p);
      yt.onState = (s) => this.onYtState(s);
      this.title = yt.title;
      this.ready(t('video.ready'));
    } catch (e) {
      if (gen !== this.gen) return;
      this.problem(youTubeProblemOf(e) ?? 'unreachable');
    }
  }

  async openFile(file: File): Promise<void> {
    this.reset();
    this.kind = 'file';
    this.file = file;
    this.title = file.name.replace(/\.[^.]+$/, '');
    this.show('work');
    const v = el('video', { class: 'vi-video', playsinline: true, preload: 'auto' });
    this.fileUrl = URL.createObjectURL(file);
    v.src = this.fileUrl;
    $('viPlayer').replaceChildren(v);
    this.video = v;
    const gen = this.gen;
    const ok = await new Promise<boolean>((resolve) => {
      v.addEventListener('loadeddata', () => resolve(true), { once: true });
      v.addEventListener('error', () => resolve(false), { once: true });
    });
    if (gen !== this.gen) return;
    if (!ok) {
      this.status(t('video.file.bad'), 'warn');
      return;
    }
    v.addEventListener('ended', () => this.phase === 'recording' && this.finish());
    this.ready(t('video.readyFile'));
  }

  /** Another tab or window: the user picks it, plays the video there, and koimidi watches. */
  pickTab(): void {
    if (!canCapture()) {
      this.show('work');
      this.status(t('video.noCapture'), 'warn');
      return;
    }
    this.reset();
    const asked = captureOther();
    const gen = this.gen;
    void asked.then(
      (stream) => {
        if (gen !== this.gen) {
          for (const tr of stream.getTracks()) tr.stop();
          return;
        }
        this.kind = 'tab';
        this.title = '';
        this.show('work');
        const v = el('video', { class: 'vi-video', playsinline: true });
        v.muted = true;
        v.srcObject = stream;
        void v.play();
        $('viPlayer').replaceChildren(v);
        this.video = v;
        this.grabber = new StreamGrabber(stream);
        stream.getVideoTracks()[0].addEventListener('ended', () => {
          if (gen !== this.gen) return;
          if (this.phase === 'recording') this.finish();
          else this.toSource();
        });
        this.phase = 'finding';
        this.buttons();
        void this.watchTab(gen);
      },
      () => {
        if (gen !== this.gen) return;
        this.show('source');
      },
    );
  }

  private ready(text: string): void {
    this.phase = 'ready';
    this.status(text);
    this.buttons();
  }

  private problem(p: YouTubeProblem | 'unreachable'): void {
    this.phase = 'idle';
    this.status(t(`video.yt.${p}` as 'video.yt.error'), 'warn');
    this.buttons();
    if (p === 'embed' && this.link) {
      const a = el('a', { href: this.link, target: '_blank', rel: 'noopener', text: t('video.yt.openThere') });
      $('viStatus').append(' ', a);
    }
  }

  private control(): Control | null {
    const yt = this.yt;
    if (yt) {
      return {
        time: () => yt.time,
        duration: () => yt.duration,
        play: () => yt.play(),
        pause: () => yt.pause(),
        seek: (s) => yt.seek(s),
        setSpeed: (r) => yt.setSpeed(r),
        ended: () => yt.state === YT_STATE.ENDED,
      };
    }
    const v = this.video;
    if (v && this.kind === 'file') {
      return {
        time: () => v.currentTime,
        duration: () => v.duration || 0,
        play: () => void v.play(),
        pause: () => v.pause(),
        seek: (s) => (v.currentTime = s),
        setSpeed: (r) => (v.playbackRate = r),
        ended: () => v.ended,
      };
    }
    return null;
  }

  /* ---------- recognition ---------- */

  /** The Recognise / Start recording button. */
  private start(): void {
    if (this.kind === 'tab') {
      if (this.layout && this.tracker) this.record();
      return;
    }
    const ctl = this.control();
    if (!ctl) return;
    if (this.kind === 'youtube') {
      if (!canCapture()) {
        this.status(t('video.noCapture'), 'warn');
        return;
      }
      // straight from the click: the browser asks to share this tab
      const asked = captureThisTab(this.yt!.iframe);
      const gen = this.gen;
      this.phase = 'finding';
      this.buttons();
      this.status(t('video.asking'));
      void asked.then(
        ({ stream, crop }) => {
          if (gen !== this.gen) {
            for (const tr of stream.getTracks()) tr.stop();
            return;
          }
          const g = new StreamGrabber(stream);
          g.crop = crop;
          this.grabber = g;
          stream.getVideoTracks()[0].addEventListener('ended', () => gen === this.gen && this.phase === 'recording' && this.finish());
          void this.findAndRecord(ctl, gen);
        },
        () => {
          if (gen !== this.gen) return;
          this.ready(t('video.denied'));
          $('viStatus').className = 'vi-status warn';
        },
      );
      return;
    }
    this.grabber = new VideoGrabber(this.video!);
    this.phase = 'finding';
    this.buttons();
    void this.findAndRecord(ctl, this.gen);
  }

  /**
   * Find the keyboard: watch the first seconds, then look in at a few places
   * further on (a long intro). The finder settles on a keyboard seen three
   * times; where two show, on the one whose keys light up.
   */
  private async findAndRecord(ctl: Control, gen: number): Promise<void> {
    this.status(t('video.finding'));
    ctl.setSpeed(1);
    const d = ctl.duration();
    const probes = [this.linkStart];
    if (d - this.linkStart > 30) probes.push(...[0.15, 0.35, 0.55, 0.75].map((f) => this.linkStart + (d - this.linkStart) * f));
    const finder = new KeyboardFinder();
    let foundAtProbe = -1;
    const take = (found: { layout: KeyboardLayout; calib: Frame; t: number } | null, i: number) => {
      if (!found) return false;
      this.layout = found.layout;
      this.calib = { frame: found.calib, t: found.t };
      this.foundAt = ctl.time();
      foundAtProbe = i;
      return true;
    };
    for (let i = 0; i < probes.length && foundAtProbe < 0; i++) {
      ctl.seek(probes[i]);
      this.play(ctl);
      // the first look lasts a few seconds of video (longer while two keyboards are in sight and
      // neither has lit up yet); the others just long enough for a few frames
      const span = () => (i === 0 ? (finder.rivalry ? 14 : 6) : 1.5);
      const wallLimit = performance.now() + (i === 0 ? 30000 : 8000);
      if (i > 0) await sleep(500);
      while (gen === this.gen && performance.now() < wallLimit) {
        const g = await Promise.race([this.grabber!.next(), sleep(2000).then(() => null)]);
        if (gen !== this.gen) return;
        if (g && take(finder.offer(g.frame, g.t), i)) break;
        if (ctl.ended() || ctl.time() > probes[i] + span() || (d && ctl.time() > d - 0.5)) break;
        await sleep(200);
      }
      if (foundAtProbe < 0) take(finder.settle(), i);
    }
    if (gen !== this.gen) return;
    if (foundAtProbe < 0) {
      ctl.pause();
      this.phase = 'ready';
      this.noKeyboard = true;
      this.status(`${t('video.noKeyboard')} ${t('video.audio.hint')}`, 'warn');
      this.grabber?.stop();
      this.grabber = null;
      this.buttons();
      return;
    }
    if (gen !== this.gen || !this.layout || !this.calib) return;
    // back to a little before the keyboard appeared (or to the start, if it was found further on),
    // at the chosen speed, with the video loaded ahead; frames before the keyboard are skipped by the tracker
    ctl.pause();
    ctl.seek(foundAtProbe === 0 ? Math.max(this.linkStart, this.foundAt - 3) : this.linkStart);
    ctl.setSpeed(this.speed);
    this.status(t('video.buffering'));
    if (this.yt) {
      const until = performance.now() + 8000;
      const need = Math.min(1, (ctl.time() + 40) / Math.max(1, ctl.duration()));
      while (gen === this.gen && performance.now() < until && this.yt.loaded < need) await sleep(250);
    } else await sleep(300);
    if (gen !== this.gen) return;
    this.tracker = new KeyTracker(this.layout, this.calib.frame);
    this.play(ctl);
    // frames still showing the moment before the seek must not reach the tracker
    await sleep(400);
    if (gen !== this.gen) return;
    this.record();
  }

  /** Play, unless this is a file and the tab is hidden: then it plays when the tab is back. */
  private play(ctl: Control): void {
    if (this.kind === 'file' && document.hidden) this.heldHidden = true;
    else ctl.play();
  }

  /** Tab: look at the shared tab until the keyboard is there. */
  private async watchTab(gen: number): Promise<void> {
    this.status(t('video.tab.waiting'));
    const finder = new KeyboardFinder();
    const since = performance.now();
    while (gen === this.gen && this.phase === 'finding') {
      const g = await Promise.race([this.grabber!.next(), sleep(1500).then(() => null)]);
      if (gen !== this.gen || this.phase !== 'finding') return;
      const found = g ? finder.offer(g.frame, g.t) : null;
      if (found) {
        // a better reference frame may still turn up while the user has not pressed Record
        if (!this.layout || !sameKeyboard(this.layout, found.layout) || this.calib?.frame !== found.calib) {
          this.layout = found.layout;
          this.calib = { frame: found.calib, t: found.t };
          this.tracker = new KeyTracker(found.layout, found.calib);
          this.grabber!.band = this.tracker.band;
          this.grabber!.onFrame = (band, _t, top) => (this.lastBand = { frame: band, top });
          this.status(t('video.tab.ready', { keys: keysLabel(found.layout.keys.length) }), 'ok');
          this.buttons();
          this.startLive();
        }
      } else if (!this.layout) {
        if (!this.noKeyboard && performance.now() - since > 8000) {
          this.noKeyboard = true;
          this.buttons();
        }
        this.status(this.noKeyboard ? `${t('video.tab.waiting')} ${t('video.audio.hint')}` : t('video.tab.waiting'));
      }
      await sleep(400);
    }
  }

  private record(): void {
    const g = this.grabber;
    const tracker = this.tracker;
    if (!g || !tracker) return;
    this.phase = 'recording';
    g.locked = true;
    g.band = tracker.band;
    this.frozenSince = null;
    this.frozenTotal = 0;
    this.recStart = NaN;
    this.clock = [];
    g.onFrame = (band, t, top) => {
      if (Number.isNaN(this.recStart)) this.recStart = t;
      this.lastBand = { frame: band, top };
      this.lastT = t;
      // YouTube buffering or paused: the picture stands still while the clock runs on
      if (this.frozenSince !== null) return;
      tracker.push(band, t - this.frozenTotal, top);
    };
    this.buttons();
    this.startLive();
  }

  private onYtState(s: number): void {
    if (this.phase === 'listening' && s === YT_STATE.ENDED) void this.stopListening();
    if (this.phase !== 'recording') return;
    if (s === YT_STATE.ENDED) this.finish();
    else if (s === YT_STATE.PLAYING) {
      if (this.frozenSince !== null) this.frozenTotal += this.lastT - this.frozenSince;
      this.frozenSince = null;
    } else if (this.frozenSince === null) this.frozenSince = this.lastT;
  }

  /** The keyboard as koimidi sees it, with a ring on every lit key, and the count so far. */
  private startLive(): void {
    clearInterval(this.live);
    this.live = setInterval(() => {
      this.drawSeen();
      this.sampleClock();
      const ctl = this.control();
      if (this.phase === 'listening') {
        const time = ctl ? `${formatDuration(ctl.time())} / ${formatDuration(ctl.duration())}` : formatDuration(this.take?.seconds ?? 0);
        this.status(t('video.audio.recording', { time }));
        if (ctl && ctl.duration()) ($('viProgress') as HTMLElement).style.width = `${Math.min(100, (100 * ctl.time()) / ctl.duration())}%`;
        return;
      }
      if (this.phase !== 'recording') return;
      const n = this.tracker?.count ?? 0;
      const time = ctl ? `${formatDuration(ctl.time())} / ${formatDuration(ctl.duration())}` : formatDuration(Number.isNaN(this.recStart) ? 0 : Math.max(0, this.lastT - this.recStart));
      this.status(t('video.recording', { notes: notesLabel(n), time }));
      if (ctl && ctl.duration()) ($('viProgress') as HTMLElement).style.width = `${Math.min(100, (100 * ctl.time()) / ctl.duration())}%`;
    }, 150);
  }

  /**
   * While the YouTube video plays, note where it is against the clock the
   * notes are timed by: the wall clock less the pauses while recording (the
   * tracker's), or the recorded sound's while listening.
   */
  private sampleClock(): void {
    const yt = this.yt;
    if (!yt || yt.state !== YT_STATE.PLAYING) return;
    if (this.phase === 'recording') {
      if (this.frozenSince !== null) return;
      this.clock.push({ c: performance.now() / 1000 - this.frozenTotal, v: yt.time });
    } else if (this.phase === 'listening' && this.take) this.clock.push({ c: this.take.seconds, v: yt.time });
  }

  private drawSeen(): void {
    const b = this.lastBand;
    const layout = this.layout;
    const cv = $<HTMLCanvasElement>('viSeen');
    if (!b || !layout || cv.hidden) return;
    const s = this.scratch;
    if (s.width !== b.frame.width || s.height !== b.frame.height) {
      s.width = b.frame.width;
      s.height = b.frame.height;
    }
    s.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.frame.data), b.frame.width, b.frame.height), 0, 0);
    // just the keys, from the keyboard's top to its bottom, between its ends
    const x0 = Math.max(0, layout.left - layout.whiteWidth * 0.5);
    const x1 = Math.min(b.frame.width, layout.right + layout.whiteWidth * 0.5);
    const y0 = Math.max(0, layout.top - b.top - 4);
    const y1 = Math.min(b.frame.height, layout.bottom - b.top + 2);
    const dpr = devicePixelRatio || 1;
    const w = cv.clientWidth * dpr;
    const h = Math.round((w * (y1 - y0)) / (x1 - x0));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(s, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h);
    const sx = w / (x1 - x0);
    const lit = new Set(this.tracker?.lit() ?? []);
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = palette().felt;
    for (const k of layout.keys) {
      if (!lit.has(k.pitch)) continue;
      ctx.beginPath();
      ctx.arc((k.x - x0) * sx, (k.y - b.top - y0) * sx, Math.max(3 * dpr, layout.whiteWidth * 0.32 * sx), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  finish(): void {
    const tracker = this.tracker;
    if (this.phase !== 'recording' || !tracker) return;
    this.phase = 'done';
    clearInterval(this.live);
    if (this.grabber) this.grabber.onFrame = null;
    this.grabber?.stop();
    this.grabber = null;
    this.control()?.pause();
    this.showResult(tracker.finish());
  }

  /** Notes in: the result screen, or back to Recognise when there are too few. */
  private showResult(raw: RawNote[]): void {
    this.raw = raw;
    if (this.yt) this.title = this.yt.title || this.title;
    if (this.raw.length < 4 || (!this.fromAudio && !playable(this.raw))) {
      // a keyboard was there but its keys did not light up as notes do (a filmed piano, hands over the keys)
      this.phase = 'ready';
      this.tracker = null;
      this.noKeyboard = this.raw.length >= 4;
      this.status(this.raw.length < 4 ? t('video.fewNotes') : `${t('video.noLitKeys')} ${t('video.audio.hint')}`, 'warn');
      this.buttons();
      return;
    }
    this.phase = 'done';
    $('viDraft').hidden = !this.fromAudio;
    // a close-up keyboard does not say its octave: start from where the piece's register says it sits
    this.octave = this.layout && !this.layout.octaveSure && !this.fromAudio ? octaveHint(transcribe(raw).notes) : 0;
    this.shift = 0;
    this.meter = 'auto';
    $<HTMLSelectElement>('viMeter').value = 'auto';
    $<HTMLInputElement>('viName').value = this.title || t('video.untitled');
    $('viOctaveRow').hidden = this.fromAudio || !!this.layout?.octaveSure;
    // shown first: the piano roll takes its size from the screen
    this.show('result');
    this.arrange();
  }

  /* ---------- listening instead ---------- */

  /** No lit keyboard: listen to the video. A file is read straight away; a tab is recorded while the video plays. */
  private listenInstead(): void {
    if (this.kind === 'file' && this.file) {
      const file = this.file;
      this.control()?.pause();
      void file.arrayBuffer().then((data) => this.think(data, this.gen));
      return;
    }
    if (this.kind === 'youtube' && this.yt) {
      // straight from the click: the browser asks to share this tab, with its sound
      const asked = captureThisTab(this.yt.iframe);
      const gen = this.gen;
      this.phase = 'finding';
      this.status(t('video.asking'));
      this.buttons();
      void asked.then(
        ({ stream }) => (gen === this.gen ? this.recordSound(stream, gen) : stream.getTracks().forEach((tr) => tr.stop())),
        () => {
          if (gen !== this.gen) return;
          this.ready(t('video.denied'));
          $('viStatus').className = 'vi-status warn';
        },
      );
      return;
    }
    if (this.kind === 'tab' && this.grabber instanceof StreamGrabber) this.recordSound(this.grabber.stream, this.gen);
  }

  private recordSound(stream: MediaStream, gen: number): void {
    if (!stream.getAudioTracks().length) {
      if (this.kind !== 'tab') for (const tr of stream.getTracks()) tr.stop();
      this.phase = this.kind === 'tab' ? 'finding' : 'ready';
      this.status(t('video.audio.noTrack'), 'warn');
      this.buttons();
      return;
    }
    if (this.kind !== 'tab') this.takeStream = stream;
    stream.getAudioTracks()[0].addEventListener('ended', () => gen === this.gen && void this.stopListening());
    this.take = new AudioTake(stream);
    this.phase = 'listening';
    this.clock = [];
    const ctl = this.control();
    if (ctl) {
      ctl.setSpeed(1);
      ctl.seek(this.linkStart);
      ctl.play();
    }
    this.buttons();
    this.startLive();
  }

  private async stopListening(): Promise<void> {
    const take = this.take;
    if (this.phase !== 'listening' || !take) return;
    const gen = this.gen;
    this.take = null;
    this.phase = 'thinking';
    clearInterval(this.live);
    this.control()?.pause();
    this.buttons();
    const data = await take.stop();
    for (const tr of this.takeStream?.getTracks() ?? []) tr.stop();
    this.takeStream = null;
    this.grabber?.stop();
    this.grabber = null;
    if (gen === this.gen) await this.think(data, gen);
  }

  /** Recognise notes in recorded or file sound with Basic Pitch. */
  private async think(data: ArrayBuffer, gen: number): Promise<void> {
    this.phase = 'thinking';
    this.buttons();
    this.status(t('video.audio.decoding'));
    try {
      const samples = await decodeAudio(data);
      if (gen !== this.gen) return;
      this.status(t('video.audio.thinking', { p: 0 }));
      let shown = 0;
      const raw = await listen(samples, (p) => {
        shown = Math.max(shown, Math.round(p * 100));
        if (gen === this.gen) this.status(t('video.audio.thinking', { p: shown }));
      });
      if (gen !== this.gen) return;
      this.fromAudio = true;
      this.showResult(raw);
    } catch (e) {
      if (gen !== this.gen) return;
      this.phase = 'ready';
      this.status(t('video.audio.failed', { reason: (e as Error).message || String(e) }), 'warn');
      this.buttons();
    }
  }

  /* ---------- result ---------- */

  private arrange(): void {
    if (!this.raw.length) return;
    const raw = this.octave ? this.raw.map((n) => ({ ...n, pitch: n.pitch + 12 * this.octave })) : this.raw;
    const timeSig = this.meter === 'auto' ? undefined : (this.meter.split('/').map(Number) as [number, number]);
    // a captured tab runs on the wall clock, so a slowed-down video gives slowed-down beats; a file gives its own time
    const speed = this.kind === 'youtube' && !this.fromAudio ? this.speed : 1;
    this.result = transcribe(raw, { speed, timeSig, shift: this.shift });
    const r = this.result;
    const autoOpt = $('viMeter').querySelector<HTMLOptionElement>('option[value=auto]');
    if (autoOpt && this.meter === 'auto') autoOpt.textContent = t('video.meter.auto', { sig: r.timeSig.join('/') });
    $('viSummary').textContent = t('video.summary', {
      notes: notesLabel(r.notes.length),
      hands: t(r.hands === 'color' ? 'video.hands.color' : this.fromAudio ? 'video.hands.audio' : 'video.hands.none'),
      bars: barsLabel(r.measures),
      bpm: Math.round(r.bpm),
    });
    if (this.layout) {
      const low = this.layout.keys[0].pitch + 12 * this.octave;
      const high = this.layout.keys[this.layout.keys.length - 1].pitch + 12 * this.octave;
      const style = this.app.nameStyle();
      const name = (p: number) => `${noteName(p, style)}${Math.floor(p / 12) - 1}`;
      $('viOctaveVal').textContent = `${name(low)}–${name(high)}`;
    }
    this.drawRoll();
  }

  private nudge(d: number): void {
    this.shift += d;
    this.arrange();
  }

  private setOctave(o: number): void {
    this.octave = Math.max(-3, Math.min(3, o));
    this.arrange();
  }

  /** The first bars as a piano roll with bar lines, to check the bars at a glance. */
  private drawRoll(): void {
    const r = this.result;
    const cv = $<HTMLCanvasElement>('viRoll');
    if (!r || !r.notes.length) return;
    const meter = (r.timeSig[0] * 4) / r.timeSig[1];
    const bars = Math.min(r.measures, 6);
    const span = bars * meter;
    const shown = r.notes.filter((n) => n.t < span);
    if (!shown.length) return;
    const lo = Math.min(...shown.map((n) => n.pitch)) - 1;
    const hi = Math.max(...shown.map((n) => n.pitch)) + 1;
    const dpr = devicePixelRatio || 1;
    const w = cv.clientWidth * dpr;
    const h = cv.clientHeight * dpr;
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    const x = (b: number) => (b / span) * w;
    const rowH = h / (hi - lo + 1);
    const pal = palette();
    for (let b = 0; b <= span; b++) {
      ctx.fillStyle = b % meter === 0 ? pal.barline : pal.octave;
      ctx.fillRect(Math.round(x(b)), 0, b % meter === 0 ? 2 * dpr : dpr, h);
    }
    ctx.fillStyle = pal.barlabel;
    ctx.font = `500 ${10.5 * dpr}px ${pal.mono}`;
    for (let m = 0; m < bars; m++) ctx.fillText(String(m + 1), x(m * meter) + 4 * dpr, 13 * dpr);
    for (const n of shown) {
      ctx.fillStyle = n.hand === 'L' ? pal.fingers[4] : pal.fingers[1];
      const y = (hi - n.pitch) * rowH;
      ctx.fillRect(x(n.t) + dpr, y, Math.max(2 * dpr, x(Math.min(n.dur, span - n.t)) - 2 * dpr), Math.max(2 * dpr, rowH - dpr));
    }
  }

  /** Play the result (the first 30 seconds) with the app's sound. */
  private togglePreview(): void {
    if (this.preview.length) {
      this.stopPreview();
      return;
    }
    const r = this.result;
    if (!r) return;
    this.app.synth.unlock();
    const spb = 60 / r.bpm;
    const btn = $('viListen');
    btn.textContent = t('video.listenStop');
    let last = 0;
    for (const n of r.notes) {
      const at = n.t * spb;
      if (at > 30) break;
      last = Math.max(last, at + n.dur * spb);
      this.preview.push(setTimeout(() => this.app.synth.noteOn(n.pitch, n.hand === 'L' ? 0.55 : 0.75, n.dur * spb), at * 1000));
    }
    this.preview.push(setTimeout(() => this.stopPreview(), last * 1000 + 300));
  }

  private stopPreview(): void {
    for (const id of this.preview) clearTimeout(id);
    if (this.preview.length) this.app.synth.allOff();
    this.preview = [];
    $('viListen').textContent = t('video.listen');
  }

  private async openPiece(): Promise<void> {
    const r = this.result;
    if (!r) return;
    this.stopPreview();
    const name = $<HTMLInputElement>('viName').value.trim() || t('video.untitled');
    const bytes = toMidi(r, name);
    let video: { origin: string; start?: number; speed?: number } | undefined;
    if (this.kind === 'youtube') {
      // the second of the video where the first bar begins: the piece's start on the capture clock,
      // carried over to the player's by the samples taken while it played (at the chosen speed, or
      // at full speed when it was listened to)
      const speed = this.fromAudio ? 1 : this.speed;
      const offset = fitOffset(this.clock, speed);
      const start = offset !== null && r.start !== undefined ? Math.max(0, offset + speed * r.start) : undefined;
      video = { origin: this.link, start, speed };
    }
    this.reset();
    $('vimport').hidden = true;
    await this.app.openTranscription(bytes, name, video);
  }

  private again(): void {
    this.stopPreview();
    const kind = this.kind;
    this.fromAudio = false;
    this.raw = [];
    this.result = null;
    this.tracker = null;
    this.layout = null;
    this.calib = null;
    this.show('work');
    if (kind === 'tab') {
      // the tab was released when recording stopped
      this.toSource();
      return;
    }
    this.ready(kind === 'youtube' ? t('video.ready') : t('video.readyFile'));
  }
}

