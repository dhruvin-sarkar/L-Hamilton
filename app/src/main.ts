import './styles/main.css';
import * as THREE from 'three';
import gsap from 'gsap';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { BackgroundField } from './BackgroundField';
import { HeadScene } from './HeadScene';
import { Signature } from './Signature';
import {
  age,
  careerTotals,
  driver,
  eras,
  seasonsRacing,
} from './content/hamilton';

/** The era he is in now — the one with no end date. */
const currentEra = eras.find((e) => e.to === null);
if (!currentEra) {
  // Fail fast: an eras list where every entry has ended means the data is stale,
  // and silently rendering a blank team line would hide that.
  throw new Error('[content] no ongoing era — eras data is out of date');
}

/* ------------------------------------------------------------------ *
 * Motion preference — read once, honoured everywhere.
 * ------------------------------------------------------------------ */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ *
 * Smooth scroll
 *
 * Config read off the reference: duration 1.2, lerp 0.1, smoothWheel and
 * syncTouch on, wheelMultiplier 1, easing power1.inOut — the same curve its
 * scroll-scrubbed camera uses.
 *
 * ScrollTrigger is driven from Lenis rather than the native scroll event, and
 * Lenis is stepped from gsap's ticker. Otherwise the two keep separate clocks
 * and every scrubbed value lags a frame.
 *
 * Set up before anything that reads it — the marquee couples to scroll velocity.
 * ------------------------------------------------------------------ */

gsap.registerPlugin(MorphSVGPlugin, ScrollTrigger);

/** The smooth-scroll instance, so the marquee can read scroll velocity. */
let lenis: Lenis | null = null;

if (!reducedMotion) {
  const instance = new Lenis({
    duration: 1.2,
    easing: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    lerp: 0.1,
    smoothWheel: true,
    syncTouch: true,
    wheelMultiplier: 1,
  });

  instance.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => instance.raf(time * 1000));
  // gsap's ticker drops a frame's worth of time after a stall; Lenis integrates
  // that gap and lurches. Its own rAF already handles the tab-switch case.
  gsap.ticker.lagSmoothing(0);
  lenis = instance;
}

/* ------------------------------------------------------------------ *
 * Bind stable copy from the data model.
 * The markup ships empty placeholders rather than hardcoded values, so there
 * is exactly one place a number can be wrong.
 * ------------------------------------------------------------------ */

const bindings: Record<string, string> = {
  age: `${age()} y.o`,
  birthplace: driver.birthplace,
  seasons: String(seasonsRacing()),
  team: driver.currentTeam,
  debut: String(driver.debutYear),
  // When he joined the CURRENT team — not his F1 debut. The reference's card
  // reads "mclaren f1 since 2019", which is Norris's tenure at that team, so
  // binding debutYear here would say "ferrari since 2007" and be plainly wrong.
  'team-since': String(currentEra.from),
  // Placeholder until the calendar feed lands. Named honestly rather than
  // filled with a plausible-looking circuit that would read as real.
  'race-name': 'TBC',
};

for (const [key, value] of Object.entries(bindings)) {
  for (const el of document.querySelectorAll(`[data-bind="${key}"]`)) {
    el.textContent = value;
  }
}

/* ------------------------------------------------------------------ *
 * Stat band
 * ------------------------------------------------------------------ */

interface StatDef {
  label: string;
  value: number;
  hero?: boolean;
}

const stats: StatDef[] = [
  { label: 'Championships', value: careerTotals.championships, hero: true },
  { label: 'Wins', value: careerTotals.wins },
  { label: 'Poles', value: careerTotals.poles },
  { label: 'Podiums', value: careerTotals.podiums },
  { label: 'Starts', value: careerTotals.starts },
];

/** Build an element with text content set safely. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const statsGrid = document.querySelector<HTMLUListElement>('#stats-grid');
if (statsGrid) {
  // Built through the DOM rather than innerHTML. These values are static today,
  // but careerTotals is slated to come from a live API — and the moment it does,
  // a template string here becomes an injection sink.
  for (const s of stats) {
    const item = el('li', s.hero ? 'stat stat--hero' : 'stat');
    const value = el('span', 'stat__value', String(reducedMotion ? s.value : 0));
    value.dataset.count = String(s.value);
    item.append(value, el('span', 'stat__label', s.label));
    statsGrid.append(item);
  }
}

/**
 * Career totals are placeholders until the live fetch lands. Say so in the UI
 * rather than rendering zeroes that look like real results — a wrong number
 * presented confidently is worse than an absent one.
 */
const note = document.querySelector<HTMLParagraphElement>('#stats-note');
if (note) {
  note.textContent = careerTotals.verified
    ? `Updated ${new Date(careerTotals.lastUpdated).toLocaleDateString()}`
    : 'Career totals pending live data — championships shown are final.';
}

/* ------------------------------------------------------------------ *
 * Eras
 * ------------------------------------------------------------------ */

const erasList = document.querySelector<HTMLOListElement>('#eras-list');
if (erasList) {
  for (const e of eras) {
    const item = el('li', 'era');
    item.dataset.era = e.id; // drives the --era accent swap in tokens.css
    item.append(
      el('p', 'era__years', `${e.from}–${e.to ?? 'present'}`),
      el('h3', 'era__team', e.team),
      el('p', 'era__blurb', e.blurb),
    );
    erasList.append(item);
  }
}

/* ------------------------------------------------------------------ *
 * Reveal + count-up on scroll into view
 * ------------------------------------------------------------------ */

/** Ease-out count-up driven by rAF rather than a fixed interval, so it tracks
 *  real elapsed time instead of drifting on a busy frame. */
