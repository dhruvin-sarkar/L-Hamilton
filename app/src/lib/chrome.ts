/**
 * The site chrome: the monogram, the store button, the rolling button labels,
 * the menu button's morph and the menu panel itself.
 *
 * MOVED here verbatim from main.ts rather than rewritten. Every one of these
 * surfaces sits in `partials/nav.html` or `partials/menu.html`, which all four
 * pages include, so the behaviour has to be shared for exactly the same reason
 * the markup is: a second copy would drift from the first, and the timings
 * below are fitted to per-frame measurements of the reference that nobody
 * should have to re-derive per page.
 *
 * Everything is defensive about its own markup — each mount returns early if
 * its elements are absent — so a page that includes the nav but not the menu,
 * or vice versa, is fine.
 */

import { gsap, mm, reducedMotion, ScrollTrigger, WIDE_AND_ANIMATED } from './motion';
import { mountTransition } from './transition';

/* ------------------------------------------------------------------ *
 * Monogram
 *
 * The reference drives this slot with a Rive animation. This is the SVG + GSAP
 * equivalent: the mark is filled by one gradient spanning the whole viewBox in
 * user space, and activating it raises the boundary between the two stops from
 * the bottom of the glyph to the top. Because the gradient is shared across all
 * three paths, that reads as a single level rising through the mark rather than
 * three shapes changing colour together — which is the difference between a
 * liquid fill and a hover state.
 * ------------------------------------------------------------------ */

/** The distance between the two stops. That gap IS the meniscus. */
const LIQUID_GAP = 0.05;

/**
 * The liquid fill, shared by the monogram, the store button and the menu
 * button. A level rises through the element on activation and drains back off
 * it, carrying a meniscus — two colour stops a constant LIQUID_GAP apart — so
 * the change reads as one surface travelling rather than a colour swap.
 *
 * The level runs from -LIQUID_GAP to 1, NOT 0 to 1. At 0 the meniscus sits
 * exactly on the bottom edge, leaving a sliver of the fill colour showing at
 * rest; parking it one gap lower puts it fully outside the shape. (SVG clamps
 * stop offsets into 0..1, so out-of-range values resolve to a flat single
 * colour at each end, which is precisely what is wanted.)
 *
 * Each caller supplies its own `apply`, because the three surfaces express a
 * level differently — SVG stop offsets for the two marks, a custom property for
 * the HTML button — but the physics is defined once, here.
 */
function mountLiquidFill(root: Element, apply: (level: number) => void): void {
  const state = { level: -LIQUID_GAP };
  const push = () => apply(state.level);
  push();

  const to = (active: boolean) => {
    gsap.killTweensOf(state);
    const level = active ? 1 : -LIQUID_GAP;
    if (reducedMotion) {
      // No travel, but the state change still has to be perceivable — snap the
      // level past the shape so the colour flips outright.
      state.level = level;
      push();
      return;
    }
    gsap.to(state, {
      level,
      // Filling is the expressive direction, so it gets the longer, softer
      // curve; draining is quicker and plainer, the way liquid actually falls
      // back faster than it climbs.
      duration: active ? 0.62 : 0.38,
      ease: active ? 'power3.out' : 'power2.in',
      onUpdate: push,
    });
  };

  // Pointer and keyboard both count as activation. A control that only responds
  // to a mouse is invisible to anyone tabbing through the nav.
  root.addEventListener('pointerenter', () => to(true));
  root.addEventListener('pointerleave', () => to(false));
  root.addEventListener('focus', () => to(true));
  root.addEventListener('blur', () => to(false));
}

/** Drives a pair of SVG gradient stops from one level. */
function stopPair(fill: SVGStopElement, base: SVGStopElement): (level: number) => void {
  return (level) => {
    fill.setAttribute('offset', String(level));
    base.setAttribute('offset', String(level + LIQUID_GAP));
  };
}

function mountMonogram(): void {
  const root = document.querySelector<HTMLAnchorElement>('.monogram');
  const fill = document.querySelector<SVGStopElement>('.monogram__stop-fill');
  const base = document.querySelector<SVGStopElement>('.monogram__stop-base');
  if (!root || !fill || !base) return;
  mountLiquidFill(root, stopPair(fill, base));
}

function mountStoreFill(): void {
  const store = document.querySelector<HTMLAnchorElement>('.store');
  if (!store) return;
  // The HTML button expresses the level as a CSS gradient stop position rather
  // than an SVG offset, but it is the same level on the same curve.
  mountLiquidFill(store, (level) => store.style.setProperty('--liquid-level', String(level)));
}

/**
 * Every Rosso button below the nav: the two On Track / Off Track arrows, the
 * callout under the helmet wall (and On Track's store callout, the same
 * component), and On Track's buttons.
 *
 * Same fill as the store button, mounted the same way — these are the only
 * other Rosso buttons on the site, so they should answer the pointer the way
 * the nav does rather than with a hover of their own invention. Each gets its
 * own state, so hovering one never moves another.
 */
