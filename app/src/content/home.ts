/**
 * The hero's two marquee bands.
 *
 * They label the narrative that follows, which is what the reference's own band
 * does -- it reads "MESSAGE FROM LANDO" over the same moment. Third person on
 * purpose: CLAUDE.md forbids putting words in Hamilton's mouth, so this is site
 * copy introducing him, never something he said. No figures here either --
 * every number on the page comes from the data layer, and a championship count
 * baked into a graphic surface would be the one place it could silently go
 * stale. "From Stevenage to Maranello" is the only concrete claim and both ends
 * of it are matters of record.
 *
 * Set into the served HTML at build time (vite.config.ts), so the bands are in
 * the first paint rather than waiting on the page's script: they are the
 * largest text on the first screen. main.ts then only repeats the copy to close
 * the loop. Its own module, with no browser dependencies, because the build
 * reads it as well as the page.
 */

export const HERO_BANDS = {
  left: ['The story so far', 'On and off the track'],
  right: ['From Stevenage to Maranello', 'Still writing it'],
} as const;

export type HeroBand = keyof typeof HERO_BANDS;

export const isHeroBand = (name: string | undefined): name is HeroBand =>
  name === 'left' || name === 'right';

/**
 * One copy of a band, as it is set: its phrases as a single run with a
 * trailing space and no glyph between them. The reference's band is a single
 * string (TEXT + " ") and its copies are parted only by that space and the seam
 * gap in CSS.
 */
export const bandCopy = (band: HeroBand): string => `${HERO_BANDS[band].join(' ')} `;

/**
 * The bands as a screen reader gets them. The visible rows are aria-hidden,
 * because they repeat themselves to close the loop; this reads them back once,
 * as they are -- not dressed up as career facts they are not.
 */
export const bandsSpoken = (): string => `${[...HERO_BANDS.left, ...HERO_BANDS.right].join('. ')}.`;