function countUp(el: HTMLElement, duration = 1100): void {
  const target = Number(el.dataset.count ?? 0);
  if (!target) return;
  const start = performance.now();

  const tick = (now: number) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // cubic out, matching --ease-out
    el.textContent = String(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

if (!reducedMotion) {
  const revealer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        revealer.unobserve(entry.target); // reveals fire once
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  for (const el of document.querySelectorAll('.reveal')) revealer.observe(el);

  const counter = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        countUp(entry.target as HTMLElement);
        counter.unobserve(entry.target);
      }
    },
    { threshold: 0.4 },
  );
  for (const el of document.querySelectorAll('[data-count]')) counter.observe(el);
}

/* ------------------------------------------------------------------ *
 * Marquee
 *
 * Content comes from the model, not the markup: the years are the seven title
 * seasons and the teams are the three eras, so neither can drift out of sync
 * with the rest of the page.
 * ------------------------------------------------------------------ */

/** How many copies of the phrase each track holds. */
const MARQUEE_COPIES = 4;

const marquee = document.querySelector<HTMLElement>('.hero-back');
if (marquee) {
  /* PLACEHOLDER. Deliberately not the real career data: the two bands are a
     graphic surface, and hanging championship years off them made the layout
     look decided when the copy is not. Swap for the real line once it exists —
     the loop measures itself, so length does not matter. */
  const rows: Record<string, string[]> = {
    left: ['Placeholder headline', 'Second placeholder'],
    right: ['Lower band copy', 'Another placeholder'],
  };

  for (const row of marquee.querySelectorAll<HTMLElement>('[data-marquee]')) {
    const words = rows[row.dataset.marquee ?? 'left'] ?? [];
    const track = row.querySelector<HTMLElement>('[data-marquee-track]');
    if (!track || words.length === 0) continue;

    // Cursor parallax pushes the two rows opposite ways, so the pair shears
    // rather than sliding as one slab — the same reason they counter-scroll.
    row.style.setProperty('--marquee-dir', row.dataset.marquee === 'right' ? '-1' : '1');

    /* Identical copies side by side. The loop shifts by exactly one of them, so
       copy 2 lands where copy 1 was and the seam is invisible — one copy is the
       pattern's period and the only distance that keeps its phase.
     *
     * Build one, measure it, then take only as many as the shift needs:
     * copyWidth * (copies - 1) >= viewport. A fixed count overshoots badly —
     * four copies of this text made a 14,535px composited layer. */
    const addCopy = () => {
      // Solid throughout. Both of the reference's bands are solid fills; the
      // rows are told apart by colour and typeface.
      for (const word of words) {
        track.append(el('span', 'marquee__item', word), el('span', 'marquee__sep', '/'));
      }
    };

    addCopy();
    const copyWidth = track.scrollWidth;
    /* +1 for the copy that gets shifted out, and never fewer than two — with a
       single copy there is no second one to hand over to at the seam. */
    const copies =
      copyWidth > 0
        ? Math.max(2, Math.ceil(window.innerWidth / copyWidth) + 1)
        : MARQUEE_COPIES;
    for (let i = 1; i < copies; i++) addCopy();

    // Read back by the tween below. Stored on the element rather than passed,
    // because the two loops are built in separate passes over the same rows.
    track.dataset.copies = String(copies);
  }

  // The visible rows are aria-hidden because they repeat themselves several
  // times over. This is the copy a screen reader actually gets.
  const marqueeText = document.querySelector<HTMLElement>('#marquee-text');
  if (marqueeText) {
    marqueeText.textContent =
      `World championships in ${rows.left!.join(', ')}. ` +
      `Teams: ${rows.right!.join(', ')}.`;
  }

  if (!reducedMotion) {
    /* The loop is a GSAP tween, not a CSS animation, because the SCROLL has to
       be able to reach it — a CSS keyframe has no rate you can drive. This is
       the reference's own mechanic: one linear repeating tween per band with
       timeScale coupled to scroll.

       `ease: none` holds the speed constant so the joint never shows up as a
       hesitation. */
    const loops = [...marquee.querySelectorAll<HTMLElement>('[data-marquee]')].map((row) => {
      const track = row.querySelector<HTMLElement>('[data-marquee-track]')!;
      const rightward = row.dataset.marquee === 'right';

      /* One copy's width, as a percentage of the whole track. This is the
         pattern's period, and therefore the ONLY distance the track can travel
         without changing phase — land on it and the loop is seamless, miss it
         and the text jumps at every repeat. */
      const step = 100 / Number(track.dataset.copies ?? MARQUEE_COPIES);

      // Duration derived from WIDTH rather than fixed, or the two bands travel
      // at visibly different speeds whenever their copy differs in length.
      // scrollWidth is the whole track, so scale it to the distance actually
      // covered, otherwise a one-copy shift over a whole-track duration crawls.
      const duration = (track.scrollWidth * (step / 100)) / 90;

      /* The two bands travel opposite ways, and the rightward one has to START
         shifted left by a copy — animating it from 0 to +step would drag empty
         space in behind it from the left edge. Same distance, same period,
         opposite phase. */
      return gsap.fromTo(
        track,
        { xPercent: rightward ? -step : 0 },
        {
          xPercent: rightward ? 0 : -step,
          duration,
          ease: 'none',
          repeat: -1,
        },
      );
    });

    /* Scroll drives the bands: faster scrolling speeds them up, reversing
       reverses them. Clamped, or a flick sends the type past legibility.
     *
     * The event only moves a target; the rate chases it in the ticker. Writing
     * timeScale straight from the event stepped the bands between speeds several
     * times a second, and left them stuck at the last value once scrolling
     * stopped and no further event arrived. */
    let rateTarget = 1;
    let rate = 1;

    lenis?.on('scroll', ({ velocity }: { velocity: number }) => {
      rateTarget = gsap.utils.clamp(-5, 5, 1 + velocity * 0.06);
    });

    gsap.ticker.add(() => {
      // Target decays to rest, so the bands always return to their base speed
      // even if the last scroll event left the target somewhere else.
      rateTarget += (1 - rateTarget) * 0.08;
      rate += (rateTarget - rate) * 0.15;
      // Below a thousandth of base speed the difference is not observable, and
      // skipping it keeps three tween timeScale writes out of an idle frame.
      if (Math.abs(rate - 1) < 0.001 && Math.abs(rateTarget - 1) < 0.001) return;
      for (const t of loops) t.timeScale(rate);
    });

    const runner = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Both ways: a band animating off-screen is work done for nobody.
          for (const t of loops) entry.isIntersecting ? t.play() : t.pause();
        }
      },
      { threshold: 0 },
    );
    runner.observe(marquee);

    /* Cursor parallax. The rows already counter-scroll, so pushing them
       opposite ways on pointer X shears the pair rather than sliding it — the
       text reads as two planes at different depths instead of one slab.

       quickTo retargets one running tween per row instead of spawning a tween
       per pointermove, and the property is a custom prop so the loop keyframes
       keep sole ownership of `transform` on the track inside. */
    const rowEls = marquee.querySelectorAll<HTMLElement>('[data-marquee]');
    const followX = gsap.quickTo(rowEls, '--marquee-cursor', {
      duration: 0.9,
      ease: 'power2.out',
    });
    window.addEventListener(
      'pointermove',
      (e) => {
        followX((e.clientX / window.innerWidth) * 2 - 1);
      },
      { passive: true },
    );
  }
}