function mountSectionFills(): void {
  const buttons = document.querySelectorAll<HTMLAnchorElement>(
    '.callout__link, .store-cta__link, .footer-cta__link',
  );
  for (const link of buttons) {
    mountLiquidFill(link, (level) => link.style.setProperty('--liquid-level', String(level)));
  }
}


/* ------------------------------------------------------------------ *
 * Rolling button text
 *
 * Reverse-engineered off the reference's own STORE button rather than guessed.
 * Its label lives in a wrapper with `overflow: clip` exactly one line tall,
 * holding one `<span class="char">` per letter at `display: inline-block`. On
 * hover each char animates transform translateY(0 -> -100%), staggered left to
 * right: sampled mid-tween the offsets read -20.77, -20.38, -19.91, -19.34,
 * -18.67px, so the first letter leads and each one after trails a little. It
 * settles at exactly -100% of the line box.
 *
 * The split happens here rather than in the markup so the HTML keeps a plain,
 * readable label and the accessible name stays a single text node — a screen
 * reader announcing five separate character nodes is not a label, which is why
 * the visible copy is aria-hidden and an sr-only twin carries the real name.
 * ------------------------------------------------------------------ */

function mountRollingText(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-split-chars]');

  for (const el of targets) {
    const label = el.textContent ?? '';
    if (!label) continue;

    const buildLine = (modifier: string) => {
      const line = document.createElement('span');
      line.className = `btn-text__line${modifier}`;
      for (const ch of label) {
        const span = document.createElement('span');
        span.className = 'char';
        // Non-breaking space, so a gap between words survives becoming its own
        // inline-block.
        span.textContent = ch === ' ' ? ' ' : ch;
        line.appendChild(span);
      }
      return line;
    };

    const outgoing = buildLine('');
    const incoming = buildLine(' btn-text__line--in');
    el.textContent = '';
    el.append(outgoing, incoming);

    const outChars = [...outgoing.children] as HTMLElement[];
    const inChars = [...incoming.children] as HTMLElement[];

    // The button, not the label, owns the hover — the label is inline and its
    // box does not cover the padding the user is actually pointing at.
    const button = el.closest<HTMLElement>('a, button') ?? el;

    if (reducedMotion) {
      // No roll. The incoming copy would otherwise sit permanently below the
      // clip, so drop it and leave a plain static label.
      incoming.remove();
      continue;
    }

    gsap.set(inChars, { yPercent: 0 });

    const roll = (active: boolean) => {
      gsap.killTweensOf([...outChars, ...inChars]);
      const opts = {
        duration: 0.75,
        /* expo.out, NOT the site's cubic-bezier(0.65, 0.05, 0, 1).
         *
         * Passing that string to GSAP does nothing useful — parsing a raw
         * cubic-bezier needs the CustomEase plugin, so it silently falls back
         * to the default power1.out. That was measurable rather than
         * theoretical: at 260ms our first char sat at 56.5% of travel and
         * 1-(1-0.347)^2 is 57.4%, which is exactly power1.out. The reference
         * was at 94% by the same moment. expo.out gives ~91% there, so it
         * tracks the real curve closely without pulling in a plugin. */
        ease: 'expo.out',
        /* Solved for, not picked. Normalised against total travel, the
         * reference's spread across five letters is 9.5%. 24ms gave 18.5% and
         * 12ms gave 5.3%, so interpolating between the two measured points
         * lands here. */
        stagger: 0.016,
      };
      gsap.to(outChars, { ...opts, yPercent: active ? -100 : 0 });
      gsap.to(inChars, { ...opts, yPercent: active ? -100 : 0 });
    };

    button.addEventListener('pointerenter', () => roll(true));
    button.addEventListener('pointerleave', () => roll(false));
    button.addEventListener('focus', () => roll(true));
    button.addEventListener('blur', () => roll(false));
  }
}


/* ------------------------------------------------------------------ *
 * Menu button
 *
 * The reference drives this slot with a Rive state machine, which we cannot
 * reproduce, so it is rebuilt as SVG paths morphed by GSAP. Its resting
 * geometry is measured off the reference's artboard rather than guessed: a 66px
 * icon inside an 80px target, two ~16.3-unit bars at y 29.2 and 38.8, staggered
 * +/-6.05 either side of centre. The bars are EQUAL LENGTH and offset
 * horizontally — an earlier pass here had them as unequal lengths, which is
 * what it looks like at a glance but is not what the artboard does.
 *
 * Opening takes each bar straight to one diagonal of an X, in a single move.
 *
 * Both states are generated below as FOUR CUBIC SEGMENTS, always. That is the
 * load-bearing detail: MorphSVGPlugin maps anchor i of one path to anchor i of
 * the next, so giving both the same command structure makes the correspondence
 * something we choose rather than something the plugin guesses. It is also what
 * keeps the motion clean — lerping between two straight lines whose anchors are
 * evenly spaced yields a straight line at every intermediate step, so each bar
 * stays a bar the whole way across and simply translates and rotates into
 * place. Mismatched structures would let it bow mid-flight.
 * ------------------------------------------------------------------ */


