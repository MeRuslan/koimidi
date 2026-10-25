/**
 * The YouTube player inside koimidi (the official IFrame API): koimidi plays
 * the video itself, so it can start it over, slow it down and notice when it
 * stops to buffer. Nothing is downloaded; the video is watched as on YouTube.
 */

/** The video id from any YouTube link (watch, youtu.be, shorts, embed, live, music) or a bare id. */
export function youTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v');
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
    if (!id && m) id = m[1];
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** Start time from a link (?t=90, ?t=1m30s, &start=90), in seconds. */
export function youTubeStart(input: string): number {
  try {
    const url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
    const t = url.searchParams.get('t') ?? url.searchParams.get('start');
    if (!t) return 0;
    if (/^\d+$/.test(t)) return +t;
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    return m ? +(m[1] ?? 0) * 3600 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0) : 0;
  } catch {
    return 0;
  }
}

/* The IFrame API, as much of it as koimidi uses. */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  setPlaybackRate(r: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoLoadedFraction(): number;
  getVideoData?(): { title?: string; author?: string };
  mute(): void;
  unMute(): void;
  destroy(): void;
  getIframe(): HTMLIFrameElement;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

let api: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (api) return api;
  api = new Promise<YTNamespace>((resolve, reject) => {
    const timer = setTimeout(() => {
      api = null;
      reject(new Error('youtube-unreachable'));
    }, 15000);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      clearTimeout(timer);
      resolve(window.YT!);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      api = null;
      s.remove();
      reject(new Error('youtube-unreachable'));
    };
    document.head.append(s);
  });
  return api;
}

/** Why a video cannot play here: 'embed' (the author forbids playing it outside YouTube), 'missing', or 'error'. */
export type YouTubeProblem = 'embed' | 'missing' | 'error';

/** The problem an error from `create` names, or null for an unreachable YouTube. */
export function youTubeProblemOf(e: unknown): YouTubeProblem | null {
  const m = (e as Error)?.message;
  return m === 'youtube-embed' ? 'embed' : m === 'youtube-missing' ? 'missing' : m === 'youtube-error' ? 'error' : null;
}

export class YouTubePlayer {
  private player!: YTPlayer;
  state = -1;
  onState: ((state: number) => void) | null = null;
  onProblem: ((p: YouTubeProblem) => void) | null = null;

  private constructor(readonly id: string) {}

  /** Put the player into `host` (it is replaced by the player's iframe) and wait until it can play. */
  static async create(host: HTMLElement, id: string, start = 0): Promise<YouTubePlayer> {
    const YT = await loadApi();
    const p = new YouTubePlayer(id);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('youtube-unreachable')), 20000);
      p.player = new YT.Player(host, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: {
          // koimidi's own buttons: YouTube's controls would cover the keyboard at the bottom of the frame
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
          start: Math.floor(start),
          origin: location.origin,
        },
        events: {
          onReady: () => {
            clearTimeout(timer);
            resolve();
          },
          onStateChange: (e: { data: number }) => {
            p.state = e.data;
            p.onState?.(e.data);
          },
          onError: (e: { data: number }) => {
            clearTimeout(timer);
            const problem: YouTubeProblem = e.data === 101 || e.data === 150 ? 'embed' : e.data === 100 || e.data === 2 ? 'missing' : 'error';
            if (p.onProblem) p.onProblem(problem);
            else reject(new Error(`youtube-${problem}`));
          },
        },
      });
    });
    return p;
  }

  get iframe(): HTMLIFrameElement {
    return this.player.getIframe();
  }

  get title(): string {
    return this.player.getVideoData?.().title?.trim() || '';
  }

  get duration(): number {
    return this.player.getDuration() || 0;
  }

  get time(): number {
    return this.player.getCurrentTime() || 0;
  }

  get loaded(): number {
    return this.player.getVideoLoadedFraction() || 0;
  }

  play(): void {
    this.player.playVideo();
  }

  pause(): void {
    this.player.pauseVideo();
  }

  seek(t: number): void {
    this.player.seekTo(t, true);
  }

  setSpeed(r: number): void {
    this.player.setPlaybackRate(r);
  }

  mute(): void {
    this.player.mute();
  }

  unmute(): void {
    this.player.unMute();
  }

  destroy(): void {
    try {
      this.player.destroy();
    } catch {
      /* already gone */
    }
  }
}
