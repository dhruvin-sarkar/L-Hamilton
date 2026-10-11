/**
 * The countdown to the next race: "next race begins in...", four digit pairs
 * and the "Race Day" lettering written across them.
 *
 * Reference section 5 of On Track, and the same section again on its calendar.
 * One implementation for both pages, with the markup and styles (the
 * `.ot-count` block in on-track.css) shared the same way, so the section
 * cannot behave one way on On Track and another on the calendar.
 *
 * The reference's target is plain text in a hidden element and its digits all
 * sit at 00 because the race it points at is long past. Ours reads the
 * calendar and picks by the clock, so it cannot expire in place, and the
 * section goes away once the season has no race left to count to.
 */

import { hasTrack, mountCircuit } from './circuit';
import { gsap, mm, reducedMotion, ScrollTrigger, WIDE_AND_ANIMATED } from './motion';
import { el, ukWhen } from './schedule';
import { nextRound, roundStart } from '../content/live-stats';

export function mountCountdown(section: HTMLElement): void {
  const upcoming = nextRound();
  if (!upcoming) {
    // The season is over. Nothing to count to -- the reference's frozen 00s
    // read as broken, not as finished.
    section.hidden = true;
    return;
  }

  const digits = section.querySelector<HTMLElement>('[data-countdown-digits]');
  const sentence = section.querySelector<HTMLElement>('[data-countdown-sr]');
  if (!digits || !sentence) throw new Error('[countdown] the markup has lost its digits or its sentence');

  /* The circuit being counted to, lit, as the reference's is. A round the
     circuit file has no shape for leaves the slot empty rather than drawing
     some other track. */
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

  /* Days is the one field whose width is not fixed: two figures inside a
   * season, three across a winter break. The reference sizes its row for
   * eight characters, so a ninth scales the whole row down by 8/9 -- solved
   * once and held, because a row that resized itself as the count fell
   * through 100 would jump under the reader. */
  const remaining = (): number => Math.max(0, target.getTime() - Date.now());
  const dayWidth = Math.max(2, String(Math.floor(remaining() / 86_400_000)).length);
  digits.style.setProperty('--count-scale', String(8 / (dayWidth + 6)));

  /* Under reduced motion the seconds are left out: a figure changing every
     second is motion. The other three still keep time -- see the tick below. */
  const UNITS: [string, number][] = [
    ['D', 86_400_000],
    ['H', 3_600_000],
    ['M', 60_000],
    ...(reducedMotion ? [] : ([['S', 1000]] as [string, number][])),
  ];
  const phrase = digits.querySelector('[data-countdown-phrase]');
  /* Each field holds the width of its zeros, so a ticking figure never nudges
     the row: the reference pins its seconds to 16rem for the same reason, and
     ours tick where its frozen 00s never had to. */
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

  /* One interval, cleared at zero. Under reduced motion there are no seconds
     to tick, but the figures still keep time: they update once a minute, on
     the minute, because a countdown frozen at load is simply wrong a minute
     later. A text change once a minute is information, not motion. */
  if (reducedMotion) {
    const untilNextMinute = (): number => (remaining() % 60_000) + 50;
    const onTheMinute = (): void => {
      if (!render()) window.setTimeout(onTheMinute, untilNextMinute());
    };
    window.setTimeout(onTheMinute, untilNextMinute());
  } else {
    const tick = window.setInterval(() => {
      if (render()) window.clearInterval(tick);
    }, 1000);
  }

  /* "Race Day", written across the digits once, when the script's box reaches
   * 80% down the viewport: the reference's `race-day` Rive, played by the same
   * `data-rive-scrolltrigger` handler as the P1, which also raises the canvas
   * from opacity 0 over 0.1s as it starts.
   *
   * Timed off the reference's own file rather than its timeline lengths. Its
   * main animation runs 210 frames (3.5s) and nests one 120-frame timeline per
   * stroke, but those do not overlap on screen: sampled frame by frame, the
   * word is written a stroke at a time with the pen lifted between them -- the
   * R down by 0.42s, "Race" by 1.2s, the D by 1.85s, "Day" by 2.6s, the
   * underline by 3.0s -- about 2.0s of ink and 1.0s of lifts, with the last
   * 0.5s holding the finished word. So: the strokes in the order the markup
   * lists them, each for its share of the length, 90ms apart, each easing on
   * and off the page (power1.inOut), and the hand itself running at a constant
   * rate. Written and still below 992px and under reduced motion. */
  const script = digits.querySelector<SVGSVGElement>('.ot-count__script');
  const strokes = [...digits.querySelectorAll<SVGPathElement>('[data-stroke]')];
  const RACE_DAY_INK = 3.0;
  const PEN_LIFT = 0.09;
  if (script && strokes.length) {
    mm.add(WIDE_AND_ANIMATED, () => {
      const lengths = strokes.map((path) => path.getTotalLength());
      const total = lengths.reduce((a, b) => a + b, 0);
      const inking = RACE_DAY_INK - PEN_LIFT * (strokes.length - 1);
      const hand = gsap.timeline({ paused: true });
      let at = 0;
      strokes.forEach((path, i) => {
        const length = lengths[i] ?? 0;
        const duration = (inking * length) / total;
        /* Attributes, not the CSS property: GSAP rounds that to whole pixels,
           which would leave a sliver of each waiting stroke as a dot. The gap
           is twice the dash so a hidden stroke has no dash end in it at all. */
        gsap.set(path, {
          attr: { 'stroke-dasharray': `${length} ${2 * length}`, 'stroke-dashoffset': length },
        });
        hand.to(path, { attr: { 'stroke-dashoffset': 0 }, duration, ease: 'power1.inOut' }, at);
        at += duration + PEN_LIFT;
      });
      gsap.set(script, { opacity: 0 });

      const trigger = ScrollTrigger.create({
        trigger: script,
        start: 'top 80%',
        once: true,
        onEnter: () => {
          gsap.to(script, { opacity: 1, duration: 0.1, ease: 'power1.inOut' });
          hand.play();
        },
      });
      return () => trigger.kill();
    });
  }
}
