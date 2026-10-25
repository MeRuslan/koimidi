/**
 * Frames for the recognition: from a captured browser tab (koimidi's own,
 * where the YouTube player is, or another one) or from a video file. Each
 * frame is scaled to at most 960 pixels wide; while recording only the rows
 * the tracker reads are drawn and copied back, about a millisecond a frame.
 */
import type { Frame } from './frame';

const MAX_W = 960;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Grabbed {
  frame: Frame;
  /** Seconds, on the source's clock. */
  t: number;
}

/* Chrome APIs not in TypeScript's DOM types yet. */
interface CropTargetCtor {
  fromElement(el: Element): Promise<unknown>;
}
interface CroppableTrack extends MediaStreamTrack {
  cropTo?(target: unknown): Promise<void>;
}
interface TrackProcessorCtor {
  new (init: { track: MediaStreamTrack }): { readable: ReadableStream<VideoFrame> };
}
const hasVfc = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

/** Where frames are turned into pixels. Subclasses feed it from a stream or a video element. */
export abstract class Grabber {
  width = 0;
  height = 0;
  /** Rows the tracker wants on every frame (inclusive), or null while only looking. */
  band: { top: number; bottom: number } | null = null;
  onFrame: ((band: Frame, t: number, top: number) => void) | null = null;
  /** Part of the source picture to look at, in source pixels; null for all of it. */
  crop: ((sw: number, sh: number) => Rect | null) | null = null;
  /**
   * Keep the frame size from now on, whatever the source does: the tracker's
   * key positions are in these pixels. A resized player is scaled back.
   */
  locked = false;
  /** Seconds spent turning frames into pixels, for the benchmark. */
  spent = 0;
  frames = 0;
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private waiting: ((g: Grabbed) => void)[] = [];

  constructor() {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
    // a GPU canvas: video frames stay on the GPU and only the rows read back are copied (about twice as fast)
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  /** The next frame in full. */
  next(): Promise<Grabbed> {
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  abstract stop(): void;

  protected handle(src: CanvasImageSource, sw: number, sh: number, t: number): void {
    if (!sw || !sh) return;
    const t0 = performance.now();
    const c = this.crop?.(sw, sh) ?? { x: 0, y: 0, w: sw, h: sh };
    let w = this.width;
    let h = this.height;
    if (!this.locked) {
      const scale = Math.min(1, MAX_W / c.w);
      w = Math.max(1, Math.round(c.w * scale));
      h = Math.max(1, Math.round(c.h * scale));
      if (w !== this.width || h !== this.height) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.width = w;
        this.height = h;
      }
    }
    const band = this.band;
    if (this.waiting.length || !band || !this.onFrame) {
      this.ctx.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, w, h);
    } else {
      // only the rows the tracker reads
      const ky = c.h / h;
      const rows = band.bottom - band.top + 1;
      this.ctx.drawImage(src, c.x, c.y + band.top * ky, c.w, rows * ky, 0, band.top, w, rows);
    }
    if (this.waiting.length) {
      const frame = this.ctx.getImageData(0, 0, w, h);
      const ws = this.waiting;
      this.waiting = [];
      for (const r of ws) r({ frame, t });
    }
    if (band && this.onFrame) {
      const rows = this.ctx.getImageData(0, band.top, w, band.bottom - band.top + 1);
      this.onFrame(rows, t, band.top);
    }
    this.spent += (performance.now() - t0) / 1000;
    this.frames++;
  }
}

/** Frames of a captured tab or window. */
export class StreamGrabber extends Grabber {
  private stopped = false;
  private video: HTMLVideoElement | null = null;
  private handleId = 0;

