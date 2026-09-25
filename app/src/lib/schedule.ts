/**
 * How a race weekend is written on the page: its dates in UK time, its
 * sessions in running order, places as figures and letters, small numbers in
 * words.
 *
 * The calendar page's formatting, in one module so its panel, its two lists
 * and its season-by-season results cannot disagree about how a date looks.
 * These are the rules on-track.ts applies to its own schedule, lifted out
 * unchanged: UK time because the reference prints and footnotes it (*UK TIME),
 * and three-letter months from a fixed table because en-GB's own short
 * September is "Sept", where the reference -- like every timing screen --
 * reads SEP.
 */

import type { CalendarRound, RaceSession } from '../content/live-stats';

/** Three-letter months, as the reference prints them. */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthAbbr(month: number): string {
  const name = MONTHS[month - 1];
  if (!name) throw new Error(`[calendar] no month ${month}`);
  return name;
}

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 1 -> 1st, 2 -> 2nd, 3 -> 3rd, 11 -> 11th. */
export function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** A finishing place as figure and letters: 1 -> ["1", "st"]. */
export function place(n: number): [string, string] {
  const text = ordinal(n);
  const figure = text.replace(/\D+$/, '');
  return [figure, text.slice(figure.length)];
}

const SMALL_NUMBERS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Numbers under a hundred spelled out, for figures inside a sentence. */
export function spell(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 100) return String(n);
  if (n < SMALL_NUMBERS.length) return SMALL_NUMBERS[n] as string;
  const unit = n % 10;
  return `${TENS[Math.floor(n / 10)]}${unit ? `-${SMALL_NUMBERS[unit]}` : ''}`;
}

const ukClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface UkWhen {
  day: number;
  month: number;
  /** "9:30", "13:00" -- the reference's own format, no leading zero. */
  time: string;
}

export function ukWhen(instant: Date): UkWhen {
  const parts = new Map(ukClock.formatToParts(instant).map((p) => [p.type, p.value]));
  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.get(type);
    if (value === undefined) throw new Error(`[calendar] no ${type} in ${instant.toISOString()}`);
    return value;
  };
  return {
    day: Number(read('day')),
    month: Number(read('month')),
    time: `${Number(read('hour'))}:${read('minute')}`,
  };
}

/** A session in UK time. Without a published start, its calendar day and TBC. */
export function sessionWhen(session: RaceSession): UkWhen {
  if (session.time) return ukWhen(new Date(`${session.date}T${session.time}`));
  const [, month, day] = session.date.split('-').map(Number);
  if (!month || !day) throw new Error(`[calendar] unreadable session date "${session.date}"`);
  return { day, month, time: 'TBC' };
}

export type SessionKind = 'practice1' | 'practice2' | 'practice3' | 'sprint' | 'qualifying' | 'race';

export interface WeekendSession {
  kind: SessionKind;
  label: string;
  session: RaceSession;
}

/**
 * A weekend's sessions in running order, the race last. A sprint weekend has
 * no second or third practice and a sprint instead; the calendar does not
 * carry sprint qualifying, so it is not invented here.
 */
export function weekendSessions(round: CalendarRound): WeekendSession[] {
  const s = round.sessions;
  const listed: [SessionKind, string, RaceSession | null][] = [
    ['practice1', 'Practice 1', s.practice1],
    ['practice2', 'Practice 2', s.practice2],
    ['practice3', 'Practice 3', s.practice3],
    ['sprint', 'Sprint', s.sprint],
    ['qualifying', 'Qualifying', s.qualifying],
  ];
  const at = (x: RaceSession): string => `${x.date}T${x.time ?? '00:00:00Z'}`;
  return [
    ...listed
      .filter((entry): entry is [SessionKind, string, RaceSession] => entry[2] !== null)
      .sort((a, b) => at(a[2]).localeCompare(at(b[2])))
      .map(([kind, label, session]) => ({ kind, label, session })),
    { kind: 'race', label: 'Race', session: { date: round.date, time: round.time } },
  ];
}

/** "24-26" and "Sep" -- the weekend as the panel and the upcoming list print it. */
export function weekendSpan(round: CalendarRound): { days: string; month: string } {
  const sessions = weekendSessions(round);
  const first = sessionWhen((sessions[0] as WeekendSession).session);
  const race = sessionWhen((sessions[sessions.length - 1] as WeekendSession).session);
  return {
    days: `${pad2(first.day)}-${pad2(race.day)}`,
    month:
      first.month === race.month
        ? monthAbbr(race.month)
        : `${monthAbbr(first.month)}/${monthAbbr(race.month)}`,
  };
}

/**
 * "8 Mar" and "26" -- a race day as the reference's results rows print it, the
 * year cut to two figures. Read in UTC: the record's dates are calendar days,
 * not instants, and a zone west of Greenwich would print them a day early.
 */
export function raceDay(iso: string): { dayMonth: string; year: string } {
  const day = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) throw new Error(`[calendar] "${iso}" is not an ISO date`);
  return {
    dayMonth: `${day.getUTCDate()} ${monthAbbr(day.getUTCMonth() + 1)}`,
    year: String(day.getUTCFullYear()).slice(-2),
  };
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
