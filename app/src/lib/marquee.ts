/**
 * A looping row of names, and the footer's row built from it.
 *
 * Home has two of these rows — the partners row on the cream ground and the one
 * inside the footer panel — and On Track has the footer's. They are the same
 * object in two colours, not two components, as the reference's are: one
 * behaviour (its `[data-marquee-scroll-direction-target]`), driven by options.
 *
 * The mechanics are read off the reference's own bundle and checked against the
 * running site at 1728:
 *
 *   the loop     linear, one copy of the list per period, at a rate set as the
 *                time the row takes to travel one screen width — so the speed
 *                scales with the viewport, as the reference's does. Measured
 *                84px/s on the footer's row and 87px/s on the partners row.
 *   direction    follows the SCROLL. Scrolling down runs the row its named way,
 *                scrolling up reverses it, at the same speed — no velocity
 *                boost and no easing between the two: the reference flips its
 *                tween's timeScale between 1 and -1 and nothing else.
 *   drift        the whole row slides a fixed distance in vw across its
 *                viewport pass, scrubbed to the scroll, in the same direction
 *                the loop runs on the way down: 5vw each side on the footer,
 *                10vw on the partners row.
 *
 * Neither row reacts to the pointer; the reference's do not.
 */

import { gsap, ScrollTrigger, reducedMotion } from './motion';
import { PARTNERS } from '../content/partners';

export interface MarqueeOptions {
  track: HTMLElement;
  box: HTMLElement;
  items: readonly string[];
  itemClass: string;
  /** Which way the row runs while the page scrolls DOWN. */
  direction: 'left' | 'right';
  /**
   * Seconds the row takes to travel one viewport width. The reference derives
   * its duration from the viewport the same way, which is what keeps the
   * speed proportional to the screen.
   */
  secondsPerScreen: number;
  /** vw the row slides either side of centre across its viewport pass. */
  drift: number;
  /** The element the drift moves. Must not be the looping track. */
  scroller: HTMLElement;
}

/**
 * The reference halves its duration below 991px and quarters it below 479px,
 * so a phone's row covers its narrow screen at about the pace a desktop's
 * covers its wide one rather than crawling.
 */
function viewportFactor(): number {
  if (window.innerWidth < 479) return 0.25;
  if (window.innerWidth < 991) return 0.5;
  return 1;
}

export function mountMarquee(opts: MarqueeOptions): void {
  const { track, box, items, itemClass, direction, secondsPerScreen, drift, scroller } = opts;

  /* Two copies minimum, then as many more as it takes for the track to span
     the viewport twice — the loop needs copyWidth * (copies - 1) to cover the
     screen or the tail is visible as the head comes round. */
  const buildCopy = (): HTMLElement => {
    const frag = document.createElement('div');
    frag.style.display = 'contents';
    for (const name of items) {
      const item = document.createElement('span');
      item.className = itemClass;
      item.textContent = name;
      frag.append(item);
    }
    return frag;
  };

  track.append(buildCopy());
  const copyWidth = track.scrollWidth;
  let copies = 1;
  while (copyWidth * copies < window.innerWidth * 2 || copies < 2) {
    track.append(buildCopy());
    copies++;
  }

  if (reducedMotion) return;

  const step = 100 / copies;
  /* Travel is step% of the track's BORDER-BOX width, because that is what
     GSAP resolves xPercent against — not scrollWidth. */
  const travelPx = (step / 100) * track.getBoundingClientRect().width;
  const pxPerSecond = window.innerWidth / (secondsPerScreen * viewportFactor());

  /* One tween that always runs LEFT; the direction is its timeScale's sign.
     Parked at the middle of its (effectively endless) repeat run, as the
     reference parks its own, so a reversed playhead has as far to go backwards
     as a forward one has to go on — a repeat:-1 tween started at 0 would stop
     dead the first time it was reversed. */
  const loop = gsap
    .fromTo(track, { xPercent: 0 }, { xPercent: -step, duration: travelPx / pxPerSecond, ease: 'none', repeat: -1 })
    .totalProgress(0.5);

  const downScale = direction === 'left' ? 1 : -1;
  loop.timeScale(downScale);

  ScrollTrigger.create({
    trigger: box,
    start: 'top bottom',
    end: 'bottom top',
    onUpdate: (self) => {
      loop.timeScale(self.direction === 1 ? downScale : -downScale);
    },
  });

  new IntersectionObserver(
    ([entry]) => {
      entry?.isIntersecting ? loop.resume() : loop.pause();
    },
    { threshold: 0 },
  ).observe(box);

  /* The positional drift, on its own element so it never fights the loop for
     the track's transform: from +drift to -drift vw for a row that runs left,
     the mirror for one that runs right. */
  const from = direction === 'left' ? drift : -drift;
  gsap.fromTo(
    scroller,
    { x: `${from}vw` },
    {
      x: `${-from}vw`,
      ease: 'none',
      scrollTrigger: { trigger: box, start: 'top bottom', end: 'bottom top', scrub: 0 },
    },
  );
}

/**
 * The footer's row: the partner names in the accent across the panel. Every
 * page carries the footer, so every page mounts this.
 *
 * aria-hidden in the markup: the row repeats itself to close the loop.
 */
export function mountFooterMarquee(): void {
  const box = document.querySelector<HTMLElement>('[data-footer-marquee]');
  const track = box?.querySelector<HTMLElement>('.footer__track');
  const scroller = box?.querySelector<HTMLElement>('.footer__marquee-scroll');
  if (!box || !track || !scroller) return;

  mountMarquee({
    track,
    box,
    items: PARTNERS,
    itemClass: 'footer__item',
    direction: 'left',
    /* 84px/s at 1728. */
    secondsPerScreen: 20.6,
    drift: 5,
    scroller,
  });
}