/** Every generated path uses this many cubic segments. See the note above. */
const PATH_SEGMENTS = 4;

interface Pt {
  x: number;
  y: number;
}

/** An anchor with its two absolute control handles. */
interface PathNode {
  p: Pt;
  in: Pt;
  out: Pt;
}

/* The whole icon's shape, in the 66-unit viewBox. These are the numbers to turn
   while tuning: everything else is derived from them. */
const MENU_ICON = {
  box: 66,
  /** Mean of the reference's two measured bars (15.9 and 16.7). */
  barLength: 16.3,
  /** Horizontal offset of each bar from centre; the reference's is +/-6.05. */
  barStagger: 6.05,
  /** Measured bar centres. */
  barY: [29.2, 38.8],
  /** Half-extent of the X along each axis, so each arm is this * sqrt(2) long. */
  crossReach: 7.6,
} as const;

function emitPath(nodes: PathNode[]): string {
  const round = (v: number) => (Math.round(v * 100) / 100).toString();
  const head = nodes[0];
  if (!head) throw new Error('emitPath: no nodes');

  let d = `M${round(head.p.x)} ${round(head.p.y)}`;
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const cur = nodes[i];
    if (!prev || !cur) throw new Error('emitPath: sparse nodes');
    d +=
      `C${round(prev.out.x)} ${round(prev.out.y)}` +
      ` ${round(cur.in.x)} ${round(cur.in.y)}` +
      ` ${round(cur.p.x)} ${round(cur.p.y)}`;
  }
  return d;
}

/** A straight line, but spent across PATH_SEGMENTS cubics so it can morph. */
function lineNodes(a: Pt, b: Pt): PathNode[] {
  // A cubic is straight when its handles lie a third of the way along it.
  const h: Pt = { x: (b.x - a.x) / PATH_SEGMENTS / 3, y: (b.y - a.y) / PATH_SEGMENTS / 3 };
  return Array.from({ length: PATH_SEGMENTS + 1 }, (_, i) => {
    const t = i / PATH_SEGMENTS;
    const p: Pt = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    return { p, in: { x: p.x - h.x, y: p.y - h.y }, out: { x: p.x + h.x, y: p.y + h.y } };
  });
}

/** The two states, as [bar1, bar2] pairs. */
function menuIconPaths(): { idle: [string, string]; cross: [string, string] } {
  const { box, barLength, barStagger, barY, crossReach } = MENU_ICON;
  const c = box / 2;
  const half = barLength / 2;

  const bar = (index: 0 | 1): string => {
    const xc = c + (index === 0 ? barStagger : -barStagger);
    const y = barY[index];
    return emitPath(lineNodes({ x: xc - half, y }, { x: xc + half, y }));
  };

  // Bar 1 takes the top-left to bottom-right diagonal, bar 2 the other, so each
  // travels to the arm nearer its resting position rather than crossing over.
  const cross: [string, string] = [
    emitPath(
      lineNodes({ x: c - crossReach, y: c - crossReach }, { x: c + crossReach, y: c + crossReach }),
    ),
    emitPath(
      lineNodes({ x: c + crossReach, y: c - crossReach }, { x: c - crossReach, y: c + crossReach }),
    ),
  ];

  return { idle: [bar(0), bar(1)], cross };
}

interface MenuIcon {
  setOpen(open: boolean): void;
}