/* ------------------------------------------------------------------ *
 * Hero entrance.
 *
 * Delays are assigned here rather than written into CSS so the order follows
 * the markup: reorder the furniture and the sequence follows, with no stylesheet
 * to keep in sync.
 * ------------------------------------------------------------------ */

const heroFurniture = [...document.querySelectorAll<HTMLElement>('.hero-in')];
heroFurniture.forEach((el, i) => {
  el.style.setProperty('--in-delay', `${i * 110}ms`);
});

let readyFired = false;
const readyCallbacks: (() => void)[] = [];

/** Run once the hero is ready — immediately if that has already happened. */
function onReady(fn: () => void): void {
  if (readyFired) fn();
  else readyCallbacks.push(fn);
}

/** Release the entrance. Called once the scene has painted, or on a timeout. */
function markReady(): void {
  if (readyFired) return;
  readyFired = true;
  document.body.classList.add('is-ready');
  for (const fn of readyCallbacks) fn();
  readyCallbacks.length = 0;
}

// Backstop: if the WebGL scene never reports in — no GL context, a failed
// texture — the hero must still appear. Content is never gated on an effect.
setTimeout(markReady, 1200);

/* ------------------------------------------------------------------ *
 * Text reveals — the accent bar sweeping across a line.
 *
 * Staggered by document order within the hero so the card reads top to bottom
 * rather than every line firing at once. CSS owns the animation; this only
 * decides when it starts and how long each line waits.
 * ------------------------------------------------------------------ */

if (!reducedMotion) {
  const lines = [...document.querySelectorAll<HTMLElement>('.reveal-text')];
  const delayFor = (el: HTMLElement) => `${lines.indexOf(el) * 90}ms`;

  /**
   * Hero lines fire with the entrance, NOT on intersection.
   *
   * The observer below uses a negative bottom margin so nothing triggers while
   * still at the very edge of the viewport. Inside the hero that is a trap: the
   * card sits at the bottom of a 100dvh section, so its last line starts inside
   * that dead band and there is no scroll position that ever moves it out. The
   * line stayed at opacity 0 permanently — content lost to an animation that
   * never ran.
   */
  const heroLines = lines.filter((el) => el.closest('.hero'));
  const scrollLines = lines.filter((el) => !el.closest('.hero'));

  for (const line of heroLines) line.style.setProperty('--reveal-delay', delayFor(line));
  onReady(() => {
    for (const line of heroLines) line.classList.add('is-in');
  });

  const textRevealer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        el.style.setProperty('--reveal-delay', delayFor(el));
        el.classList.add('is-in');
        textRevealer.unobserve(el);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const line of scrollLines) textRevealer.observe(line);
}

/* ------------------------------------------------------------------ *
 * Circuit outline — drawn on rather than faded in.
 * ------------------------------------------------------------------ */

const circuit = document.querySelector<SVGPathElement>('.next-race__circuit path');
if (circuit) {
  // Measured from the path itself. Hardcoding a length silently breaks the
  // animation the moment the outline is redrawn for a different circuit.
  const length = circuit.getTotalLength();
  circuit.style.strokeDasharray = String(length);

  if (reducedMotion) {
    circuit.style.strokeDashoffset = '0';
  } else {
    circuit.style.strokeDashoffset = String(length);
    const drawer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          circuit.style.strokeDashoffset = '0';
          drawer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    drawer.observe(circuit);
  }
}

/* ------------------------------------------------------------------ *
 * Cursor — a ring that trails the pointer and swells over targets.
 *
 * Skipped entirely without a fine pointer or with reduced motion: the ring is
 * decorative, and the native cursor is the correct fallback in both cases.
 * ------------------------------------------------------------------ */

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

