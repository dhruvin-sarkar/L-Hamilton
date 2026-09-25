/**
 * /off-track — Lewis Hamilton away from the car.
 *
 * Section order follows the reference (public/off-track.html): the page header
 * and the statement share one scroll group, then the side-scrolling gallery,
 * then the socials block and the footer. There is no helmet wall and no store
 * call on this page, so neither is included.
 */

import './styles/off-track.css';
import Lenis from 'lenis';
import { gsap, reducedMotion, ScrollTrigger } from './lib/motion';
import { mountChrome } from './lib/chrome';
import { mountReveals } from './lib/reveal';
import { mountSocials } from './lib/showcase';

/* ------------------------------------------------------------------ *
 * Smooth scroll
 *
 * The same instance, with the same options, that Home and On Track build — see
 * main.ts. `lerp` IS the scroll feel, and the reference measures 0.1.
 * ScrollTrigger is driven from Lenis, and Lenis from gsap's ticker, so the two
 * share one clock.
 * ------------------------------------------------------------------ */

if (!reducedMotion) {
  const lenis = new Lenis({
    lerp: 0.1,
    smoothWheel: true,
    syncTouch: true,
    syncTouchLerp: 0.075,
    wheelMultiplier: 1,
    touchMultiplier: 1.25,
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

mountSocials();

/* ------------------------------------------------------------------ *
 * Chrome, reveals, and the entrance
 * ------------------------------------------------------------------ */

mountChrome();

mountReveals({
  whenReady: (run) => void document.fonts.ready.then(run),
});

void document.fonts.ready.then(() => {
  document.body.classList.add('is-ready');
  ScrollTrigger.refresh();
});