function mountMenuButton(): MenuIcon | null {
  const btn = document.querySelector<HTMLButtonElement>('.menu-btn');
  const bar1 = document.querySelector<SVGPathElement>('[data-menu-bar="1"]');
  const bar2 = document.querySelector<SVGPathElement>('[data-menu-bar="2"]');
  if (!btn || !bar1 || !bar2) return null;

  const { idle, cross } = menuIconPaths();

  // Write the generated idle state over the markup's fallback, so the morph's
  // starting point is bit-identical to what the generator produces. Hand-copied
  // path data in the HTML would drift the moment MENU_ICON is tuned.
  bar1.setAttribute('d', idle[0]);
  bar2.setAttribute('d', idle[1]);

  /* Two independent systems, and they cannot conflict — not by careful
     sequencing, but because they touch disjoint properties. The liquid fill
     owns the gradient's stop offsets; the morph owns the path data. So hovering
     an already-open button cannot disturb the X, and opening an already-hovered
     one cannot reset the fill. Nothing has to be reconciled. */

  const fill = document.querySelector<SVGStopElement>('.menu-btn__stop-fill');
  const base = document.querySelector<SVGStopElement>('.menu-btn__stop-base');
  if (fill && base) {
    const applyStops = stopPair(fill, base);
    mountLiquidFill(btn, (level) => {
      applyStops(level);
      // The small bar shift rides the same level, so it is impossible for the
      // colour and the movement to fall out of step.
      btn.style.setProperty('--menu-hover', String(Math.min(Math.max(level, 0), 1)));
    });
  }

  // One move, bars straight to the X. `power2.inOut` because the bars have real
  // distance to cover: easing both ends keeps the departure and the arrival
  // soft, which is what reads as fluid rather than mechanical.
  const duration = reducedMotion ? 0.001 : 0.62;
  const toggle = gsap
    .timeline({ paused: true })
    .to(bar1, { morphSVG: cross[0], duration, ease: 'power2.inOut' }, 0)
    .to(bar2, { morphSVG: cross[1], duration, ease: 'power2.inOut' }, 0)
    // Same duration and ease as the morph, so the shift decays exactly as the
    // diagonals form rather than trailing them.
    .to(btn, { '--menu-open': 1, duration, ease: 'power2.inOut' }, 0);

  return {
    setOpen(open: boolean) {
      // Reversing rather than re-tweening is why this is a paused timeline: a
      // click mid-morph turns around from wherever it actually is, instead of
      // jumping to the end and animating back.
      if (open) toggle.play();
      else toggle.reverse();
    },
  };
}


/* ------------------------------------------------------------------ *
 * Mount everything. Call once per page, after the DOM is parsed.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Inert links
 *
 * Sixteen links across the menu, the socials block and the footer stand in for
 * destinations that do not exist yet — the two remaining pages, and the social
 * profiles. They carry href="#" so they keep a link's appearance, focus ring
 * and keyboard semantics, but nothing stops the default: clicking or pressing
 * Enter on any of them throws the reader back to the top of the page, which on
 * a 17,000px document is the most destructive thing a stray click can do.
 *
 * Here rather than in an entry point, because the links arrive with the chrome
 * this module mounts. It lived in main.ts, and On Track rendered the same
 * sixteen links without it — measured: a click in the footer at 16,668px landed
 * the reader at 0.
 *
 * One delegated listener rather than sixteen, and preventDefault only — the
 * link stays focusable and announced, it simply no longer goes anywhere. Give
 * one a real href and it starts working with no other change.
 * ------------------------------------------------------------------ */

function mountInertLinks(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (target?.closest('[data-placeholder-href]')) event.preventDefault();
  });
}

/* ------------------------------------------------------------------ *
 * Nav settle
 *
 * The reference sets its brand and its button pair to scale 1.2 at the top of
 * every page and scrubs them back to 1 over the first tenth of a screen, on
 * power2.out (L$() in lando-gl.js, against a 10vh `.top-marker`). Only above
 * 991px; below it they sit at 1. The factor goes on --nav-shrink, which the
 * wordmark and the topbar already multiply into their transforms.
 * ------------------------------------------------------------------ */

function mountNavSettle(): void {
  const nav = document.querySelector<HTMLElement>('.nav-inner');
  if (!nav) return;

  mm.add(WIDE_AND_ANIMATED, () => {
    const settle = (progress: number): void => {
      const eased = 1 - (1 - progress) ** 3; // GSAP's power2.out
      nav.style.setProperty('--nav-shrink', String(1.2 - 0.2 * eased));
    };

    ScrollTrigger.create({
      start: 0,
      end: () => window.innerHeight * 0.1,
      invalidateOnRefresh: true,
      onUpdate: (self) => settle(self.progress),
      onRefresh: (self) => settle(self.progress),
    });

    return () => nav.style.removeProperty('--nav-shrink');
  });
}

/* ------------------------------------------------------------------ *
 * Monogram park
 *
 * The reference's centre mark leaves as soon as the page does. The same
 * function that settles its nav switches the LN4 Rive's `logo-active` input
 * off the moment the reader scrolls and back on at the very top, on every page
 * and at every width (onEnter/onLeaveBack of the `.top-marker` trigger above
 * 991px, `scrollY <= 10` below it). Sampled off its canvas, the exit collapses
 * the mark to a point a little left of and below its centre over ~0.6s, and
 * the return draws it back down from its top edge over ~0.8s.
 *
 * One ten-pixel rule at every width rather than the reference's two: the
 * difference is less than a single notch of the wheel. Clipped rather than
 * faded, because opacity already belongs to the hero entrance and the menu;
 * `inert` takes the invisible link out of the tab order and hit-testing.
 * ------------------------------------------------------------------ */

