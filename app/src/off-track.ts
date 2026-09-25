/**
 * /off-track — Lewis Hamilton away from the car.
 *
 * Section order follows the reference (public/off-track.html): the page header
 * and the statement share one scroll group, then the side-scrolling gallery,
 * then the socials block and the footer. There is no helmet wall and no store
 * call on this page, so neither is included.
 *
 * Every word of copy and every picture comes from src/content/off-track.ts,
 * which carries a source for each claim and refuses to load without one. The
 * figures (his age, his debut year, the team and the year he joined it) come
 * from the same records the other pages read.
 */

import './styles/off-track.css';
import Lenis from 'lenis';
import { gsap, mm, reducedMotion, ScrollTrigger } from './lib/motion';
import { mountChrome } from './lib/chrome';
import { mountReveals } from './lib/reveal';
import { mountSocials } from './lib/showcase';
import { Signature } from './Signature';
import { age, driver, eras } from './content/hamilton';
import { hero } from './content/off-track';

/* ------------------------------------------------------------------ *
 * Smooth scroll
 *
 * The same instance, with the same options, that Home and On Track build — see
 * main.ts. `lerp` IS the scroll feel, and the reference measures 0.1.
 * ScrollTrigger is driven from Lenis, and Lenis from gsap's ticker, so the two
 * share one clock.
 * ------------------------------------------------------------------ */

let lenis: Lenis | null = null;

if (!reducedMotion) {
  lenis = new Lenis({
    lerp: 0.1,
    smoothWheel: true,
    syncTouch: true,
    syncTouchLerp: 0.075,
    wheelMultiplier: 1,
    touchMultiplier: 1.25,
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis?.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A required element. Missing markup is a build fault, not a quiet gap. */
function must<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`[off-track] missing ${selector}`);
  return found;
}

/** The team he drives for now and the year he joined it, off the open era. */
const currentEra = (() => {
  const era = eras.find((e) => e.to === null);
  if (!era) throw new Error('[off-track] no open era in the content model');
  return era;
})();

/* ------------------------------------------------------------------ *
 * Text bindings
 * ------------------------------------------------------------------ */

const bindings: Record<string, string> = {
  'driver-age': String(age()),
  'team-since': `${currentEra.team} F1 since ${currentEra.from}`,
};

for (const [key, value] of Object.entries(bindings)) {
  for (const node of document.querySelectorAll<HTMLElement>(`[data-bind="${key}"]`)) {
    node.textContent = value;
  }
}

/* ------------------------------------------------------------------ *
 * The page header's copy
 * ------------------------------------------------------------------ */

must('[data-hero-eyebrow]').textContent = hero.eyebrow;
must('[data-hero-recently]').textContent = hero.recently.text;

{
  const lead = must('[data-hero-lead]');
  lead.replaceChildren(
    document.createTextNode(`${hero.lead.before.replace('{debut}', String(driver.debutYear))} `),
    el('span', 'oft-hero__accent', hero.lead.accent),
    document.createTextNode(hero.lead.after),
  );
}

must('[data-hero-ventures]').textContent =
  `Lewis Hamilton's ventures: ${hero.ventures.map((v) => v.name).join(', ')}.`;

/* ------------------------------------------------------------------ *
 * The ventures row
 *
 * The reference's .marquee-advanced, read out of lando-gl.js (O$):
 *
 *   - the collection is repeated (data-marquee-duplicate="4") and every copy
 *     loops xPercent 0 -> -100, linear, repeat forever
 *   - duration = speed x (collection width / viewport width), speed 40, so it
 *     runs one screen-width every 40 seconds whatever the list length
 *   - its direction follows the SCROLL: scrolling down runs it one way,
 *     scrolling up the other ("data-marquee-direction=right")
 *   - and on top of the loop the whole row is scrubbed bodily across the
 *     viewport, -10vw to +10vw, over the row's pass through the screen
 * ------------------------------------------------------------------ */

const MARQUEE_SPEED = 40;
const MARQUEE_COPIES = 5;
const MARQUEE_DRIFT_VW = 10;

{
  const box = must('[data-hero-marquee]');
  const scroller = must('.oft-hero__marquee-scroll', box);
  const track = must('.oft-hero__marquee-track', box);

  const buildCopy = (): HTMLElement => {
    const copy = el('div', 'oft-hero__marquee-track');
    hero.ventures.forEach((v, i) => {
      // Every other name in the serif, so the row reads as a set of different
      // marks the way the reference's logos do, rather than one repeated face.
      copy.append(el('span', `oft-hero__venture${i % 2 ? ' is-serif' : ''}`, v.name));
    });
    return copy;
  };

  const copies = [buildCopy()];
  track.replaceWith(copies[0] as HTMLElement);
  for (let i = 1; i < MARQUEE_COPIES; i++) {
    const copy = buildCopy();
    copies.push(copy);
    scroller.append(copy);
  }

  if (!reducedMotion) {
    const first = copies[0] as HTMLElement;
    const duration = MARQUEE_SPEED * (first.offsetWidth / window.innerWidth);
    const loop = gsap.to(copies, { xPercent: -100, repeat: -1, duration, ease: 'none' });
    loop.totalProgress(0.5);

    /* Scrolling down runs the row to the right, scrolling up to the left:
       the reference's timeScale(-Z) / timeScale(Z) with Z = 1. At rest it
       keeps whichever way it was last sent. */
    loop.timeScale(1);
    ScrollTrigger.create({
      trigger: box,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (self) => loop.timeScale(self.direction === 1 ? -1 : 1),
    });

    gsap.fromTo(
      scroller,
      { x: `${-MARQUEE_DRIFT_VW}vw` },
      {
        x: `${MARQUEE_DRIFT_VW}vw`,
        ease: 'none',
        scrollTrigger: { trigger: box, start: 'top bottom', end: 'bottom top', scrub: 0 },
      },
    );

    new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) loop.play();
      else loop.pause();
    }).observe(box);
  }
}