if (finePointer && !reducedMotion) {
  const ring = document.createElement('div');
  ring.className = 'cursor';
  ring.setAttribute('aria-hidden', 'true');
  const dot = document.createElement('span');
  dot.className = 'cursor__dot';
  ring.append(dot);
  document.body.append(ring);

  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let started = false;

  window.addEventListener(
    'pointermove',
    (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!started) {
        // Jump to the first known position instead of gliding in from 0,0.
        x = targetX;
        y = targetY;
        started = true;
        ring.classList.add('is-active');
      }
      // Swell over anything clickable. Checked on move rather than with
      // per-element listeners so it covers content added later for free.
      const el = e.target as Element | null;
      ring.classList.toggle('is-hovering', Boolean(el?.closest('a, button')));
    },
    { passive: true },
  );

  // The ring must not linger over a window it has left.
  document.addEventListener('pointerleave', () => ring.classList.remove('is-active'));
  document.addEventListener('pointerenter', () => ring.classList.add('is-active'));

  const followCursor = () => {
    requestAnimationFrame(followCursor);
    // Lags the true pointer. The trailing ring against the exact dot is what
    // gives the cursor a sense of weight rather than being a second crosshair.
    x += (targetX - x) * 0.16;
    y += (targetY - y) * 0.16;
    // Off the layout path, so not top/left. But specifically the `translate`
    // PROPERTY rather than `transform`, and that distinction is load-bearing.
    //
    // CSS composes the transform family as T · R · S · transform, and a point
    // is mapped right to left — so `transform` applies FIRST and the standalone
    // `scale` from .is-hovering applies after it. Written into `transform`, the
    // hover scale multiplied the translation itself: the negative margins that
    // centre the ring put its transform-origin at viewport 0,0, so hovering the
    // STORE pill at x 765 threw the ring to 765 * 1.75 = 1339, clean off a
    // 950px viewport. It only ever misbehaved in the far corner because the
    // error is proportional to distance from that origin.
    //
    // Writing to `translate` puts the scale INSIDE the translation instead, so
    // the ring swells about its own centre and is then moved into place.
    ring.style.translate = `${x}px ${y}px`;
  };
  requestAnimationFrame(followCursor);
}

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

mountMonogram();
mountStoreFill();

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

mountRollingText();

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
 * Menu
 * ------------------------------------------------------------------ */

const menu = document.querySelector<HTMLDivElement>('#menu');
const menuBtn = document.querySelector<HTMLButtonElement>('.menu-btn');
const menuIcon = mountMenuButton();
const menuLabel = document.querySelector<HTMLSpanElement>('[data-menu-label]');