const MONOGRAM_PARKED = 'inset(55% 58% 45% 42%)';
const MONOGRAM_DRAW_FROM = 'inset(0% 76% 100% 23%)';
const MONOGRAM_SHOWN = 'inset(0% 0% 0% 0%)';

function mountMonogramPark(): void {
  const monogram = document.querySelector<HTMLElement>('.nav-inner .monogram');
  if (!monogram) return;

  let parked: boolean | null = null;

  const update = (): void => {
    const next = window.scrollY > 10;
    if (next === parked) return;
    // The first call only records where the page loaded, so a mid-page reload
    // starts parked instead of playing the exit.
    const animate = parked !== null && !reducedMotion;
    parked = next;
    monogram.inert = next;
    gsap.killTweensOf(monogram);

    if (!animate) {
      gsap.set(monogram, next ? { clipPath: MONOGRAM_PARKED } : { clearProps: 'clipPath' });
    } else if (next) {
      gsap.fromTo(
        monogram,
        { clipPath: MONOGRAM_SHOWN },
        { clipPath: MONOGRAM_PARKED, duration: 0.6, ease: 'power2.in' },
      );
    } else {
      // Cleared at the end, so the liquid fill's overshoot is not clipped at rest.
      gsap.fromTo(
        monogram,
        { clipPath: MONOGRAM_DRAW_FROM },
        { clipPath: MONOGRAM_SHOWN, duration: 0.8, ease: 'power2.out', clearProps: 'clipPath' },
      );
    }
  };

  update();
  window.addEventListener('scroll', update, { passive: true });
}

/* ------------------------------------------------------------------ *
 * Scroll indicator
 *
 * The reference's qZ() in lando-gl.js, which listens to the window's scroll:
 *   - the bar is clamp(10%, viewport / document, 25%) of the track;
 *   - on scroll the track fades up (autoAlpha 1, 0.5s) and the bar eases to
 *     progress x (track - bar) over 0.3s on power2.out;
 *   - 500ms after the last scroll event the track fades out again (0.5s).
 * The size is re-read as each scroll starts rather than only on resize: these
 * pages grow as their images and scenes arrive, and a bar sized against the
 * document as it was at load under-reports the page.
 * ------------------------------------------------------------------ */

const SCROLL_IDLE_MS = 500;

function mountScrollIndicator(): void {
  const track = document.querySelector<HTMLElement>('.scroll-indicator');
  const bar = track?.querySelector<HTMLElement>('.scroll-indicator__bar');
  if (!track || !bar) return;

  const fade = reducedMotion ? 0 : 0.5;
  const moveBar = gsap.quickTo(bar, 'y', { duration: reducedMotion ? 0 : 0.3, ease: 'power2.out' });
  let shown = false;
  let idle = 0;
  let share = 10;

  const measure = (): void => {
    const doc = document.documentElement.scrollHeight;
    share = gsap.utils.clamp(10, 25, (window.innerHeight / doc) * 100);
    bar.style.blockSize = `${share}%`;
  };

  const target = (): number => {
    const range = document.documentElement.scrollHeight - window.innerHeight;
    const progress = range > 0 ? window.scrollY / range : 0;
    return progress * track.offsetHeight * (1 - share / 100);
  };

  measure();
  gsap.set(bar, { y: target() });

  window.addEventListener(
    'scroll',
    () => {
      if (!shown) {
        shown = true;
        measure();
        gsap.to(track, { autoAlpha: 1, duration: fade, overwrite: 'auto' });
      }
      moveBar(target());
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        shown = false;
        gsap.to(track, { autoAlpha: 0, duration: fade, overwrite: 'auto' });
      }, SCROLL_IDLE_MS);
    },
    { passive: true },
  );
  window.addEventListener('resize', () => {
    measure();
    gsap.set(bar, { y: target() });
  });
}

/* ------------------------------------------------------------------ *
 * Landscape block
 *
 * CSS decides when it shows (see chrome.css); this only runs the wheel's
 * steering while it does, on the shared matchMedia context so it starts and
 * stops with the block. The reference's Rive loop, read frame by frame: the
 * wheel sits level, steers one way and holds, sweeps back a little past level,
 * and settles — about 2.7s round. Reduced motion leaves the wheel level.
 * ------------------------------------------------------------------ */

const LANDSCAPE_QUERY =
  '(orientation: landscape) and (max-height: 540px) and (hover: none) and (pointer: coarse) and (prefers-reduced-motion: no-preference)';

