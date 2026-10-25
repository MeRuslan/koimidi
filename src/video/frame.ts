/** Pixels of a video frame, as canvas getImageData returns them. */

/** An RGBA picture: a whole frame, or a band of rows cut from one. */
export interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type RGB = [number, number, number];

/** Mean colour of the (2r+1)² pixels around (x, y), clamped to the frame. */
export function patch(f: Frame, x: number, y: number, r = 1): RGB {
  const cx = Math.round(x);
  const cy = Math.round(y);
  let R = 0;
  let G = 0;
  let B = 0;
  let n = 0;
  for (let yy = Math.max(0, cy - r); yy <= Math.min(f.height - 1, cy + r); yy++) {
    for (let xx = Math.max(0, cx - r); xx <= Math.min(f.width - 1, cx + r); xx++) {
      const i = (yy * f.width + xx) * 4;
      R += f.data[i];
      G += f.data[i + 1];
      B += f.data[i + 2];
      n++;
    }
  }
  return n ? [R / n, G / n, B / n] : [0, 0, 0];
}

export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Spread between the strongest and weakest channel: 0 for greys, large for vivid colours. */
export function chroma(c: RGB): number {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

export function dist(a: RGB, b: RGB): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Bright and colourless: an unlit white key. */
export function isWhitePx(r: number, g: number, b: number): boolean {
  return luma(r, g, b) >= 150 && Math.max(r, g, b) - Math.min(r, g, b) <= 60;
}

/** Dark: an unlit black key, or the background above the keys. */
export function isDarkPx(r: number, g: number, b: number): boolean {
  return luma(r, g, b) < 90;
}

/** Hue in degrees (0–360) and saturation (0–1) of a colour. */
export function hueSat(c: RGB): { hue: number; sat: number } {
  const [r, g, b] = c;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const sat = max ? d / max : 0;
  if (!d) return { hue: 0, sat };
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, sat };
}
