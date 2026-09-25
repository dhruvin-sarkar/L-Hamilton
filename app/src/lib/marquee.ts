/**
 * A looping row of names, and the footer's row built from it.
 *
 * MOVED from main.ts rather than rewritten. Home has two of these rows — the
 * partners row on the cream ground and the one inside the footer panel — and
 * On Track has the footer's, and they are the same object in two colours, not
 * two components. The reference treats its marquees the same way: one
 * behaviour, driven by attributes.
 *
 * The one change in the move is that the smooth scroller is passed in rather
 * than read off main.ts's module scope, because each page owns its own.
 */

import type Lenis from 'lenis';
import { gsap, reducedMotion } from './motion';
import { PARTNERS } from '../content/partners';

export interface MarqueeOptions {
  track: HTMLElement;
  box: HTMLElement;
  items: readonly string[];
  itemClass: string;
  /** The page's smooth scroller, whose velocity the loop couples to. */
  lenis: Lenis | null;
  /** vw travelled across the row's viewport pass. 0 leaves the row put. */
  drift?: number;
  /** The element the drift moves. Must not be the looping track. */
  scroller?: HTMLElement | null;
  /** Travel direction. The reference runs both of its rows to the RIGHT. */
  direction?: 'left' | 'right';
  /** Loop rate. Measured off the reference at ~92px/s on both of its rows. */
  pxPerSecond?: number;
  /** The reference does not slow either row under the pointer. */
  slowOnHover?: boolean;
}

/**
 * `drift` is the footer's extra. The reference scrubs its footer row bodily
 * across the viewport as you pass it, on top of the loop, which is what makes
 * that row feel attached to the scroll rather than merely running near it. The
 * partners row has no drift, so it stays at 0 there.
 */
export function mountMarquee(opts: MarqueeOptions): void {
  const {
    track, box, items, itemClass, lenis, drift = 0, scroller = null,
    direction = 'right', pxPerSecond = 92, slowOnHover = false,
  } = opts;

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
     GSAP resolves xPercent against — not scrollWidth. Computing the duration
     off scrollWidth made the row run about 1.5x its nominal rate, which is why
     it measured 134px/s against a nominal 92. Derived from width rather than
     fixed so the rate holds whatever the list length does. */
  const travelPx = (step / 100) * track.getBoundingClientRect().width;
  const duration = travelPx / pxPerSecond;

  /* Rightward means starting one copy to the LEFT and travelling to 0, so the
     row is already full at t=0 rather than sliding in from an empty edge. */
  const loop =
    direction === 'right'
      ? gsap.fromTo(track, { xPercent: -step }, { xPercent: 0, duration, ease: 'none', repeat: -1 })
      : gsap.fromTo(track, { xPercent: 0 }, { xPercent: -step, duration, ease: 'none', repeat: -1 });

  /* Scroll velocity and pointer hover are two inputs to ONE rate, combined
     here rather than each writing timeScale. Two writers on a rate is how the
     hero marquee ended up stuck at whatever the last event said. */
  let scrollTarget = 1;
  let hoverTarget = 1;
  let rate = 1;

  lenis?.on('scroll', ({ velocity }: { velocity: number }) => {
    scrollTarget = gsap.utils.clamp(-5, 5, 1 + velocity * 0.06);
  });

  if (slowOnHover) {
    box.addEventListener('pointerenter', () => {
      hoverTarget = 0.15;
    });
    box.addEventListener('pointerleave', () => {
      hoverTarget = 1;
    });
  }

  gsap.ticker.add(() => {
    scrollTarget += (1 - scrollTarget) * 0.08;
    const want = scrollTarget * hoverTarget;
    rate += (want - rate) * 0.12;
    /* Snap on arrival and write it. Returning early here left the LAST value
       written as whatever it was a frame before convergence, so the row settled
       at a rate slightly off the one it was easing toward. */
    if (Math.abs(rate - want) < 0.001) rate = want;
    loop.timeScale(rate);
  });

  new IntersectionObserver(
    ([entry]) => {
      entry?.isIntersecting ? loop.play() : loop.pause();
    },
    { threshold: 0 },
  ).observe(box);

  /* The positional drift, on its own element so it never fights the loop for
     the track's transform. Scrubbed across the row's whole viewport pass. */
  if (drift && scroller) {
    gsap.fromTo(
      scroller,
      { xPercent: drift },
      {
        xPercent: -drift,
        ease: 'none',
        scrollTrigger: { trigger: box, start: 'top bottom', end: 'bottom top', scrub: 0 },
      },
    );
  }
}

/**
 * The footer's row: the partner names in the accent across the panel, drifting
 * with the scroll on top of the loop. Every page carries the footer, so every
 * page mounts this — On Track's row was left empty for as long as the call
 * lived only in main.ts.
 *
 * aria-hidden in the markup: the row repeats itself to close the loop.
 */
export function mountFooterMarquee(lenis: Lenis | null): void {
  const box = document.querySelector<HTMLElement>('[data-footer-marquee]');
  const track = box?.querySelector<HTMLElement>('.footer__track');
  if (!box || !track) return;

  mountMarquee({
    track,
    box,
    items: PARTNERS,
    itemClass: 'footer__item',
    lenis,
    drift: 5,
    scroller: box.querySelector<HTMLElement>('.footer__marquee-scroll'),
  });
}