  constructor(readonly stream: MediaStream) {
    super();
    const track = stream.getVideoTracks()[0];
    const Processor = (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor }).MediaStreamTrackProcessor;
    if (Processor) void this.pump(new Processor({ track }).readable.getReader());
    else this.viaVideo();
  }

  /** Every frame, even while this tab is in the background. */
  private async pump(reader: ReadableStreamDefaultReader<VideoFrame>): Promise<void> {
    while (!this.stopped) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      try {
        // the capture clock, in seconds
        this.handle(value, value.displayWidth, value.displayHeight, value.timestamp / 1e6);
      } finally {
        value.close();
      }
    }
    reader.releaseLock();
  }

  private viaVideo(): void {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = this.stream;
    void v.play();
    this.video = v;
    const tick = () => {
      if (this.stopped) return;
      this.handle(v, v.videoWidth, v.videoHeight, performance.now() / 1000);
      this.handleId = hasVfc ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.video) {
      if (hasVfc) this.video.cancelVideoFrameCallback(this.handleId);
      else cancelAnimationFrame(this.handleId);
      this.video.srcObject = null;
    }
    for (const t of this.stream.getTracks()) t.stop();
  }
}

/**
 * Frames of a <video> element playing a file, timed by the file's own clock.
 * The browser calls back on every frame it shows; when it shows none (the
 * page is not being drawn), a timer takes the current frame instead.
 */
export class VideoGrabber extends Grabber {
  private stopped = false;
  private handleId = 0;
  private lastCall = 0;
  private timer: ReturnType<typeof setInterval>;

  constructor(readonly video: HTMLVideoElement) {
    super();
    const tick = (_now: number, meta?: { mediaTime: number }) => {
      if (this.stopped) return;
      this.lastCall = performance.now();
      this.handle(video, video.videoWidth, video.videoHeight, meta?.mediaTime ?? video.currentTime);
      this.handleId = hasVfc ? video.requestVideoFrameCallback(tick) : requestAnimationFrame((n) => tick(n));
    };
    this.handleId = hasVfc ? video.requestVideoFrameCallback(tick) : requestAnimationFrame((n) => tick(n));
    this.timer = setInterval(() => {
      if (this.stopped || video.paused || video.ended || performance.now() - this.lastCall < 250) return;
      this.handle(video, video.videoWidth, video.videoHeight, video.currentTime);
    }, 33);
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    if (hasVfc) this.video.cancelVideoFrameCallback(this.handleId);
    else cancelAnimationFrame(this.handleId);
  }
}

export function canCapture(): boolean {
  return !!navigator.mediaDevices?.getDisplayMedia;
}

/**
 * Capture this very tab, cut down to `el` (the YouTube player). Must be called
 * straight from a click. The browser asks the user first.
 */
export async function captureThisTab(el: Element): Promise<{ stream: MediaStream; crop: Grabber['crop'] }> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 60 } },
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'exclude',
  } as DisplayMediaStreamOptions);
  const track = stream.getVideoTracks()[0] as CroppableTrack;
  const CropTarget = (globalThis as unknown as { CropTarget?: CropTargetCtor }).CropTarget;
  if (CropTarget && track.cropTo) {
    try {
      await track.cropTo(await CropTarget.fromElement(el));
      return { stream, crop: null };
    } catch {
      /* fall back to cutting the frame ourselves */
    }
  }
  // the captured frame is the tab's viewport: cut out the player by its place on the page
  const crop = (sw: number, sh: number): Rect | null => {
    const r = el.getBoundingClientRect();
    const sx = sw / innerWidth;
    const sy = sh / innerHeight;
    const x = Math.max(0, r.left * sx);
    const y = Math.max(0, r.top * sy);
    const w = Math.min(sw - x, r.width * sx);
    const h = Math.min(sh - y, r.height * sy);
    return w > 16 && h > 16 ? { x, y, w, h } : null;
  };
  return { stream, crop };
}

/** Capture another tab or a window that the user picks. Must be called straight from a click. */
export function captureOther(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 60 } },
    audio: true,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'exclude',
  } as DisplayMediaStreamOptions);
}