if (menu && menuBtn) {
  /* The reveal cascade.
   *
   * Every group expands the same ellipse (see home.css) but on its own delay
   * and curve. These numbers are fitted to the reference's real transition,
   * sampled per animation frame, not estimated:
   *
   *   overlay  no delay, ~750ms. Fitting power4.out against the samples gives
   *            79.0/95.1/99.3% at 0.32/0.53/0.72 of the way through, measured
   *            78.9/94.7/99.1 — so the curve is power4.out and not expo.out,
   *            which would have been ~10 points high across that whole range.
   *   tiles    ~150ms in, ~37ms apart, same curve.
   *   links    ~350ms in, ~80ms apart, and they OVERSHOOT: the reference's
   *            first link reaches 105.2% before settling back to 100. That is
   *            a back ease, and the overshoot is what stops four big lines
   *            arriving as a slab. They also translate 20px up into place.
   *
   * The overshoot is why the links get `back.out` rather than the same
   * power4.out as everything else — an ellipse that only ever approaches its
   * final size from below reads as sliding, while one that passes it and
   * returns reads as landing. */
  /* Timings are the reference's proportions stretched by about a third, which
   * is the "slightly slower, smoother" ask: the ORDER and the relative offsets
   * are what make the cascade read, so they are scaled together rather than
   * retuned individually. The overlay and tiles also drop from power4.out to
   * power3.out — same shape, less abrupt in the final third, which is where a
   * power4 deceleration reads as a snap.
   *
   * `at` is kept OUT of the tween objects rather than stripped at the call
   * site. Spreading a config that carried it put `at` among the tween vars,
   * where GSAP has no such property — it warned on every tween and tried to
   * animate a name that does not exist. The motion looked right only because
   * the position is also passed as the third argument, so the stray copy was
   * silent apart from the console. Splitting the shape makes it
   * unrepresentable. */
  const MENU_REVEAL = {
    overlay: { at: 0, tween: { duration: 1, ease: 'power3.out' } },
    tiles: { at: 0.2, tween: { duration: 1, ease: 'power3.out', stagger: 0.05 } },
    links: { at: 0.47, tween: { duration: 0.85, ease: 'back.out(0.8)', stagger: 0.105 } },
    mark: { at: 0.62, tween: { duration: 0.7, ease: 'power2.inOut' } },
    footer: { at: 0.76, tween: { duration: 0.56, ease: 'back.out(1.1)', stagger: 0.08 } },
  } as const;

  const tiles = menu.querySelectorAll<HTMLElement>('[data-menu-tile]');
  const links = menu.querySelectorAll<HTMLAnchorElement>('.menu__link');
  const footerLinks = menu.querySelectorAll<HTMLAnchorElement>('.menu__footer a');
  const images = menu.querySelector<HTMLElement>('.menu__images');
  const mark = menu.querySelector<SVGPathElement>('.menu__link-mark path');

  /* The current page's tile rests part-lit rather than dark, so the collage is
     never entirely flat and the mark always has somewhere to return to. */
  const TILE_REST = 0.5;
  const currentTile = menu.querySelector<HTMLAnchorElement>('.menu__link.is-current')?.dataset
    .menuLink;

  /** Bring one page's tile to full colour and drop the rest back. */
  const litTiles = (active: string | null) => {
    for (const tile of tiles) {
      const i = tile.dataset.menuTile;
      const target = active === i ? 1 : active === null && i === currentTile ? TILE_REST : 0;
      if (reducedMotion) tile.style.setProperty('--tile-lit', String(target));
      else gsap.to(tile, { '--tile-lit': target, duration: 0.45, ease: 'power2.out', overwrite: 'auto' });
    }
  };

  for (const link of links) {
    const i = link.dataset.menuLink ?? null;
    link.addEventListener('pointerenter', () => litTiles(i));
    link.addEventListener('focus', () => litTiles(i));
    link.addEventListener('pointerleave', () => litTiles(null));
    link.addEventListener('blur', () => litTiles(null));
  }

  const reveal = gsap.timeline({
    paused: true,
    // Only take it out of the layout once it has finished closing. Setting
    // `hidden` any earlier would kill the animation mid-flight, because
    // `display: none` stops the clip-path from rendering at all.
    onReverseComplete: () => {
      menu.hidden = true;
      // Cleared here rather than when the close starts, so the monogram fades
      // back in as the panel finishes clearing instead of over the top of it.
      document.documentElement.removeAttribute('data-menu-open');
    },
  });

  if (!reducedMotion) {
    reveal
      .to(menu, { '--menu-p': 1, ...MENU_REVEAL.overlay.tween }, MENU_REVEAL.overlay.at)
      .to(tiles, { '--tile-p': 1, ...MENU_REVEAL.tiles.tween }, MENU_REVEAL.tiles.at)
      .fromTo(
        links,
        { '--link-p': 0, y: 20 },
        { '--link-p': 1, y: 0, ...MENU_REVEAL.links.tween },
        MENU_REVEAL.links.at,
      )
      // Wipe in from the left with a 15px rise, rather than fading — a fade
      // would have this type arrive grey, and it is small enough already.
      .fromTo(
        footerLinks,
        { '--wipe': 0, y: 15 },
        { '--wipe': 1, y: 0, ...MENU_REVEAL.footer.tween },
        MENU_REVEAL.footer.at,
      );

    if (mark) {
      // Dash the path with its OWN length so the line draws on rather than
      // fading in. Measured from the path, never hardcoded: the reference's is
      // 433px for its shape, ours is whatever ours happens to be, and the
      // number changes the moment the path or the viewport does.
      const length = mark.getTotalLength();
      gsap.set(mark, { strokeDasharray: length, strokeDashoffset: length });
      reveal.to(mark, { strokeDashoffset: 0, ...MENU_REVEAL.mark.tween }, MENU_REVEAL.mark.at);
    }
  }

  /* Cursor-height parallax. The two columns counter-slide as the pointer moves
     up and down, which is what stops the collage feeling like a static grid
     behind the links. Measured off the reference: linear in cursor Y, +/-5.98rem
     at the extremes, zero at the vertical centre.

     quickTo rather than a tween per event: it retargets a single running tween
     instead of spawning one per pointermove, so the follow stays smooth under a
     fast mouse instead of queueing up. */
  if (images && !reducedMotion) {
    const followParallax = gsap.quickTo(images, '--menu-parallax', {
      duration: 0.9,
      ease: 'power2.out',
    });
    // Passive, like the page's other two pointermove listeners: this never
    // calls preventDefault, and saying so lets the browser skip waiting on it
    // before it scrolls.
    window.addEventListener(
      'pointermove',
      (e) => {
        if (menu.hidden) return;
        followParallax(1 - (2 * e.clientY) / window.innerHeight);
      },
      { passive: true },
    );
  }

  const setOpen = (open: boolean) => {
    if (open) menu.hidden = false;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuIcon?.setOpen(open);
    // The icon is aria-hidden, so the accessible name is the only thing telling
    // a screen reader what the button will do next. It has to track the state.
    if (menuLabel) menuLabel.textContent = open ? 'Close menu' : 'Open menu';

    // The reference locks the ROOT, not the body — body stays `visible` there
    // and <html> goes to `clip`. Locking the body instead leaves the scrollbar
    // gutter collapsing and shifts the whole layout sideways as it opens.
    document.documentElement.style.overflow = open ? 'clip' : '';

    // Drives the nav's own menu-open styling — the centred monogram hides,
    // because over the open panel it sits on the collage and reads as a stray
    // graphic rather than as branding. Set on the way in; on the way out the
    // reveal timeline clears it once the panel has actually gone (and there is
    // no timeline under reduced motion, so clear it here instead).
    if (open) document.documentElement.setAttribute('data-menu-open', '');
    else if (reducedMotion) document.documentElement.removeAttribute('data-menu-open');

    // Back to the resting arrangement each time it opens: the current page's
    // tile part-lit, the rest dark.
    if (open) litTiles(null);

    if (reducedMotion) {
      if (!open) menu.hidden = true;
    } else if (open) {
      reveal.play();
    } else {
      reveal.reverse();
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

  // Escape must close it. An overlay with no keyboard exit is a trap.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) setOpen(false);
  });
}

/* ------------------------------------------------------------------ *
 * Hero WebGL scene
 * ------------------------------------------------------------------ */

const stage = document.querySelector<HTMLDivElement>('#stage');

