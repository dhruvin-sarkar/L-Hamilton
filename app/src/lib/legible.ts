/**
 * Text that stays readable on a ground that is moving.
 *
 * The Home gallery scrubs its ground from the light field to near-black, and
 * the reference sets its captions in fixed inks that only work at either end:
 * a muted dark over the light screen, a muted light over the dark one. Between
 * the two the ground passes through a band of mid-greys where NEITHER muted
 * ink — nor even the site's own darkest and lightest — reaches 4.5:1.
 *
 * So the ink is chosen per frame instead: the reference's own colour whenever
 * it reads, and otherwise the smallest step from it towards black or white
 * that does. Away from the crossing nothing moves, so both ends still look
 * exactly like the reference; through it the text holds WCAG AA.
 */

export type RGB = readonly [number, number, number];

/** A hex token (#rrggbb) as 0-255 sRGB channels. */
export function hexRGB(hex: string): RGB {
  const clean = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) throw new Error(`[legible] not a #rrggbb colour: "${hex}"`);
  const n = Number.parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** One sRGB channel (0-255) to linear light, 0-1. */
export const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
export function luminance(c: RGB): number {
  return 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);
}

/** WCAG contrast ratio, 1-21. */
export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];

/**
 * The ground luminance at which black and white text read equally well
 * ((L + 0.05) / 0.05 = 1.05 / (L + 0.05)). Above it the dark ink is the one
 * with room to spare, below it the light one.
 */
const EVEN = Math.sqrt(0.05 * 1.05) - 0.05;

/**
 * `dark` or `light` — whichever side of the ground has room — as it is if it
 * reads at `min`:1, otherwise moved just far enough towards black or white.
 */
export function legibleOn(ground: RGB, dark: RGB, light: RGB, min = 4.5): RGB {
  const onLight = luminance(ground) >= EVEN;
  const preferred = onLight ? dark : light;
  const extreme = onLight ? BLACK : WHITE;
  if (contrast(preferred, ground) >= min) return preferred;
  // Contrast rises monotonically towards the extreme, so a bisection finds
  // the least move that clears the bar.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) / 2;
    if (contrast(mixRGB(preferred, extreme, mid), ground) >= min) hi = mid;
    else lo = mid;
  }
  return mixRGB(preferred, extreme, hi);
}

export const cssRGB = (c: RGB): string =>
  `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
