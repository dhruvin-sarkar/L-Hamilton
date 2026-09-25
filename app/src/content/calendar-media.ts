/**
 * Pictures for the calendar page's rounds.
 *
 * The reference's card over its "rounds run" list shows a photograph of its
 * driver at each round, from its own CMS. This build ships no race
 * photography (CLAUDE.md), so every round has an image SLOT at a fixed, named
 * path, and what sits there now is a placeholder generated for this build
 * (tools/gen-calendar-placeholders.py): the round's number and place, set on
 * the site's own ground. Replace a file with a licensed picture of the same
 * name and the page picks it up; nothing here changes.
 *
 *   app/public/assets/calendar/<season>-round-<nn>.webp   330 x 394 at 2x
 */

import type { CalendarRound } from './live-stats';

export function roundPhoto(round: CalendarRound): string {
  return `/assets/calendar/${round.season}-round-${String(round.round).padStart(2, '0')}.webp`;
}