function mountLandscapeSteer(): void {
  const steer = document.querySelector<SVGGElement>('.landscape-block__steer');
  if (!steer) return;
  mm.add(LANDSCAPE_QUERY, () => {
    const tl = gsap
      .timeline({ repeat: -1, repeatDelay: 0.4 })
      .to(steer, { rotation: -14, duration: 0.3, ease: 'power2.inOut', svgOrigin: '100 110' }, 0.4)
      .to(steer, { rotation: 8, duration: 0.4, ease: 'power2.inOut', svgOrigin: '100 110' }, 1.3)
      .to(steer, { rotation: 0, duration: 0.3, ease: 'power2.inOut', svgOrigin: '100 110' }, 1.9);
    return () => {
      tl.kill();
      gsap.set(steer, { clearProps: 'transform' });
    };
  });
}

export function mountChrome(): void {
  /* The menu is mounted further down; the transition only needs to be able to
     shut it, and only once a link is followed, by which time it exists. */
  let closeMenu = (): void => {};

  // Inert links first: the transition skips any click already prevented, so
  // the placeholder links' listener has to be registered before its own.
  mountInertLinks();
  mountTransition({ closeMenu: () => closeMenu() });
  mountScrollIndicator();
  mountLandscapeSteer();
  mountNavSettle();
  mountMonogramPark();

  mountMonogram();
  mountStoreFill();
  mountSectionFills();
  mountRollingText();

  /* ------------------------------------------------------------------ *
   * Menu
   * ------------------------------------------------------------------ */

  const menu = document.querySelector<HTMLDivElement>('#menu');
  const menuBtn = document.querySelector<HTMLButtonElement>('.menu-btn');
  const menuIcon = mountMenuButton();
  const menuLabel = document.querySelector<HTMLSpanElement>('[data-menu-label]');
  const navInner = document.querySelector<HTMLElement>('.nav-inner');

  if (menu && menuBtn) {
    /* The reveal cascade, read out of the reference's own menu timeline in
     * lando-gl.js rather than fitted to samples. Seconds:
     *
     *   group       at     for    curve
     *   overlay     0      0.8    power3.out
     *   tiles       0.15   0.8    power3.out, 0.06 apart, rising 25px
     *   links       0.35   0.6    back.out(1.2), 0.08 apart, rising 20px
     *   mark        0.4    0.6    power2.inOut
     *   highlights  0.5    0.7    back.out(1.1), 0.04 apart, wiping in from the
     *                             left with a 15px rise
     *   their bars  0.7    0.6    power2.inOut, 0.05 apart
     *   backdrop    0.6    0.6    GSAP's default curve, up to its resting strength
     *
     * Every group opens the same ellipse (home.css) on its own delay and curve.
     * The links' back ease is what makes them land rather than slide. It closes
     * by running the same timeline backwards at 1.5x.
     *
     * `at` is kept OUT of the tween objects rather than stripped at the call
     * site. Spreading a config that carried it put `at` among the tween vars,
     * where GSAP has no such property — it warned on every tween and tried to
     * animate a name that does not exist. Splitting the shape makes it
     * unrepresentable. */
    const MENU_REVEAL = {
      overlay: { at: 0, tween: { duration: 0.8, ease: 'power3.out' } },
      tiles: { at: 0.15, tween: { duration: 0.8, ease: 'power3.out', stagger: 0.06 } },
      links: { at: 0.35, tween: { duration: 0.6, ease: 'back.out(1.2)', stagger: 0.08 } },
      mark: { at: 0.4, tween: { duration: 0.6, ease: 'power2.inOut' } },
      highlights: { at: 0.5, tween: { duration: 0.7, ease: 'back.out(1.1)', stagger: 0.04 } },
      bars: { at: 0.7, tween: { duration: 0.6, ease: 'power2.inOut', stagger: 0.05 } },
      backdrop: { at: 0.6, tween: { duration: 0.6 } },
    } as const;
    const MENU_CLOSE_SPEED = 1.5;

    // In page order, not column order: the reference staggers its tiles by the
    // page each belongs to, so they arrive interleaved across the two columns.
    const tiles = [...menu.querySelectorAll<HTMLElement>('[data-menu-tile]')].sort(
      (a, b) => Number(a.dataset.menuTile) - Number(b.dataset.menuTile),
    );
    const links = menu.querySelectorAll<HTMLAnchorElement>('.menu__link');
    // The team line and the footer links, which wipe in as one group.
    const highlights = menu.querySelectorAll<HTMLElement>('[data-menu-highlight]');
    const images = menu.querySelector<HTMLElement>('.menu__images');
    const backdrop = menu.querySelector<HTMLElement>('.menu__bg');
    const mark = menu.querySelector<SVGPathElement>('.menu__link-mark path');

    /* Tiles answer the link under the pointer, on the reference's timings: the
       pointed-at tile comes up in 0.2s, the others drop out in 0.3s. Leaving a
       link waits 50ms before settling back, so running the pointer down the
       list goes straight from one tile to the next without flashing the resting
       arrangement in between. At rest the current page's tile is part-lit and
       the rest are dark, so the collage is never entirely flat. */
    const TILE_REST = 0.5;
    const TILE_LEAVE_DELAY_MS = 50;
    const currentTile = menu.querySelector<HTMLAnchorElement>('.menu__link.is-current')?.dataset
      .menuLink;
    let litTile: string | null = null;
    let onLink = false;

    const fadeTile = (tile: HTMLElement, lit: number, tween: gsap.TweenVars) => {
      if (reducedMotion) tile.style.setProperty('--tile-lit', String(lit));
      else gsap.to(tile, { '--tile-lit': lit, ...tween, overwrite: 'auto' });
    };
    const lightTile = (page: string) => {
      litTile = page;
      for (const tile of tiles) {
        if (tile.dataset.menuTile === page) fadeTile(tile, 1, { duration: 0.2, ease: 'power2.inOut' });
        else fadeTile(tile, 0, { duration: 0.3 });
      }
    };
    const restTiles = () => {
      litTile = null;
      for (const tile of tiles) {
        const lit = tile.dataset.menuTile === currentTile ? TILE_REST : 0;
        fadeTile(tile, lit, { duration: 0.2, ease: 'power2.inOut' });
      }
    };

    for (const link of links) {
      const page = link.dataset.menuLink;
      if (page === undefined) continue;
      const enter = () => {
        onLink = true;
        lightTile(page);
      };
      const leave = () => {
        onLink = false;
        window.setTimeout(() => {
          if (!onLink && litTile === page) restTiles();
        }, TILE_LEAVE_DELAY_MS);
      };
      link.addEventListener('pointerenter', enter);
      link.addEventListener('focus', enter);
      link.addEventListener('pointerleave', leave);
      link.addEventListener('blur', leave);
    }
    menu.addEventListener('pointerleave', () => {
      onLink = false;
      restTiles();
    });

    /* Modal while it is open: the page behind the panel can take neither focus
       nor a screen reader's cursor. The nav is left live, because the close
       button is in it. */
    const behindPanel = [document.querySelector('main'), document.querySelector('footer')];
    const setBehindInert = (inert: boolean) => {
      for (const el of behindPanel) if (el) el.inert = inert;
    };

    /* Cursor-height parallax: the two columns counter-slide as the pointer moves
       up and down, +/-6rem at the edges of the viewport and zero at its middle,
       easing over 2s — the reference's own numbers. Only while the menu is open.

       quickTo rather than a tween per event: it retargets a single running tween
       instead of spawning one per pointermove. */
    const followParallax =
      images && !reducedMotion
        ? gsap.quickTo(images, '--menu-parallax', { duration: 2, ease: 'power2.out' })
        : null;
    if (followParallax) {
      // Passive, like the page's other pointermove listeners: this never calls
      // preventDefault, and saying so lets the browser skip waiting on it.
      window.addEventListener(
        'pointermove',
        (e) => {
          if (menu.hidden) return;
          followParallax(1 - (2 * e.clientY) / window.innerHeight);
        },
        { passive: true },
      );
    }

    const reveal = gsap.timeline({
      paused: true,
      // Only take it out of the layout once it has finished closing. Setting
      // `hidden` any earlier would kill the animation mid-flight, because
      // `display: none` stops the clip-path from rendering at all.
      onReverseComplete: () => {
        menu.hidden = true;
        setBehindInert(false);
        document.documentElement.removeAttribute('data-menu-open');
        // The columns go back to centre for the next opening. The reference
        // eases them there, but the panel is already gone, so it is the same.
        followParallax?.(0, 0);
      },
    });

    if (!reducedMotion) {
      /* Each highlighted line wipes in under a bar of the brand colour, which
         then retracts to the right and leaves the type behind it. The bars
         only exist when there is a timeline to run them. */
      const bars = [...highlights].map((line) => {
        const bar = document.createElement('span');
        bar.className = 'menu__highlight-bar';
        bar.setAttribute('aria-hidden', 'true');
        line.append(bar);
        return bar;
      });

      reveal
        .to(menu, { '--menu-p': 1, ...MENU_REVEAL.overlay.tween }, MENU_REVEAL.overlay.at)
        .fromTo(
          tiles,
          { '--tile-p': 0, y: 25 },
          { '--tile-p': 1, y: 0, ...MENU_REVEAL.tiles.tween },
          MENU_REVEAL.tiles.at,
        )
        .fromTo(
          links,
          { '--link-p': 0, y: 20 },
          { '--link-p': 1, y: 0, ...MENU_REVEAL.links.tween },
          MENU_REVEAL.links.at,
        )
        .fromTo(
          highlights,
          { '--wipe': 0, y: 15 },
          { '--wipe': 1, y: 0, ...MENU_REVEAL.highlights.tween },
          MENU_REVEAL.highlights.at,
        )
        .fromTo(bars, { scaleX: 1 }, { scaleX: 0, ...MENU_REVEAL.bars.tween }, MENU_REVEAL.bars.at);

      if (backdrop) {
        // Up to the strength the stylesheet gives it, so that stays in one place.
        const rest = Number(getComputedStyle(backdrop).opacity);
        reveal.fromTo(
          backdrop,
          { opacity: 0 },
          { opacity: rest, ...MENU_REVEAL.backdrop.tween },
          MENU_REVEAL.backdrop.at,
        );
      }

      if (mark) {
        // Dash the path with its OWN length so the line draws on rather than
        // fading in. Measured from the path, never hardcoded: the number changes
        // the moment the path or the viewport does.
        const length = mark.getTotalLength();
        gsap.set(mark, { strokeDasharray: length, strokeDashoffset: length });
        reveal.to(mark, { strokeDashoffset: 0, ...MENU_REVEAL.mark.tween }, MENU_REVEAL.mark.at);
      }
    }

    const setOpen = (open: boolean) => {
      if (open) menu.hidden = false;
      menuBtn.setAttribute('aria-expanded', String(open));
      menuIcon?.setOpen(open);
      // The monogram fades out with the button's state (home.css) and back in
      // here, over the same 0.4s, as the close starts.
      if (!open && navInner && !reducedMotion) {
        gsap.fromTo(
          navInner,
          { '--menu-mono': 0 },
          { '--menu-mono': 1, duration: 0.4, ease: 'power2.out' },
        );
      }
      // The icon is aria-hidden, so the accessible name is the only thing telling
      // a screen reader what the button will do next. It has to track the state.
      if (menuLabel) menuLabel.textContent = open ? 'Close menu' : 'Open menu';

      // The reference locks the ROOT, not the body — body stays `visible` there
      // and <html> goes to `clip`. Locking the body instead leaves the scrollbar
      // gutter collapsing and shifts the whole layout sideways as it opens.
      document.documentElement.style.overflow = open ? 'clip' : '';
      // That stops the browser scrolling, but not Lenis, which scrolls by
      // script and so is not bound by overflow. Told to leave the wheel and touch
      // alone, it lets the event through to the locked root, which ignores it.
      document.body.toggleAttribute('data-lenis-prevent', open);
      if (open) setBehindInert(true);

      // Drives the nav's own menu-open styling — the centred monogram hides,
      // because over the open panel it sits on the collage and reads as a stray
      // graphic rather than as branding. Set on the way in; on the way out the
      // reveal timeline clears it once the panel has actually gone (and there is
      // no timeline under reduced motion, so clear it here instead).
      if (open) document.documentElement.setAttribute('data-menu-open', '');
      else if (reducedMotion) document.documentElement.removeAttribute('data-menu-open');

      // Back to the resting arrangement each time it opens: the current page's
      // tile part-lit, the rest dark.
      if (open) restTiles();

      if (reducedMotion) {
        if (!open) {
          menu.hidden = true;
          setBehindInert(false);
        }
      } else if (open) {
        reveal.timeScale(1).play();
      } else {
        reveal.timeScale(MENU_CLOSE_SPEED).reverse();
      }

      // Move focus to the panel, not to its first link: browsers treat
      // programmatic focus as :focus-visible, so focusing a link drew a ring on
      // HOME even when the menu was opened by mouse.
      if (open) menu.focus();
      else menuBtn.focus();
    };

    // `hidden` is `boolean | "until-found"` in the DOM lib, and "until-found" is
    // still hidden, so coerce rather than compare against true.
    menuBtn.addEventListener('click', () => setOpen(Boolean(menu.hidden)));

    // A followed link closes it, as the reference's transition does
    // (closeNavigation() at the start of its transition-out).
    closeMenu = () => {
      if (menuBtn.getAttribute('aria-expanded') === 'true') setOpen(false);
    };

    /* The keyboard loop while it is open runs from the first control in the top
       bar (Store, still showing over the panel) through the close button and
       the panel's links, then round again. Everything behind is inert, so this
       only has to close the two ends, which would otherwise run out past the
       footer into the browser's own toolbar. */
    const menuLinks = menu.querySelectorAll<HTMLAnchorElement>('a[href]');
    const loopFirst = menuBtn.closest('.topbar')?.querySelector<HTMLElement>('a[href], button') ?? menuBtn;
    const loopLast = menuLinks[menuLinks.length - 1] ?? menuBtn;

    window.addEventListener('keydown', (e) => {
      if (menu.hidden) return;
      // Escape must close it. An overlay with no keyboard exit is a trap.
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      if (!e.shiftKey && document.activeElement === loopLast) {
        e.preventDefault();
        loopFirst.focus();
      } else if (e.shiftKey && document.activeElement === loopFirst) {
        e.preventDefault();
        loopLast.focus();
      }
    });
  }
}