/* ------------------------------------------------------------------ *
 * The header's entrance
 *
 * The reference's, read out of lando-gl.js (e0, for data-oval-scroll):
 *
 *   OFF TRACK   the title's line sits in a box clipped to an ellipse that
 *               opens from the BOTTOM centre — ellipse(20% 0% at 50% 100%)
 *               to ellipse(100% 120% at 50% 100%) — while every letter rises
 *               from +40% of its height, 1.5s power2.inOut, 0.015s apart out
 *               from the centre.
 *   signature   written on with the page, as the On Track header's is.
 *
 * Every text line in the header sweeps in through mountReveals, on the same
 * cue. Nothing is hidden under reduced motion.
 * ------------------------------------------------------------------ */

/** Seconds from ready to the moment the header plays: the reference's k0. */
const HERO_CUE = 0.75;

const titleLine = must('.oft-hero__title');
const signHost = must('.oft-hero__sign');

mm.add('(prefers-reduced-motion: no-preference)', () => {
  const words = [...titleLine.querySelectorAll<HTMLElement>('.oft-hero__off, .oft-hero__track')];
  const texts = words.map((w) => w.textContent ?? '');
  const letters: HTMLElement[] = [];
  words.forEach((word, i) => {
    const chars = [...(texts[i] ?? '')].map((c) => el('span', 'oft-hero__char', c));
    letters.push(...chars);
    word.replaceChildren(...chars);
  });

  gsap.set(titleLine, { clipPath: 'ellipse(20% 0% at 50% 100%)' });
  gsap.set(letters, { yPercent: 40 });

  /* The signature, drawn by the same pen the other pages use. The still mask
     goes at once, or it would show whole and then vanish to be written. */
  const pen = { p: 0 };
  let signature: Signature | null = null;
  let live = true;
  signHost.classList.add('is-writing');
  fetch('/assets/brand/signature.svg')
    .then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    })
    .then((markup) => {
      if (!live) return;
      const ink = getComputedStyle(signHost).getPropertyValue('--grey-on-track').trim();
      signature = new Signature(signHost, markup, ink);
      signature.progress = pen.p;
    })
    .catch((err: unknown) => {
      // Decorative: the still mask comes back and the header is complete.
      console.error('[off-track] signature failed to load', err);
      signHost.classList.remove('is-writing');
    });
  const sized = new ResizeObserver(() => signature?.resize());
  sized.observe(signHost);

  const entrance = gsap
    .timeline({ paused: true })
    .to(titleLine, {
      clipPath: 'ellipse(100% 120% at 50% 100%)',
      duration: 1.5,
      ease: 'power2.inOut',
    }, HERO_CUE)
    .to(letters, {
      yPercent: 0,
      duration: 1.5,
      ease: 'power2.inOut',
      stagger: { amount: 0.015 * letters.length, from: 'center' },
    }, HERO_CUE)
    .to(pen, {
      p: 1,
      duration: 1.4,
      ease: 'sine.inOut',
      onUpdate: () => {
        if (signature) signature.progress = pen.p;
      },
    }, HERO_CUE);

  void document.fonts.ready.then(() => entrance.play());

  return () => {
    live = false;
    entrance.kill();
    sized.disconnect();
    signature?.dispose();
    signHost.classList.remove('is-writing');
    words.forEach((word, i) => {
      word.textContent = texts[i] ?? '';
    });
    gsap.set(titleLine, { clearProps: 'clipPath' });
  };
});

/* ------------------------------------------------------------------ *
 * The flying picture's layers
 *
 * Ten photographs stacked in the frame, the first on top. The flight below
 * shows one at a time by scroll progress; at rest only the first shows.
 * ------------------------------------------------------------------ */

{
  const flight = must('[data-flight]');
  flight.replaceChildren(
    ...hero.flight.map((photo, i) => {
      const img = el('img', 'oft-flight__layer');
      img.src = photo.src;
      img.width = photo.width;
      img.height = photo.height;
      img.alt = '';
      img.decoding = 'async';
      img.loading = i === 0 ? 'eager' : 'lazy';
      return img;
    }),
  );
}

mountSocials();

/* ------------------------------------------------------------------ *
 * Chrome, reveals, and the entrance
 * ------------------------------------------------------------------ */

mountChrome();

mountReveals({
  immediate: '.oft-hero',
  whenReady: (run) => void document.fonts.ready.then(() => gsap.delayedCall(HERO_CUE, run)),
});

void document.fonts.ready.then(() => {
  document.body.classList.add('is-ready');
  ScrollTrigger.refresh();
});
