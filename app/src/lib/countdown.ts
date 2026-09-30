/**
 * The countdown to the next race: "next race begins in...", four digit pairs
 * and the "Race Day" lettering written across them.
 *
 * The reference carries the same section on On Track and on its calendar. This
 * is On Track's implementation (on-track.ts, mountCountdown) lifted out
 * unchanged for the calendar page, with the markup and styles (the `.ot-count`
 * block in on-track.css) shared the same way. Its target is the next round by
 * the clock, never a typed date, so it cannot count down to a race already run;
 * with no race left in the season the section steps aside.
 */

import { hasTrack, mountCircuit } from './circuit';
import { gsap, reducedMotion, ScrollTrigger } from './motion';
import { el, ukWhen } from './schedule';
import { nextRound, roundStart } from '../content/live-stats';

export function mountCountdown(section: HTMLElement): void {
  const upcoming = nextRound();
  if (!upcoming) {
    section.hidden = true;
    return;
  }

  const digits = section.querySelector<HTMLElement>('[data-countdown-digits]');
  const sentence = section.querySelector<HTMLElement>('[data-countdown-sr]');
  if (!digits || !sentence) throw new Error('[countdown] the markup has lost its digits or its sentence');

  /* The circuit being counted to, lit, as the reference's is. */
  const circuitHost = section.querySelector<HTMLElement>('[data-countdown-circuit]');
  if (circuitHost && hasTrack(upcoming.circuitId)) {
    void mountCircuit(circuitHost, { circuitId: upcoming.circuitId, lit: true }).catch(
      (error: unknown) => console.warn('[countdown] circuit did not load', error),
    );
  }

  const target = roundStart(upcoming);

  /* The static equivalent: the digits are a view of the start time, so the
     start time is what gets said. */
  const day = target.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  sentence.textContent = upcoming.time
    ? `The next race is round ${upcoming.round}, the ${upcoming.raceName} at ${upcoming.circuitName}. ` +
      `It starts at ${ukWhen(target).time} UK time on ${day}.`
    : `The next race is round ${upcoming.round}, the ${upcoming.raceName} at ${upcoming.circuitName}, ` +
      `on ${day}. Its start time is not yet confirmed.`;

  /* Days is the one field whose width is not fixed; a three-figure count
     scales the row by 8/9, solved once and held. */
  const remaining = (): number => Math.max(0, target.getTime() - Date.now());
  const dayWidth = Math.max(2, String(Math.floor(remaining() / 86_400_000)).length);
  digits.style.setProperty('--count-scale', String(8 / (dayWidth + 6)));

  const UNITS: [string, number][] = [
    ['D', 86_400_000],
    ['H', 3_600_000],
    ['M', 60_000],
    ['S', 1000],
  ];
  const phrase = digits.querySelector('[data-countdown-phrase]');
  const values = UNITS.map(([unit], i) => {
    const item = el('div', 'ot-count__item');
    const value = el('span', i === 3 ? 'ot-count__value ot-count__value--seconds' : 'ot-count__value', '00');
    value.style.setProperty('--figures', String(i === 0 ? dayWidth : 2));
    item.append(value, el('span', 'ot-count__unit', unit));
    digits.insertBefore(item, phrase);
    return value;
  });

  const render = (): boolean => {
    let left = remaining();
    UNITS.forEach(([, per], i) => {
      const n = Math.floor(left / per);
      left -= n * per;
      const value = values[i];
      if (value) value.textContent = String(n).padStart(i === 0 ? dayWidth : 2, '0');
    });
    return remaining() === 0;
  };
  render();

  /* Under reduced motion the figures render once and hold: the start time is
     still stated in full, and a display changing every second is motion. */
  if (!reducedMotion) {
    const tick = window.setInterval(() => {
      if (render()) window.clearInterval(tick);
    }, 1000);
  }

  /* "Race Day", written across the digits once, when the script's box reaches
     80% down the viewport -- the reference's trigger. */
  const script = digits.querySelector<SVGSVGElement>('.ot-count__script');
  const strokes = [...digits.querySelectorAll<SVGPathElement>('[data-stroke]')];
  if (script && strokes.length && !reducedMotion) {
    const lengths = strokes.map((path) => path.getTotalLength());
    const total = lengths.reduce((a, b) => a + b, 0);
    const hand = gsap.timeline({ paused: true });
    strokes.forEach((path, i) => {
      const length = lengths[i] ?? 0;
      gsap.set(path, { strokeDasharray: `${length} ${length}`, strokeDashoffset: length });
      hand.to(path, { strokeDashoffset: 0, duration: length / total, ease: 'none' });
    });
    ScrollTrigger.create({
      trigger: script,
      start: 'top 80%',
      once: true,
      onEnter: () => {
        gsap.to(hand, { progress: 1, duration: 1.6, ease: 'power1.inOut' });
      },
    });
  }
}