if (stage) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  stage.appendChild(renderer.domElement);

  /* 1.012, which is 0.88 raised by 15%.
   *
   * Written as the product rather than as the result so the two halves stay
   * legible: 0.88 was measured against the reference's own framing — its
   * monogram ends at y=79 and its subject's hair starts at ~y=110 — and the
   * 1.15 is the requested lift on top of the new portrait, which crops tighter
   * than the one that number was set against. */
  const head = new HeadScene(renderer, { subjectScale: 0.88 * 1.15 });

  /* The revealed screen behind the plate: the SAME two-pass contour field, in
     the inverse palette. Its own renderer because the marquee bands sit between
     the two layers and are DOM text — see BackgroundField for the full note.

     Skipped entirely under reduced motion. In that mode the hero never shrinks,
     so the screen behind it is never uncovered, and a second continuously
     rendering context would burn a frame budget on something no one can see. */
  const bgStage = document.querySelector<HTMLDivElement>('#bg-stage');
  let background: BackgroundField | null = null;
  let bgRenderer: THREE.WebGLRenderer | null = null;

  if (bgStage && !reducedMotion) {
    // No alpha: this is the bottom layer and paints every pixel, so an alpha
    // buffer would only add a blend the compositor then has to resolve.
    bgRenderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    // Capped at 1.5 rather than the hero's 2. The field is flat colour and
    // hairline contours with no photographic detail to preserve, and this is a
    // whole second fullscreen context — the pixels cost the same as the hero's
    // and buy far less.
    bgRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    // The ELEMENT's box, not the window's. They differ by the scrollbar, and
    // sizing a canvas to the window inside a narrower element stretches every
    // pixel horizontally — which on a field of thin contour lines shows up as
    // the background's topography not quite lining up with the hero's.
    bgRenderer.setSize(bgStage.clientWidth, bgStage.clientHeight);
    bgStage.appendChild(bgRenderer.domElement);
    background = new BackgroundField(bgRenderer);
  }

  const resize = () => {
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    head.resize();
    if (bgStage) bgRenderer?.setSize(bgStage.clientWidth, bgStage.clientHeight);
    background?.resize();
    // Its canvas is sized off the host box, which is sized in vw — so a resize
    // changes it, and the cached ink has to be re-rendered at the new scale.
    signature?.resize();
  };

  /* One call per frame. Each one reallocates two WebGL drawing buffers, two
     fullscreen render targets and the signature's ink cache, and the resize
     event fires on every pixel of a window drag. rAF rather than a timeout, so
     the new buffers are ready for the next paint. */
  let resizePending = 0;
  const onResize = () => {
    if (resizePending) return;
    resizePending = requestAnimationFrame(() => {
      resizePending = 0;
      resize();
    });
  };
  window.addEventListener('resize', onResize);

  // "Tap to lock" freezes the reveal where it is, so the composition can be
  // read without the cursor dragging it around.
  let locked = false;
  const lockBtn = document.querySelector<HTMLButtonElement>('#lock-btn');
  lockBtn?.addEventListener('click', () => {
    locked = !locked;
    lockBtn.setAttribute('aria-pressed', String(locked));
  });

  window.addEventListener(
    'pointermove',
    (e) => {
      if (locked) return;
      // -1..1, y flipped: screen y grows downward, the shader assumes y up.
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -((e.clientY / window.innerHeight) * 2 - 1);

      /* The screen behind takes the pointer for the whole sequence. Once the
         hero closes it is the only thing still answering the cursor. */
      background?.setPointer(nx, ny);

      /* Stop feeding the HERO once the portrait has mostly shrunk. The fluid's
         dye is advected and dissipates on its own, so cutting the input lets
         the reveal decay out rather than snapping — and it stops a cursor over
         the narrative plate painting a blob across a composition the pointer is
         no longer part of. Same intent as the reference's uFilter ramp. */
      if (shrunk > 0.25) return;
      head.setPointer(nx, ny);
    },
    { passive: true },
  );

  /* ---------------------------------------------------------------- *
   * Scroll: the portrait shrinks onto the narrative plate
   *
   * Measured off the reference at 1908x982: its sticky track is 1964px — two
   * viewport heights exactly — and the shrink runs across the FIRST of them.
   * Its landing box is 625x404 centred, which is where HeadScene.SHRUNK_HEIGHT
   * comes from.
   *
   * `ease: 'none'` here is deliberate and not a shortcut: the power1.inOut
   * curve is applied inside HeadScene.layout() instead, so a resize mid-scroll
   * recomputes the correct scale without the timeline having to re-fire.
   * ---------------------------------------------------------------- */

  const heroTrack = document.querySelector<HTMLElement>('[data-hero-track]');

  /* End scale of the plate, per axis. Measured, not chosen: the reference's
     landing box is 625x404 in a 1908x926 viewport.
   *
   * The two axes differ and that IS the move — 0.328 across against 0.436 down.
   * The sides come in noticeably faster than the top, so a 2.06 viewport aspect
   * resolves toward a 1.55 near-square. A single uniform scale holds the aspect
   * fixed and reads as a plain zoom-out. */
  /* The landing box, as a rule rather than two numbers.
   *
   * Measured off the reference: 624.95 x 404.13 in a 1908px viewport, which is
   * 32.75% of the width at an aspect of 1.546, centred on both axes. Checked at
   * a second viewport width to confirm it tracks width rather than being fixed
   * pixels. */
  const BOX_WIDTH_FRACTION = 0.3275;
  const BOX_ASPECT = 1.546;

  /* Push past a plain fit, so the face grows while the frame closes around it.
     Without it the portrait just recedes and the landing is a wide shot. */
  const FACE_ZOOM = 1.35;

  /**
   * Where the plate's frame sits at eased progress `e`, for the current viewport.
   *
   * Solves for the frame, then derives the scale and crop from it — not the
   * other way round. Ramping the two levers independently makes the visible
   * width their product, and a product of two linear ramps is a quadratic: it
   * hits both endpoints and sags between them (1168px at the midpoint against
   * the reference's 1267).
   *
   * Recomputed per frame. A cache would need invalidating on resize, on
   * orientation change and on the mobile URL bar, to save a dozen divisions.
   */
  const plateGeometry = (e: number) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Where the frame is now: straight line from full-bleed to the landing box.
    const frameW = vw + (vw * BOX_WIDTH_FRACTION - vw) * e;
    const frameH = vh + ((vw * BOX_WIDTH_FRACTION) / BOX_ASPECT - vh) * e;

    /* How far in on the face we have pushed so far. Ramped separately from the
       frame, because it is a separate idea — the frame closing is the sequence,
       the push-in is what stops the portrait merely receding as it does. */
    const faceZoom = 1 + (FACE_ZOOM - 1) * e;

    /* Scale satisfies the HEIGHT, and the crop takes the sides in on top. That
       ordering is forced: a clip inset can only ever remove, so whichever axis
       is NOT cropped has to be the one the scale lands exactly. */
    const zoom = (frameH / vh) * faceZoom;

    /* Whatever the zoom overshoots is what gets cropped away. At e=0 both fall
       out as zero without being special-cased — frameH is vh and faceZoom is 1,
       so zoom is 1 and there is nothing to trim. */
    const cropX = (1 - frameW / (vw * zoom)) / 2;
    const cropYTotal = 1 - frameH / (vh * zoom);

    return {
      zoom,
      cropX,
      /* Split unevenly, taking more off the BOTTOM. The subject's head sits
         above centre, so cropping symmetrically would trim the top of it while
         leaving empty chest. A quarter/three-quarters split holds the face
         centred in the box. */
      cropTop: cropYTotal * 0.25,
      cropBottom: cropYTotal * 0.75,
    };
  };

  /** How far the shrink has run, 0..1, EASED. Read by the pointer wiring. */
  let shrunk = 0;
  /** Raw scroll through the pin, 0..1. What the signature is paced against. */
  let rawProgress = 0;

  /* ---------------------------------------------------------------- *
   * Signature
   *
   * Driven off the shrink timeline rather than its own ScrollTrigger, so it
   * cannot drift out of step with the plate it is written across.
   *
   * The asset is fetched rather than inlined — 17KB of path data for something
   * first seen halfway through a scroll. Rendering lives in Signature.
   * ---------------------------------------------------------------- */

  /* Writing window, as a fraction of raw scroll through the pin.
   *
   * The reference, counted over ten increments: nothing through the third, a
   * first mark around the fourth, then a steady climb landing on the tenth.
   *
   * Raw, not eased — an eased bound starts the pen where the curve is moving
   * fastest and it lurches. Even pacing within the window is Signature's job. */
  const SIGN_FROM = 0.28;
  const SIGN_TO = 1;

  const signatureHost = document.querySelector<HTMLElement>('#signature');
  let signature: Signature | null = null;

  if (signatureHost && !reducedMotion) {
    fetch('/assets/brand/signature.svg')
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((markup) => {
        // The ink colour comes from the cascade rather than from a constant, so
        // the signature stays tied to the palette the rest of the page uses.
        const colour = getComputedStyle(document.documentElement)
          .getPropertyValue('--rosso-corsa')
          .trim();
        signature = new Signature(signatureHost, markup, colour || '#ff2800');
        // Catch up to wherever the scroll already is — a reload partway down the
        // sequence must not leave the signature unwritten under a closed plate.
        signature.progress = (rawProgress - SIGN_FROM) / (SIGN_TO - SIGN_FROM);
      })
      .catch((err: unknown) => {
        // Decorative, and the sequence is complete without it. Fail visibly to
        // us and invisibly to the visitor.
        console.error('[hero] signature failed to load', err);
      });
  }

  if (heroTrack && !reducedMotion) {
    const p = { t: 0 };
    gsap.to(p, {
      t: 1,
      /* LINEAR, so `p.t` is raw scroll position through the pin.
       *
       * The reference's curve on the plate is power1.inOut — confirmed against
       * its own render at nine consecutive scroll increments, matching to within
       * a pixel — and that curve is now applied below, explicitly, to the things
       * that want it. It used to live here on the tween instead, which meant
       * EVERYTHING read an eased clock, including the signature. That is what
       * made the signature feel like it snapped: it started near the middle of
       * the pin, which is exactly where an inOut curve is moving fastest, so it
       * inherited the plate's acceleration on top of its own. */
      ease: 'none',
      onUpdate: () => {
        /* Two clocks: p.t is raw scroll through the pin, eased is the plate's
           curve. Anything belonging to the shrink reads `eased`; anything that
           should advance evenly with the wheel reads `p.t`. */
        const eased = p.t < 0.5 ? 2 * p.t * p.t : 1 - Math.pow(-2 * p.t + 2, 2) / 2;

        shrunk = eased;
        // plateGeometry already returns values for this progress — no second ramp.
        const box = plateGeometry(eased);
        stage.style.setProperty('--hero-zoom', String(box.zoom));
        stage.style.setProperty('--hero-crop-x', `${box.cropX * 100}%`);
        stage.style.setProperty('--hero-crop-top', `${box.cropTop * 100}%`);
        stage.style.setProperty('--hero-crop-bottom', `${box.cropBottom * 100}%`);

        /* The plate stops being a scene and becomes a picture.
         *
         * 0.4, not the 0.75 this used to be, and that came out of the reference
         * rather than out of taste: screenshotted at the midpoint of its own
         * shrink, its plate is ALREADY flat — no contours inside the box, no
         * helmet, nothing moving — while at a quarter through both are still
         * plainly there. So the handover happens somewhere in between, and it
         * is a switch rather than a fade. */
        head.inert = eased >= 0.4;

        /* The signature writes itself across the back half of the pin, on the
           RAW clock so it advances by the same amount for every notch of the
           wheel. Measured against the reference over ten increments: nothing at
           three, barely started at five, then a steady climb that lands exactly
           on ten.

           A progress SET rather than a tween of its own, so scrubbing backwards
           un-writes it exactly the way it was written. */
        rawProgress = p.t;
        if (signature) {
          signature.progress = (p.t - SIGN_FROM) / (SIGN_TO - SIGN_FROM);
        }
        // Muted, not faded. Draining saturation keeps the plate solid; dropping
        // opacity would dissolve it into the screen behind and grey the
        // portrait out. Stops at 0.2 rather than 0 — a fully grey plate reads
        // as broken rather than as receding.
        stage.style.setProperty('--hero-mute', String(1 - 0.8 * eased));
        // The furniture belongs to the full-bleed screen, so it clears early —
        // gone by the time the plate is a third of the way in.
        heroTrack.style.setProperty(
          '--hero-furniture',
          String(Math.max(0, 1 - eased / 0.3)),
        );
        // The nav does not travel; it is already fixed in the corners. It just
        // settles smaller as the screen behind it changes.
        const root = document.documentElement.style;
        root.setProperty('--nav-shrink', String(1 - 0.18 * eased));

        // Monogram belongs to both screens but not to the transition between
        // them. Out fast, back late.
        const mono = eased < 0.15 ? 1 - eased / 0.15 : Math.max(0, (eased - 0.9) / 0.1);
        root.setProperty('--mono-in', String(mono));

        /* Wordmark crosses to the revealed screen's palette. Giallo on that
           cream measures about 1.06:1, so it has to. Eased, not raw — it tracks
           the screen changing, and a linear ramp would leave it half-inverted
           while the hero still filled the frame. */
        root.setProperty('--nav-invert', String(gsap.utils.clamp(0, 1, (eased - 0.1) / 0.5)));
      },
      scrollTrigger: {
        trigger: heroTrack,
        start: 'top top',
        end: () => `+=${window.innerHeight}`,
        scrub: true,
        invalidateOnRefresh: true,
      },
    });
  }

  // Live handle on the scene, the way the reference exposes window.landoGL.
  // Tuning the helmet's fit by eye and re-editing source each time is slow and
  // error-prone; being able to read and set values from the console makes it
  // measurable. Costs nothing, and doubles as the modding surface.
  // ScrollTrigger rides along because the scroll story is now the hard part to
  // tune, and reading a trigger's live start/end/progress beats guessing.
  (window as unknown as Record<string, unknown>).hamiltonGL = {
    head,
    renderer,
    background,
    bgRenderer,
    ScrollTrigger,
  };

  /* Every frame of this scene is a fluid simulation with 20 pressure
     iterations, a two-pass contour field and a Three.js draw. None of it is
     worth doing when nobody can see it, and there are two ways that happens:
     the menu covers the hero with an opaque panel, and scrolling past it moves
     it out of the viewport entirely. (The third — a background tab — rAF
     already handles by not firing at all.)

     The loop stays scheduled and only the work is skipped, so there is no
     restart to coordinate; update()'s clamped dt absorbs the gap on resume. */
  let heroVisible = true;
  new IntersectionObserver(
    ([entry]) => {
      // Default to visible: an observer that has not reported yet must never
      // read as "hidden", or the opening frames are dropped.
      heroVisible = entry?.isIntersecting ?? true;
    },
    // A little lead, so it is already drawing by the time it scrolls in.
    { rootMargin: '10%' },
  ).observe(stage);

  const frame = () => {
    requestAnimationFrame(frame);
    if (!heroVisible || document.documentElement.hasAttribute('data-menu-open')) return;

    /* Skipped while the plate still covers the viewport — the hero is full-bleed
       and opaque there, which is where anyone who never scrolls stays. The
       threshold is above zero because the scrub settles on values like 1e-7. */
    if (shrunk > 0.001) {
      background?.update();
      background?.render();
    }

    /* The hero keeps drawing after it goes inert. No preserveDrawingBuffer, so
       skipping the draw can blank the plate. The saving is inside update(),
       which returns before the fluid and contour passes; what is left is one
       textured quad. */
    head.update();
    renderer.render(head.scene, head.camera);
  };

  head
    .load()
    .then(() => {
      resize();
      frame();
      // The scene has painted, so the furniture can settle in around it.
      markReady();
      // Helmet is ~11 MB, so it loads after the hero is already interactive
      // and never blocks it. If it fails the scene is still complete enough to
      // ship — log it, don't take the page down with it.
      return head.loadHelmet().catch((err: unknown) => {
        console.error('[hero] helmet failed to load', err);
      });
    })
    .catch((err: unknown) => {
      // The page is fully readable without the canvas, so fail quietly for the
      // visitor and loudly for us.
      console.error('[hero] scene failed to load', err);
      stage.remove();
    });
}
