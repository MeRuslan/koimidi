/**
 * Looks. Paper (light) and lacquer (dark) are one design in two lights,
 * console is a hardware panel with a dark screen; "auto" follows the system.
 * The colours live in styles.css as custom properties under [data-theme];
 * the canvas reads them from there through palette().
 */

export const THEMES = ['paper', 'lacquer', 'console'] as const;
export type Theme = (typeof THEMES)[number];
export type ThemeChoice = 'auto' | Theme;

const dark = matchMedia('(prefers-color-scheme: dark)');
let choice: ThemeChoice = 'auto';
const listeners = new Set<() => void>();

export function resolveTheme(c: ThemeChoice): Theme {
  return c === 'auto' ? (dark.matches ? 'lacquer' : 'paper') : c;
}

export function currentTheme(): Theme {
  return resolveTheme(choice);
}

/** Switch the look of the whole app; the canvas repaints with the new palette. */
export function applyTheme(c: ThemeChoice): void {
  choice = c;
  const theme = resolveTheme(c);
  document.documentElement.dataset.theme = theme;
  cached = null;
  // the browser's own chrome (tab strip, installed app's title bar) takes the page colour
  const meta = document.querySelector<HTMLMetaElement>('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || meta.content;
  for (const l of listeners) l();
}

export function onThemeChange(l: () => void): void {
  listeners.add(l);
}

dark.addEventListener('change', () => {
  if (choice === 'auto') applyTheme('auto');
});

/** Colours the canvas draws with, read once per theme from the stylesheet. */
export interface Palette {
  /** index 1–5 */
  fingers: string[];
  noFinger: string;
  lane: string;
  octave: string;
  barline: string;
  barlabel: string;
  dim: string;
  felt: string;
  case: string;
  white: string;
  white2: string;
  whiteEdge: string;
  black: string;
  black2: string;
  keyLabel: string;
  ring: string;
  onBar: string;
  accBar: string;
  accKeyWhite: string;
  accKeyBlack: string;
  press: string;
  auto: string;
  ok: string;
  bad: string;
  early: string;
  count: string;
  countAccent: string;
  text: string;
  outside: string;
  played: string;
  missed: string;
  /** bars glow a little, as on a screen */
  glow: boolean;
  bg: string;
  surface: string;
  text2: string;
  /** font families for canvas text */
  display: string;
  displayItalic: boolean;
  mono: string;
  ui: string;
}

let cached: Palette | null = null;

export function palette(): Palette {
  if (cached) return cached;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  cached = {
    fingers: ['', v('--f1', '#f47b57'), v('--f2', '#f0b429'), v('--f3', '#2db3a0'), v('--f4', '#6a8cf0'), v('--f5', '#c27ae3')],
    noFinger: v('--nofinger', '#a49c8e'),
    lane: v('--st-lane', 'rgba(0,0,0,.04)'),
    octave: v('--st-octave', 'rgba(0,0,0,.1)'),
    barline: v('--st-barline', 'rgba(0,0,0,.2)'),
    barlabel: v('--st-barlabel', 'rgba(0,0,0,.5)'),
    dim: v('--st-dim', 'rgba(255,255,255,.6)'),
    felt: v('--st-felt', '#c7361c'),
    case: v('--st-case', '#1d1b18'),
    white: v('--st-white', '#fffcf5'),
    white2: v('--st-white-2', '#ede6d8'),
    whiteEdge: v('--st-white-edge', '#cfc6b5'),
    black: v('--st-black', '#2a2825'),
    black2: v('--st-black-2', '#0e0d0c'),
    keyLabel: v('--st-keylabel', '#8d8577'),
    ring: v('--st-ring', '#1d1b18'),
    onBar: v('--st-on-bar', '#1d1b18'),
    accBar: v('--st-acc', '#c9c1b2'),
    accKeyWhite: v('--st-acc-key-w', '#d9d2c4'),
    accKeyBlack: v('--st-acc-key-b', '#6e675c'),
    press: v('--st-press', '#e0452b'),
    auto: v('--st-auto', '#6a8cf0'),
    ok: v('--ok', '#2e8b57'),
    bad: v('--bad', '#cc2e3d'),
    early: v('--warn', '#a86a12'),
    count: v('--st-count', '#1d1b18'),
    countAccent: v('--st-felt', '#c7361c'),
    text: v('--ink', '#1d1b18'),
    outside: v('--st-outside', 'rgba(0,0,0,.45)'),
    played: v('--st-played', '0.28'),
    missed: v('--st-missed', '#b5ad9f'),
    glow: v('--st-glow', '0') === '1',
    bg: v('--st-bg', '#f5f0e7'),
    surface: v('--surface', '#fbf8f2'),
    text2: v('--ink-2', '#5b554b'),
    display: v('--display', 'Georgia, serif'),
    displayItalic: v('--display-italic', 'italic') === 'italic',
    mono: v('--mono', 'monospace'),
    ui: v('--ui', 'system-ui, sans-serif'),
  };
  return cached;
}

/** Colour of a finger (1–5) in the current look; no finger gets a neutral grey. */
export function fingerColor(f?: number): string {
  const p = palette();
  return (f && p.fingers[f]) || p.noFinger;
}
