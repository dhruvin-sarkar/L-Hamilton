// The stylesheet is NOT imported here. index.html links it in the head so it is
// render-blocking; importing it from this module made it arrive only after the
// whole graph resolved, which painted the page unstyled first. See the note on
// that link element.
import * as THREE from 'three';
import gsap from 'gsap';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { BackgroundField } from './BackgroundField';
import { mountBlurText } from './BlurText';
import { HeadScene } from './HeadScene';
import { Signature } from './Signature';
import { age, driver, eras, seasonsRacing } from './content/hamilton';
import {
  helmetAlt,
  helmetSrc,
  helmets,
  pendingHelmets,
  revealAlt,
  revealSrc,
} from './content/helmets';

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

/** Console handle on the live scene. See where it is assigned, at the bottom. */
declare global {
  interface Window {
    hamiltonGL?: {
      head: HeadScene;
      renderer: THREE.WebGLRenderer;
      background: BackgroundField | null;
      bgRenderer: THREE.WebGLRenderer | null;
      ScrollTrigger: typeof ScrollTrigger;
      lenis: Lenis | null;
    };
  }
}

/* ------------------------------------------------------------------ *
 * Smooth scroll
 *
 * Config read off the reference, which sets duration 1.2, lerp 0.1, easing
 * power1.inOut, smoothWheel and syncTouch on, wheelMultiplier 1.
 *
 * `duration` and `easing` are NOT set here, and their absence is deliberate.
 * Lenis runs in one of two modes: given a `lerp` it damps toward the target
 * every frame and never looks at duration or easing; without one it plays a
 * fixed-length eased tween. Setting all three, as the reference does, means two
 * of them are decoration — they were being carried here as though they shaped
 * the feel, and nothing in this codebase calls lenis.scrollTo(), which is the
 * only other thing that would read them.
 *
 * So `lerp` is the entire scroll feel, and 0.1 was too loose: it takes about
 * 22 frames to cover 90% of a wheel movement, which is a third of a second of
 * the page still catching up after the input stopped. That reads as latency
 * rather than as smoothness. 0.14 halves the settle without making it snap.
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

/* Module scope for the same reason as lenis: it is built far below, inside the
   branch that sets up the scene, but the gallery has to reach it to cross the
   ground back to black. Null whenever there is no GL context or motion is
   reduced, and every caller has to cope with that. */
let background: BackgroundField | null = null;

/* ------------------------------------------------------------------ *
 * The revealed field's ground, and its single owner.
 *
 * The field crosses to black once — the gallery scrubbing sideways over it —
 * and back to cream once, as the store's visor opens. Both of those used to
 * ASSIGN background.darkness, on the reasoning that their ranges never overlap
 * so whichever ran last was the one that mattered.
 *
 * That holds while scrolling and fails on every refresh, because a refresh
 * re-applies EVERY trigger regardless of whether the scroll is inside its
 * range. Anywhere above the store its progress is 0, so its writer set
 * darkness to 1 - 0 = 1 and painted the whole top of the page black — the
 * screen the hero uncovers, the signature, everything above the gallery —
 * moments after the gallery's writer had correctly set 0. Document order
 * decided it, and document order is not the answer to "how dark should this
 * ground be at this scroll position".
 *
 * So neither writes the value now. Each reports its own contribution and this
 * combines them: how far the ground has gone dark, less how far it has come
 * back. The two ranges still never overlap, which is what makes a subtraction
 * exact rather than a blend — and unlike last-writer-wins it is
 * order-independent, so a refresh firing them in any sequence lands on the
 * same answer as scrolling through them would.
 * ------------------------------------------------------------------ */

const groundCross = { darkening: 0, ink: 0, lightening: 0, panel: 0 };

/** Resolved once. The script is a module, so the nav is already parsed. */
const navGroundStyle = document.querySelector<HTMLElement>('.nav-inner')?.style ?? null;

function applyGroundCross(): void {
  const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
  if (background) background.darkness = clamp(groundCross.darkening - groundCross.lightening);
  /* The nav's ink crosses on a far steeper curve than the ground does — see
     the note in the gallery — so it carries its own term rather than reusing
     the ground's. Both are undone by the same return to light. */
  /* The footer panel is a third dark surface, and the only one that is not on
     the field at all — it is an opaque block laid over it. So it does not
     belong in the subtraction above (there is nothing for the store's return
     to light to undo); it just overrides, for as long as it is under the nav.
     Without this the wordmark stays dark ink on the dark panel. */
  navGroundStyle?.setProperty(
    '--nav-ground-dark',
    String(Math.max(clamp(groundCross.ink - groundCross.lightening), groundCross.panel)),
  );
}

if (!reducedMotion) {
  const instance = new Lenis({
    lerp: 0.14,
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

  /* Everything that scrolls has to go through Lenis, not just the wheel.
   *
   * Lenis intercepts wheel and touch and nothing else, so an in-page anchor and
   * every scrolling key were still moving the document natively — instantly,
   * and behind Lenis's back. The skip link was the worst of them: it is the
   * first thing in the document and it jumped. */

  /* Anchors. preventDefault stops the native jump AND stops the hash being
     written, which is what was yanking the page to the top. Focus still has to
     move, or "skip to content" skips nothing for the person who needs it. */
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
    const id = link?.getAttribute('href')?.slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;

    event.preventDefault();
    instance.scrollTo(target);
    // Not focusable by default — <main> and section wrappers are not — so it is
    // made focusable for the move. preventScroll because Lenis owns the travel.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });

  /** How far each scrolling key moves, given the viewport height. */
  const keyStep = (key: string, vh: number): number | null => {
    switch (key) {
      case 'ArrowDown':
        return vh * 0.12;
      case 'ArrowUp':
        return -vh * 0.12;
      case 'PageDown':
        return vh * 0.9;
      case 'PageUp':
        return -vh * 0.9;
      default:
        return null;
    }
  };

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;

      /* Never steal a key from something that wants it. A field is obvious; a
         button or a link matters just as much, because Space and the arrows
         activate and move between them. With nothing focused, activeElement is
         <body>, and the key is the page's to handle.
       *
       * tabindex="-1" is deliberately NOT in that list. It marks a programmatic
       * focus target — a scroll destination, a panel — not a control, and the
       * anchor handler above puts it on whatever the skip link points at.
       * Treating it as a control meant that using the skip link switched off
       * keyboard scrolling for the rest of the visit, which is precisely the
       * person who needed the skip link in the first place. */
      const active = document.activeElement;
      if (active && active !== document.body) {
        if (
          active.closest(
            'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
          )
        ) {
          return;
        }
        if (active.closest('a[href], button, summary, [role="button"]')) return;
        // In the tab order on purpose, so it is a control someone chose to make.
        const tabindex = active.getAttribute('tabindex');
        if (tabindex !== null && Number(tabindex) >= 0) return;
      }
      // The menu runs its own focus trap and should not scroll the page behind it.
      if (document.documentElement.hasAttribute('data-menu-open')) return;

      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        instance.scrollTo(event.key === 'Home' ? 0 : document.documentElement.scrollHeight);
        return;
      }

      // Space pages down, Shift+Space pages up — the browser's own convention.
      const key = event.key === ' ' ? (event.shiftKey ? 'PageUp' : 'PageDown') : event.key;
      const step = keyStep(key, window.innerHeight);
      if (step === null) return;

      event.preventDefault();
      instance.scrollTo(instance.scroll + step);
    },
    // Not passive: preventDefault is the whole point, or the page scrolls twice.
    { passive: false },
  );
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
  /* The team line, in one place. It was typed out in the impact eyebrow and
     again in the menu while the next-race card bound the same year properly —
     three statements of one fact, two of which could go stale on their own.
     Bound as a WHOLE STRING rather than by wrapping the year in a span:
     splittable() requires childElementCount === 0, so a nested span would have
     silently switched off the eyebrow's line reveal. "Scuderia" is Ferrari's
     own prefix and would need revisiting alongside a team change, which is a
     larger content edit than this. */
  'team-line': `Scuderia ${driver.currentTeam} since ${currentEra.from}`,
};

for (const [key, value] of Object.entries(bindings)) {
  for (const el of document.querySelectorAll(`[data-bind="${key}"]`)) {
    el.textContent = value;
  }
}

/* ------------------------------------------------------------------ *
 * Inert links
 *
 * Sixteen links across the menu, the socials block and the footer stand in for
 * destinations that do not exist yet — the three other pages, and the social
 * profiles. They carry href="#" so they keep a link's appearance, focus ring
 * and keyboard semantics, but nothing was stopping the default: clicking or
 * pressing Enter on any of them threw the reader back to the top of the page,
 * which on a 17,000px document is the most destructive thing a stray click can
 * do here.
 *
 * One delegated listener rather than sixteen, and preventDefault only — the
 * link stays focusable and announced, it simply no longer goes anywhere. Give
 * one a real href and it starts working with no other change.
 * ------------------------------------------------------------------ */

document.addEventListener('click', (event) => {
  const target = event.target as Element | null;
  if (target?.closest('[data-placeholder-href]')) event.preventDefault();
});

/* ------------------------------------------------------------------ *
 * Small DOM helper
 *
 * All that survives of a stat band, an eras list and a pair of
 * IntersectionObservers that were built for markup this page does not have.
 * `#stats-grid`, `#stats-note` and `#eras-list` appear nowhere in index.html,
 * `[data-count]` was only ever set by the stat builder itself, and no element
 * carries the bare `reveal` class the revealer watched for — so every one of
 * those blocks was querying an empty NodeList on load and had been since the
 * markup settled.
 *
 * They are gone rather than wired up, because the reference's home page has no
 * stat band and no eras list, and CLAUDE.md's parity mandate is explicit that a
 * section the reference does not have is out of scope. The career numbers
 * belong to the season table on /on-track.
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Marquee
 *
 * Two counter-scrolling bands behind the plate. The copy is placeholder and
 * defined below rather than in the markup, so the visible text and the
 * screen-reader line cannot drift apart.
 * ------------------------------------------------------------------ */

/** Copies per track when the track cannot be measured. See the build below. */
const MARQUEE_FALLBACK_COPIES = 4;

const marquee = document.querySelector<HTMLElement>('.hero-back');
if (marquee) {
  /* The band labels the narrative that follows, which is what the reference's
     own band does — it reads "MESSAGE FROM LANDO" over the same moment.
     Third person on purpose: CLAUDE.md forbids putting words in Hamilton's
     mouth, so this is site copy introducing him, never something he said.
     No figures here either — every number on this page comes from the data
     layer, and a championship count baked into a graphic surface would be the
     one place it could silently go stale.
     "From Stevenage to Maranello" is the only concrete claim and both ends of
     it are matters of record. The loop measures itself, so length is free. */
  const BANDS = {
    left: ['The story so far', 'On and off the track'],
    right: ['From Stevenage to Maranello', 'Still writing it'],
  } as const;

  type BandName = keyof typeof BANDS;
  const isBandName = (v: string | undefined): v is BandName => v === 'left' || v === 'right';

  /* Built here, animated further down once the reduced-motion branch is known.
     Carrying the copy count in a local rather than round-tripping it through a
     data attribute: a missing attribute would silently fall back to a different
     number, and the loop would jump at every repeat with nothing to say why. */
  const bands: { track: HTMLElement; copies: number; rightward: boolean }[] = [];

  for (const row of marquee.querySelectorAll<HTMLElement>('[data-marquee]')) {
    const name = row.dataset.marquee;
    /* Skip rather than guess. A row whose data-marquee does not name a band is
       markup drifting away from this file, and quietly falling back to the left
       band would render the wrong copy in the right colour. */
    if (!isBandName(name)) continue;
    const words = BANDS[name];
    const track = row.querySelector<HTMLElement>('[data-marquee-track]');
    if (!track) continue;

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
        : MARQUEE_FALLBACK_COPIES;
    for (let i = 1; i < copies; i++) addCopy();

    bands.push({ track, copies, rightward: name === 'right' });
  }

  /* The visible rows are aria-hidden because they repeat themselves several
     times over; this is the copy a screen reader actually gets.
   *
     It reads the bands back as they are. It used to announce them as "World
     championships in ..." and "Teams: ...", which was left over from when they
     carried real data — so a screen reader was being told placeholder strings
     were career facts while sighted readers saw obvious placeholders. */
  const marqueeText = document.querySelector<HTMLElement>('#marquee-text');
  if (marqueeText) {
    marqueeText.textContent = [...BANDS.left, ...BANDS.right].join('. ') + '.';
  }

  if (!reducedMotion) {
    /* The loop is a GSAP tween, not a CSS animation, because the SCROLL has to
       be able to reach it — a CSS keyframe has no rate you can drive. This is
       the reference's own mechanic: one linear repeating tween per band with
       timeScale coupled to scroll.

       `ease: none` holds the speed constant so the joint never shows up as a
       hesitation. */
    const loops = bands.map(({ track, copies, rightward }) => {
      /* One copy's width, as a percentage of the whole track. This is the
         pattern's period, and therefore the ONLY distance the track can travel
         without changing phase — land on it and the loop is seamless, miss it
         and the text jumps at every repeat. */
      const step = 100 / copies;

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
 * Impact wall
 *
 * The first block under the hero. Words rise and sharpen one after another as
 * it comes into view; see BlurText for the timing, which is the React Bits
 * component's unchanged.
 *
 * Paced well under the component's 200ms default. At 200 a sentence this long
 * takes the better part of ten seconds, and the last words are still arriving
 * after the reader has moved on. 55ms across seventeen words puts the whole
 * wall down in about 1.6s, which is roughly one unhurried scroll — the point is
 * that the text reads as arriving, not as something to wait for.
 * ------------------------------------------------------------------ */

const impactText = document.querySelector<HTMLElement>('[data-impact-text]');
if (impactText) {
  mountBlurText(impactText, {
    delay: 55,
    stepDuration: 0.3,
    animateBy: 'words',
    direction: 'bottom',
  });
}

/* ------------------------------------------------------------------ *
 * Gallery — vertical scroll drives horizontal travel
 *
 * Two things move on their own clocks, both measured off the reference:
 *
 *   travel  1:1 with scroll, and it starts when the section's TOP reaches the
 *           BOTTOM of the viewport — a viewport earlier than the pin. That is
 *           what the track's 75vw lead-in is for: the first column is still
 *           off-screen right when travel begins, so it slides in as the section
 *           arrives rather than sitting there waiting.
 *
 *   ground  the contour field crossing back to the hero's dark palette, eased
 *           out across the PINNED range. Sampling the reference mid-transition
 *           against easeOutQuad matched every channel to within half a percent.
 *
 * The section's height is written here rather than in CSS because it has to
 * equal the track's horizontal overflow for the two to run 1:1, and that
 * depends on how wide the content turns out to be.
 * ------------------------------------------------------------------ */

const gallery = document.querySelector<HTMLElement>('[data-gallery]');
const galleryTrack = document.querySelector<HTMLElement>('[data-gallery-track]');

/* Declared up here rather than beside its own block because applyGround, below,
   has to hand this section the same ink the gallery ends on. The two sit on one
   continuous field and there is only one right answer for what colour the type
   is; deciding it twice is how they drift apart. */
const otot = document.querySelector<HTMLElement>('[data-otot]');

/**
 * The scroll-driven sections, bound to the breakpoint rather than to whatever
 * it happened to be at load.
 *
 * Below 992px the gallery is a column and On/Off Track is a stack — see
 * home.css, and note the reference makes the same call. The condition has to
 * be checked here as well as in CSS because the two must agree: the pin only
 * works if a travel height has been written, and the column only works if it
 * has not.
 *
 * This is a gsap.matchMedia context and not a one-time `matchMedia().matches`
 * read, because that read is only true of the window as it was when the page
 * loaded. Opening devtools or dragging the window across 992px left the two
 * halves disagreeing, and in the worst direction silently: a page loaded
 * narrow and then widened had no travel height and no --gallery-x, so the
 * track sat overflowing a sticky pin with no scroll distance to move it —
 * three and a half thousand pixels of photographs unreachable.
 *
 * A context sets up on entering the query and REVERTS on leaving, which is the
 * half that hand-rolled resize listeners usually miss. Reduced motion rides
 * the same mechanism, so toggling it mid-session is handled too rather than
 * being frozen at load.
 */
/* ------------------------------------------------------------------ *
 * Helmets hall of fame — the wall itself.
 *
 * Built here rather than written into index.html: 26 entries times two
 * photographs times a label is a lot of markup to keep in step by hand, and
 * every value in it already lives in src/content/helmets.ts. Done before any
 * ScrollTrigger is created, so the page is its final height when they measure.
 * ------------------------------------------------------------------ */

const hof = document.querySelector<HTMLElement>('[data-hof]');

/* The card silhouette, stroked. Inset half a pixel so a 1px line lands inside
   the 407x411 viewBox rather than straddling its edge. The bottom edge steps up
   on the right and returns on a diagonal, and the notch that opens up is where
   the label sits — which is why the shape is not simply a rounded rectangle.

   The #hof-card clipPath in index.html is this same outline normalised to the
   0..1 box, and clips each photograph to it. Change one and the other has to
   follow, or the pictures will stop where the line does not. */
const HOF_CARD_PATH =
  'M8 0.5 H399 A7.5 7.5 0 0 1 406.5 8 V364.5 A7.5 7.5 0 0 1 399 372 ' +
  'H263 L211 410.5 H8 A7.5 7.5 0 0 1 0.5 403 V8 A7.5 7.5 0 0 1 8 0.5 Z';

/** Attribute-safe text. The data is ours, but a name carrying a quote would
    otherwise close the attribute it sits in and swallow the rest of the tag. */
function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function hofFrame(variant: 'base' | 'on'): string {
  return (
    `<svg class="hof__frame hof__frame--${variant}" viewBox="0 0 407 411" ` +
    `preserveAspectRatio="none" aria-hidden="true"><path d="${HOF_CARD_PATH}" /></svg>`
  );
}

const hofGrid = document.querySelector<HTMLElement>('[data-hof-grid]');

if (hofGrid) {
  hofGrid.innerHTML = helmets
    .map(
      (helmet) => `
      <li class="hof__item" tabindex="0">
        <div class="hof__media">
          <img class="hof__helmet" src="${helmetSrc(helmet)}"
            alt="${attr(helmetAlt(helmet))}" loading="lazy" decoding="async" />
          <span class="hof__reveal-w">
            <img class="hof__reveal-bg" src="${revealSrc(helmet)}" alt="" aria-hidden="true"
              loading="lazy" decoding="async" />
            <img class="hof__reveal" src="${revealSrc(helmet)}"
              alt="${attr(revealAlt(helmet))}" loading="lazy" decoding="async" />
          </span>
        </div>
        <div class="hof__frame-w">${hofFrame('base')}${hofFrame('on')}</div>
        <p class="hof__label">
          <span class="hof__name">${helmet.name ? attr(helmet.name) : ''}</span>
          <span class="hof__year">${helmet.year ?? ''}</span>
        </p>
      </li>`,
    )
    .join('');
}

/* Loud in dev, silent in production. Thrown, this would take the whole page
   down over content that is known to be outstanding; left unsaid, 26 em-dashes
   look like a rendering fault rather than a queue of data still to come. */
if (import.meta.env.DEV) {
  const pending = pendingHelmets();
  if (pending.length > 0) {
    console.warn(
      `[content] ${pending.length} of ${helmets.length} helmets are still missing a ` +
        `name or year — fill them in at src/content/helmets.ts. Ids: ` +
        pending.map((h) => h.id).join(', '),
    );
  }
}

const mm = gsap.matchMedia();
const WIDE_AND_ANIMATED = '(min-width: 992px) and (prefers-reduced-motion: no-preference)';

mm.add(WIDE_AND_ANIMATED, () => {
  if (!gallery || !galleryTrack) return;
  /** Every photo, with the frame it slides inside. Resolved once. */
  const panes = [...galleryTrack.querySelectorAll<HTMLElement>('.gallery__frame')].map(
    (frame) => ({ frame, img: frame.querySelector('img') }),
  );

  /** How far the track has to travel: everything past one screenful. */
  let travel = 0;

  const measure = () => {
    travel = Math.max(0, galleryTrack.scrollWidth - window.innerWidth);
    // Scroll distance and travel distance are the same number, which is what
    // makes the mapping 1:1 rather than a ratio that changes with the content.
    gallery.style.height = `${travel}px`;
  };

  /**
   * Slide each photo inside its own frame.
   *
   * 0 while the frame is still off the right edge, 1 once it has left past the
   * left — so a photo pans across its crop exactly once per pass, and two
   * frames of different widths travel the same 4rem at different rates.
   */
  const pan = () => {
    const vw = window.innerWidth;
    for (const { frame, img } of panes) {
      if (!img) continue;
      const box = frame.getBoundingClientRect();
      const t = (vw - box.left) / (vw + box.width);
      img.style.setProperty('--pan', String(gsap.utils.clamp(0, 1, t)));
    }
  };

  measure();

  gsap.to(
    {},
    {
      ease: 'none',
      scrollTrigger: {
        trigger: gallery,
        start: 'top bottom',
        end: 'bottom bottom',
        scrub: true,
        invalidateOnRefresh: true,
        onRefresh: measure,
        onUpdate: (self) => {
          galleryTrack.style.setProperty('--gallery-x', `${-travel * self.progress}px`);
          pan();
        },
      },
    },
  );

  /**
   * Put the ground, the section's ink and the nav at `progress` through the
   * darkening.
   *
   * easeOutQuad: most of the change happens early, so the ground has settled by
   * the time the last pictures come through rather than still shifting under
   * them. Measured off the reference, whose own mid-transition values match
   * this curve on every channel.
   */
  const applyGround = (progress: number) => {
    const t = 1 - (1 - progress) * (1 - progress);
    gallery.style.setProperty('--gallery-dark', String(t));

    /* The ink flips on its OWN curve, far steeper than the ground's, and that
     * is the difference between readable and not.
     *
     * Crossing both on the same ramp seems obvious and is wrong: halfway
     * through, the text is exactly as mid-grey as the field behind it and the
     * captions disappear. Side by side at the same point in the sequence, the
     * reference's captions are still fully light while its ground is already
     * halfway across — it holds the contrast and then flips late.
     *
     * A smoothstep over a narrow band around the midpoint does that: dark ink
     * for as long as the ground is light, cream once it is dark, and the moment
     * where the two match reduced to a crossing rather than a long stretch. */
    const x = gsap.utils.clamp(0, 1, (t - 0.38) / 0.24);
    const ink = x * x * (3 - 2 * x);
    gallery.style.setProperty('--gallery-ink', String(ink));

    /* On/Off Track sits on the same continuous field and inherits nothing from
       here — it is a sibling, not a child — so it is told directly. Without
       this its type would default to dark ink on the black ground the gallery
       just finished laying down. */
    otot?.style.setProperty('--otot-ink', String(ink));

    /* The nav crosses back with the ground it is sitting on. The hero inverted
       it for the light screen and left it there; as the gallery takes that
       screen back to black the wordmark has to return to Rosso and Giallo, or
       it is dark ink on a dark field. Same variable the hero drives, and the
       two ranges never overlap, so whichever is being scrubbed owns it. */
    /* Its OWN signal, not the hero's. Both used to write --nav-invert and the
       hero won, because a scrub holds at its end value past its range — right
       for the cream screen it uncovers, wrong once this section paints that
       screen black. The nav combines the two in CSS instead, so neither has to
       know about the other. */
    groundCross.darkening = t;
    groundCross.ink = ink;
    applyGroundCross();
  };

  gsap.to(
    {},
    {
      ease: 'none',
      scrollTrigger: {
        trigger: gallery,
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
        invalidateOnRefresh: true,
        onUpdate: (self) => applyGround(self.progress),
        /* Also on refresh, not only on update. A load that lands inside the
           gallery — a reload partway down, a deep link — fires no update until
           something moves, and until then the ground would be dark under a nav
           still inverted for the light screen. */
        onRefresh: (self) => applyGround(self.progress),
      },
    },
  );

  /* The context reverts its own tweens and ScrollTriggers, but not the marks
     they left on the DOM. Every one of these would otherwise survive into the
     column layout: a stale travel height, a track shifted off to the left, and
     — the one that actually loses content — a dark field with dark ink on it,
     because the ground is a GL uniform that nothing else resets. */
  return () => {
    gallery.style.removeProperty('height');
    gallery.style.removeProperty('--gallery-dark');
    gallery.style.removeProperty('--gallery-ink');
    galleryTrack.style.removeProperty('--gallery-x');
    for (const { img } of panes) img?.style.removeProperty('--pan');
    otot?.style.removeProperty('--otot-ink');
    // Withdraw this section's contribution rather than clearing the value: the
    // store still has a say, and in the column layout there is no darkening
    // left for it to undo.
    groundCross.darkening = 0;
    groundCross.ink = 0;
    applyGroundCross();
  };
});

/* ------------------------------------------------------------------ *
 * On Track / Off Track — the two cutouts closing in, and the riser.
 *
 * Three curves over one section, all measured off the reference at
 * 1728x1080 and each verified by predicting values at scroll positions that
 * were not used to fit them:
 *
 *   cutouts   20rem -> 0, power3.out, across the whole two-screen range
 *   type       5rem -> 0, LINEAR, finishing at 60% of that range
 *   riser      climbs 10vh and grows 5% as its frame covers the screen
 *
 * The type settling well before the cutouts do is the whole effect. Run both
 * on one curve and the section arrives all at once; staggered, the words come
 * to rest and the images are still closing behind them, which is what reads
 * as depth. The reference does exactly this and it is worth not smoothing out.
 * ------------------------------------------------------------------ */

/* Same breakpoint and the same reasoning as the gallery, on the same context
   mechanism: below 992px the section is a static stack, and the CSS that makes
   it one only holds if no transform is being written underneath it. */
mm.add(WIDE_AND_ANIMATED, () => {
  if (!otot) return;
  const ototEnd = otot.querySelector<HTMLElement>('.otot__end');

  const applyCutouts = (progress: number): void => {
    const rest = 1 - progress;
    // power3.out: most of the distance is covered early, so the cutouts arrive
    // with weight and then ease the last few pixels shut.
    otot.style.setProperty('--otot-cut', `${20 * rest * rest * rest}rem`);
    // Linear, and done at 60%.
    const t = gsap.utils.clamp(0, 1, progress / 0.6);
    otot.style.setProperty('--otot-txt', `${5 * (1 - t)}rem`);
  };

  gsap.to(
    {},
    {
      ease: 'none',
      scrollTrigger: {
        trigger: otot,
        // The closing starts the moment the section shows and ends as it
        // finishes passing — 'bottom bottom', not 'bottom top', so it is
        // settled while still on screen rather than completing off it.
        start: 'top bottom',
        end: 'bottom bottom',
        scrub: true,
        invalidateOnRefresh: true,
        /* Also on refresh: a reload landing inside this section fires no update
           until something moves, which would leave the cutouts parked at their
           opening offset with the type already settled. One body, so the pair
           cannot drift — they had been maintained as two copies. */
        onUpdate: (self) => applyCutouts(self.progress),
        onRefresh: (self) => applyCutouts(self.progress),
      },
    },
  );

  if (ototEnd) {
    gsap.to(
      {},
      {
        ease: 'none',
        scrollTrigger: {
          trigger: ototEnd,
          // Exactly the span in which the riser covers the screen: from its
          // top entering at the bottom to its top reaching the top.
          start: 'top bottom',
          end: 'top top',
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate: (self) => otot.style.setProperty('--otot-rise', String(self.progress)),
          onRefresh: (self) => otot.style.setProperty('--otot-rise', String(self.progress)),
        },
      },
    );
  }

  /* Same reasoning as the gallery's: the offsets are our own inline writes, so
     the context will not clear them. Left behind, the cutouts would stay parked
     at whatever offset the last frame wrote while the stacked layout expects
     them at rest. */
  return () => {
    otot.style.removeProperty('--otot-cut');
    otot.style.removeProperty('--otot-txt');
    otot.style.removeProperty('--otot-rise');
  };
});

/* ------------------------------------------------------------------ *
 * Hall of fame — the columns drifting past each other.
 *
 * Two offsets, both easing to nothing as the wall crosses the screen, and both
 * moving the same direction: columns 1 and 3 travel 5rem, columns 2 and 4
 * travel 15rem. Measured off the reference, where the ratio is exactly 3 and
 * the scrub is linear rather than eased.
 *
 * That every column moves UP is worth stating plainly, because the effect
 * reads as the even ones moving DOWN — they are simply further behind at every
 * point in the scroll, and it is the gap between the two that the eye picks up
 * rather than either offset on its own. Give them the same travel and the wall
 * arrives as one flat block.
 *
 * There is no static offset underneath this. Parked past the end of the range
 * all four columns settle to the identical top with no margin between them; the
 * whole stagger is the transform, and adding a resting offset "to match the
 * screenshot" would double it.
 * ------------------------------------------------------------------ */

mm.add(WIDE_AND_ANIMATED, () => {
  if (!hof || !hofGrid) return;

  /* The reference's own travel is 5rem and 15rem. Both are scaled by the same
     factor here, deliberately, so the wall drifts further than the reference's
     does while the 3:1 relationship that produces the stagger is untouched.
     Currently 2.4x, which puts the trailing columns most of a card lower than
     their neighbours as the wall comes onto the screen. */
  const apply = (progress: number) => {
    const rest = 1 - progress;
    /* Solved against the reference's own drift, measured on the running site:
       sampling the topmost card of each column at four scroll positions, its
       lead columns travel 44px and its lag columns 219px. Ours travelled 180
       and 540 — four times and two and a half times too far — which is what
       forced the CTA's outsized clearance below and inflated the section. */
    hof.style.setProperty('--hof-lead', `${2.93 * rest}rem`);
    hof.style.setProperty('--hof-lag', `${14.6 * rest}rem`);
  };

  gsap.to(
    {},
    {
      ease: 'none',
      scrollTrigger: {
        // The grid, not the section: the callout below it is not part of the
        // drift, and triggering on the section would stretch the range past
        // where the columns have already settled.
        trigger: hofGrid,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
        invalidateOnRefresh: true,
        onUpdate: (self) => apply(self.progress),
        // As everywhere else on the page: a reload landing inside this section
        // fires no update until something moves, and the columns would sit at
        // whatever offset the markup implies rather than at the scroll position.
        onRefresh: (self) => apply(self.progress),
      },
    },
  );

  /* Our own inline writes, so the context will not clear them. Left behind,
     every even column would stay parked 15rem low in the two-column layout. */
  return () => {
    hof.style.removeProperty('--hof-lead');
    hof.style.removeProperty('--hof-lag');
  };
});

/* ------------------------------------------------------------------ *
 * Store callout — the visor bending open, and the ground coming back.
 *
 * Two curves, both measured off the reference at 1908x884:
 *
 *   visor      clip-path ellipse(70% p at 50% 0), p from 0 to 100%, LINEAR.
 *              Sampled at three points relative to the section top: 0% with
 *              the section 900px below the scroll position, 48.8% at 600 and
 *              100% at 300. So it opens as the section top crosses the fold
 *              and is fully bent a third of a viewport before it lands.
 *
 *   parallax   every framed image travels 0 to -50px, evenly, across a range
 *              a good deal longer than the visor's — sampled -10px per 300px
 *              of scroll from the same start.
 *
 * The ground crossing is ours rather than the reference's. Its store section
 * sits on a field that was never darkened: the wall above it is a separate
 * WebGL scene with its own black. Ours is one continuous field that the
 * gallery took to black, so it has to come back, and it does it on the visor's
 * own range — under the dome, which is the one part of the frame still dark
 * while it happens.
 * ------------------------------------------------------------------ */

const store = document.querySelector<HTMLElement>('[data-store]');

if (store && !reducedMotion) {
  /* This section's share of the ground: how far the field has come BACK to
     cream. It never assigns the ground — see applyGroundCross, which owns it —
     because above this section the visor's progress is 0 and "1 - 0" is a
     perfectly confident instruction to paint the top of the page black. */
  const applyGround = (p: number): void => {
    groundCross.lightening = p;
    applyGroundCross();
  };

  const applyVisor = (progress: number): void => {
    store.style.setProperty('--store-visor', String(progress));
    applyGround(progress);
  };

  gsap.to(
    {},
    {
      ease: 'none',
      scrollTrigger: {
        trigger: store,
        // Opens as the section top crosses the fold, shut a third of a
        // viewport later — the reference's 900px and 300px at its own height.
        start: 'top bottom',
        end: 'top 34%',
        scrub: true,
        invalidateOnRefresh: true,
        /* Same body on both, so a reload landing inside the section paints the
           visor where the scroll position says rather than at its opening
           value. Written once — the two had already been maintained as a
           copy-pasted pair. */
        onUpdate: (self) => applyVisor(self.progress),
        onRefresh: (self) => applyVisor(self.progress),
      },
    },
  );

  gsap.to(
    {},
    {
      ease: 'none',
      scrollTrigger: {
        trigger: store,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
        invalidateOnRefresh: true,
        onUpdate: (self) =>
          store.style.setProperty('--store-parallax', String(self.progress)),
        onRefresh: (self) =>
          store.style.setProperty('--store-parallax', String(self.progress)),
      },
    },
  );
}

/* ------------------------------------------------------------------ *
 * Partners & campaigns
 *
 * Three parts, all measured off the reference:
 *
 *   the row      a linear loop whose period is exactly one copy of the list,
 *                which is the only distance it can travel without the joint
 *                showing. Same mechanic as the hero marquee, and the same
 *                scroll-velocity coupling.
 *   the cursor   hovering slows the row rather than stopping it. A hard stop
 *                reads as a bug on a band that has been moving for ten
 *                seconds; a decelerating one reads as an invitation to look.
 *   the word     each path dashed with its own measured length and the offset
 *                run to zero on scroll, which is how the menu draws its
 *                current-page mark. Length from getTotalLength rather than a
 *                constant, so a path edit cannot silently break it.
 * ------------------------------------------------------------------ */

/**
 * Every partner, in the order they appear on the row.
 *
 * Set as type rather than as logo files: these are third-party trademarks and
 * this build does not redistribute them. Grouped the way they were supplied -
 * personal partners first, then the Scuderia Ferrari partners he carries on
 * race gear as part of the team contract.
 */
const PARTNERS = [
  'Tommy Hilfiger',
  'Puma',
  'Dior',
  'IWC Schaffhausen',
  'Police',
  'Sanpellegrino',
  'Perplexity AI',
  'CFI',
  'Monster Energy',
  'Sony',
  'HP',
  'Shell',
  'IBM',
  'Ceva Logistics',
  'UniCredit',
] as const;

/**
 * A looping row of partner names.
 *
 * Extracted because the page has two of them — the partners row on the cream
 * ground and the one inside the footer panel — and they are the same object in
 * two colours, not two components. The reference treats its marquees the same
 * way: one behaviour, driven by attributes.
 *
 * `drift` is the footer's extra. The reference scrubs its footer row bodily
 * across the viewport as you pass it, on top of the loop, which is what makes
 * that row feel attached to the scroll rather than merely running near it. The
 * partners row above has no drift, so it stays at 0 there.
 */
function mountMarquee(opts: {
  track: HTMLElement;
  box: HTMLElement;
  items: readonly string[];
  itemClass: string;
  /** vw travelled across the row's viewport pass. 0 leaves the row put. */
  drift?: number;
  /** The element the drift moves. Must not be the looping track. */
  scroller?: HTMLElement | null;
}): void {
  const { track, box, items, itemClass, drift = 0, scroller = null } = opts;

  /* Two copies minimum, then as many more as it takes for the track to span
     the viewport twice — the loop needs copyWidth * (copies - 1) to cover the
     screen or the tail is visible as the head comes round. */
  const buildCopy = (): HTMLElement => {
    const frag = document.createElement('div');
    frag.style.display = 'contents';
    for (const name of items) frag.append(el('span', itemClass, name));
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
  // Derived from width, not fixed, so the row travels at a readable rate
  // whatever the list length does. 90px/s matches the hero marquee.
  const duration = (track.scrollWidth * (step / 100)) / 90;

  const loop = gsap.fromTo(
    track,
    { xPercent: 0 },
    { xPercent: -step, duration, ease: 'none', repeat: -1 },
  );

  /* Scroll velocity and pointer hover are two inputs to ONE rate, combined
     here rather than each writing timeScale. Two writers on a rate is how the
     hero marquee ended up stuck at whatever the last event said. */
  let scrollTarget = 1;
  let hoverTarget = 1;
  let rate = 1;

  lenis?.on('scroll', ({ velocity }: { velocity: number }) => {
    scrollTarget = gsap.utils.clamp(-5, 5, 1 + velocity * 0.06);
  });

  box.addEventListener('pointerenter', () => {
    hoverTarget = 0.15;
  });
  box.addEventListener('pointerleave', () => {
    hoverTarget = 1;
  });

  gsap.ticker.add(() => {
    scrollTarget += (1 - scrollTarget) * 0.08;
    const want = scrollTarget * hoverTarget;
    rate += (want - rate) * 0.12;
    if (Math.abs(rate - want) < 0.001) return;
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

const collabs = document.querySelector<HTMLElement>('[data-collabs]');

if (collabs) {
  /* The readable list, built from the same array as the row so the two cannot
     drift. The row itself is aria-hidden: it repeats its own content. */
  const listOut = collabs.querySelector<HTMLElement>('[data-collab-list]');
  if (listOut) {
    listOut.textContent = `Lewis Hamilton's partners: ${PARTNERS.join(', ')}.`;
  }

  const track = collabs.querySelector<HTMLElement>('.collabs__track');
  const marqueeBox = collabs.querySelector<HTMLElement>('[data-collab-marquee]');

  if (track && marqueeBox) {
    mountMarquee({ track, box: marqueeBox, items: PARTNERS, itemClass: 'collabs__item' });
  }

  /* ---- the drawn word ---- */

  const strokes = [...collabs.querySelectorAll<SVGPathElement>('.collabs__stroke path')];

  if (strokes.length && !reducedMotion) {
    const lengths = strokes.map((p) => p.getTotalLength());
    const total = lengths.reduce((a, b) => a + b, 0);

    for (const [i, path] of strokes.entries()) {
      path.style.strokeDasharray = String(lengths[i]);
      path.style.setProperty('--draw-offset', String(lengths[i]));
    }

    /* Paced by INK, not by path count. The eight strokes differ by more than
       four to one in length, so advancing one path per equal slice of scroll
       would crawl through the C and flick through the s. Splitting the scroll
       by cumulative length instead makes the pen travel at a constant speed. */
    const draw = (p: number): void => {
      const drawn = p * total;
      let consumed = 0;
      for (const [i, path] of strokes.entries()) {
        const len = lengths[i] ?? 0;
        const here = gsap.utils.clamp(0, 1, (drawn - consumed) / len);
        path.style.setProperty('--draw-offset', String(len * (1 - here)));
        consumed += len;
      }
    };

    draw(0);

    /* Plays itself once, rather than being scrubbed.
     *
     * The reference's artboard is scroll-triggered but not scroll-SCRUBBED: it
     * is a state machine that runs on entry at its own pace. Scrubbing it ties
     * the pen to the wheel, so a slow reader writes the word slowly and a fast
     * one never sees it written at all. On a one-shot the hand always moves at
     * the speed of a hand.
     *
     * power1.inOut over 1.9s: a linear pen starts and stops dead, which reads
     * as a plotter. `once` because a word that rewrites itself every time it
     * scrolls back into view is a distraction, not a flourish. */
    const pen = { t: 0 };
    ScrollTrigger.create({
      trigger: collabs,
      start: 'top 75%',
      once: true,
      onEnter: () => {
        gsap.to(pen, {
          t: 1,
          duration: 1.9,
          ease: 'power1.inOut',
          onUpdate: () => draw(pen.t),
        });
      },
    });
  }
}

/* ------------------------------------------------------------------ *
 * Socials — the deal.
 *
 * The cards start stacked exactly on the centre card and open into the
 * measured fan. CSS composes it: every offset is multiplied by --spread, so
 * zero puts all seven in one place without a second set of coordinates to
 * keep in step with the first.
 *
 * Staggered from the CENTRE OUT rather than left to right, which is what makes
 * it read as a deal rather than as a queue — the middle card is already home
 * while the outer pair is still travelling.
 * ------------------------------------------------------------------ */

const fan = document.querySelector<HTMLElement>('.socials__fan');


/* ------------------------------------------------------------------ *
 * Footer.
 *
 * Two independent pieces: the nav has to cross to its dark-ground styling
 * while the panel is behind it, and the partner row is the same marquee as
 * the one above the socials in a different colour.
 * ------------------------------------------------------------------ */

/* The nav crosses to its dark-ground styling while the footer panel is behind
   it — the same signal the gallery uses, asserted from a different place.
   Ends at the nav's own height rather than at the viewport top, because what
   decides the wordmark's colour is what is under the WORDMARK. */
const footerPanel = document.querySelector<HTMLElement>('.footer__panel');

if (footerPanel) {
  const navHeight = (): number =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) *
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 0;

  ScrollTrigger.create({
    trigger: footerPanel,
    start: () => `top top+=${navHeight()}`,
    end: 'bottom top',
    invalidateOnRefresh: true,
    onToggle: (self) => {
      groundCross.panel = self.isActive ? 1 : 0;
      applyGroundCross();
    },
  });
}

/* The footer's row: the same names and the same behaviour as the partners row
   above, in the accent instead of the ink, plus the drift that row does not
   have. aria-hidden in the markup — the readable list is the one up there. */
const footerMarquee = document.querySelector<HTMLElement>('[data-footer-marquee]');
const footerTrack = footerMarquee?.querySelector<HTMLElement>('.footer__track');

if (footerMarquee && footerTrack) {
  mountMarquee({
    track: footerTrack,
    box: footerMarquee,
    items: PARTNERS,
    itemClass: 'footer__item',
    drift: 5,
    scroller: footerMarquee.querySelector<HTMLElement>('.footer__marquee-scroll'),
  });
}
if (fan) {
  const cards = [...fan.querySelectorAll<HTMLElement>('.socials__card')];

  if (reducedMotion || !cards.length) {
    // The arrangement is the content here; only the travel to it is motion.
    fan.classList.add('is-settled');
  } else {
    for (const card of cards) {
      card.style.setProperty('--rise', '1');
      card.style.setProperty('--spread', '0');
      // Both hover signals start explicitly at rest. GSAP reads the computed
      // value to tween FROM, and an unset custom property computes to the empty
      // string rather than to the var() fallback the transform names.
      card.style.setProperty('--push', '0rem');
      card.style.setProperty('--lean', '0deg');
    }

    ScrollTrigger.create({
      trigger: fan,
      start: 'top 80%',
      once: true,
      onEnter: () => {
        gsap
          .timeline({ onComplete: () => fan.classList.add('is-settled') })
          /* One at a time, and quickly. They arrive in document order rather
             than from the centre, because this is a stack being built: each
             card lands on the one before it. 55ms apart is fast enough that the
             seven read as one gesture and slow enough to see them arrive
             separately. */
          .to(cards, {
            '--rise': 0,
            duration: 0.5,
            ease: 'power3.out',
            stagger: 0.055,
          })
          /* Then the stack opens. From the CENTRE OUT this time — the middle
             card is already home while the outer pair is still travelling,
             which is what reads as a deal rather than as a queue.
           *
             Overlapped by 0.15s so the last card has not quite settled when the
             spread begins. Waiting for a full stop puts a beat between the two
             halves and they stop reading as one move. */
          .to(
            cards,
            {
              '--spread': 1,
              duration: 1.1,
              ease: 'power3.out',
              stagger: { each: 0.075, from: 'center' },
            },
            '-=0.15',
          );
      },
    });

    /* ---- hover: the card pops, the fan opens around it ----
     *
     * Measured off the reference rather than invented. Hovering its middle card
     * moves the neighbours out by 131.9px, the pair beyond them by 56.5px and
     * the outermost pair by NOTHING — and hovering an off-centre card leaves the
     * outermost card on that side equally still. So the fan does not get wider
     * on hover; it redistributes inside a fixed span.
     *
     * That is the whole model: the gap beside the hovered card opens by OPEN,
     * and every gap further out compresses proportionally to pay for it, which
     * pins the outer edge and makes the displacement taper to zero there. Fitted
     * against the reference it predicts 7.47 / 3.13 / 0 rem where the reference
     * measures 7.47 / 3.20 / 0 — inside 2%.
     *
     * The old version pushed on a 1/distance curve topping out at 2.6rem, barely
     * a third of this, so the hovered card grew into neighbours that had hardly
     * moved. It hid that by jumping the card 20 above its own z-index, which
     * fixed the overlap by breaking the fan's depth order instead. The reference
     * never restacks — its z stays 1,2,3,10,3,2,1 through every hover — because
     * once the neighbours actually move there is nothing left to cover.
     *
     * back.out overshoots once and settles. elastic rings several times, which
     * on seven cards at once reads as a wobble rather than as give. */
    const SPRING = 'back.out(2.2)';
    /** The measured rest offsets, in rem, indexed to match `cards`. */
    const FAN_X = [-30, -22.02, -10.98, 0, 10.98, 22.02, 30];
    /** How far the gap beside the hovered card opens. 131.9px at a 17.667 root. */
    const OPEN = 7.47;
    /** Neighbours also rotate a touch further out — 1.5deg at the nearest. */
    const LEAN = 1.5;

    /* The markup and this table have to describe the same fan. If they ever
       disagree the geometry below is meaningless, so say so rather than
       quietly treating a missing card as sitting at the centre. */
    const restX = (i: number): number => {
      const x = FAN_X[i];
      if (x === undefined) throw new Error(`socials fan: no rest offset for card ${i}`);
      return x;
    };

    const displace = (hovered: number, i: number): number => {
      if (i === hovered) return 0;
      const dir = Math.sign(i - hovered);
      const edge = dir > 0 ? cards.length - 1 : 0;
      const near = hovered + dir;
      // The neighbour IS the pinned edge, so there is no gap left to compress
      // into and that side simply holds still.
      if (near === edge) return 0;
      const span = restX(edge) - restX(near);
      return dir * OPEN * (1 - (restX(i) - restX(near)) / span);
    };

    const settle = (hovered: number | null): void => {
      cards.forEach((card, i) => {
        const isHovered = hovered === i;
        const distance = hovered === null ? 0 : Math.abs(i - hovered);
        const push = hovered === null ? 0 : displace(hovered, i);
        const lean = distance === 0 ? 0 : (Math.sign(i - hovered!) * LEAN) / distance;
        gsap.to(card, {
          '--pop': isHovered ? 1 : 0,
          '--push': `${push}rem`,
          '--lean': `${lean}deg`,
          duration: isHovered || hovered === null ? 0.55 : 0.7,
          ease: SPRING,
          overwrite: 'auto',
        });
      });
    };

    cards.forEach((card, i) => {
      card.addEventListener('pointerenter', () => settle(i));
    });
    // On the FAN, not on each card: leaving one card for the next fires a leave
    // before the enter, and resetting in between makes the row flinch.
    fan.addEventListener('pointerleave', () => settle(null));
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
  /* Hides the lines so they can be swept in. Set here rather than in the
     stylesheet so the hidden state cannot outlive the code that reveals it. */
  document.documentElement.dataset.revealAnimated = '';

  const lines = [...document.querySelectorAll<HTMLElement>('.reveal-text')];

  /**
   * The stagger, counted within a section rather than across the document.
   *
   * It used to be the element's global index, which quietly punished anything
   * far down the page: the On Track and Off Track blurbs came out at 1260ms and
   * 1350ms and visibly trailed the section they belong to. The stagger exists to
   * make one group read top to bottom, so it has to restart at each group —
   * otherwise it is not a stagger, it is an accumulating delay.
   */
  /* ---- splitting a block into one bar per visual line ----
   *
   * The reference does this and it is the whole reason its copy arrives a line
   * at a time: every paragraph is cut into <span class="line"> boxes, each with
   * its own bar, ~0.15s apart. One bar across a four-line paragraph cannot
   * express that no matter how it is eased.
   *
   * Lines are a rendering fact, not a markup one, so they have to be MEASURED:
   * wrap each word, read the line box it landed in off offsetTop, then rebuild
   * the block one span per distinct box. */

  /* Read from --stagger-line rather than restated here. The token said 150ms
     and this said 150, which is two sources of truth for one beat — and the
     token was the one nothing read, so tuning it did nothing. */
  const LINE_STAGGER =
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--stagger-line'),
    ) || 150;

  /** The words as authored, kept so a re-split starts from the text and not
      from the spans left by the previous one. */
  const sourceOf = (el: HTMLElement): string => {
    if (el.dataset.revealSource === undefined) el.dataset.revealSource = el.textContent ?? '';
    return el.dataset.revealSource;
  };

  /* Text-only blocks, laid out as blocks. Anything carrying element children has
     markup worth more than the cascade — a link, an emphasis, a nested span —
     and rebuilding it from textContent would silently throw that away. */
  const splittable = (el: HTMLElement): boolean =>
    el.childElementCount === 0 &&
    (el.textContent ?? '').trim().length > 0 &&
    getComputedStyle(el).display.includes('block');

  const splitIntoLines = (el: HTMLElement, baseDelay: number): void => {
    const source = sourceOf(el);

    // Every word its own box, so offsetTop reports which line it fell on.
    el.textContent = '';
    const words: HTMLElement[] = [];
    for (const token of source.split(/(\s+)/)) {
      if (!token) continue;
      if (/^\s+$/.test(token)) {
        el.appendChild(document.createTextNode(token));
        continue;
      }
      const word = document.createElement('span');
      word.textContent = token;
      el.appendChild(word);
      words.push(word);
    }

    const rows: string[][] = [];
    let current: string[] = [];
    let lastTop: number | null = null;
    for (const word of words) {
      const top = word.offsetTop;
      // A tolerance rather than equality: superscripts and inline images sit a
      // pixel or two off their neighbours without starting a new line.
      if (lastTop === null || Math.abs(top - lastTop) > 1) {
        current = [];
        rows.push(current);
        lastTop = top;
      }
      current.push(word.textContent ?? '');
    }

    // One line is not a cascade, and wrapping it would swap its inline layout
    // for a block one for no gain. Put the text back exactly as it was.
    if (rows.length < 2) {
      el.textContent = source;
      delete el.dataset.revealSplit;
      return;
    }

    el.textContent = '';
    rows.forEach((row, i) => {
      const line = document.createElement('span');
      line.className = 'reveal-line';
      line.textContent = row.join(' ');
      line.style.setProperty('--reveal-delay', `${baseDelay + i * LINE_STAGGER}ms`);
      el.appendChild(line);
    });
    el.dataset.revealSplit = '';
  };

  const groupOf = (el: HTMLElement): Element => el.closest('section') ?? document.body;
  /* 25ms, not the 90ms this used to be. The reference's own staggers measure
     0.015-0.03s and cluster on 0.02s; 90ms was more than four times its widest.
     Across the six lines of On Track / Off Track that put the last one 450ms
     behind the first, and on top of the time the bar spends covering it the
     closing line did not read for the better part of a second after the section
     had arrived. At 25ms those six span 125ms and still resolve top to bottom
     rather than snapping in together. */
  const delayFor = (el: HTMLElement): number => {
    const group = groupOf(el);
    const peers = lines.filter((line) => groupOf(line) === group);
    return peers.indexOf(el) * 25;
  };

  /* Split every block that turns out to be more than one line long.
   *
   * After the fonts, not before: line boxes measured against the fallback face
   * break in different places, and a block cut on those breaks keeps the wrong
   * cuts once the real face swaps in.
   *
   * Re-cut on resize for the same reason. Between 992 and 1920 the root scales
   * with the viewport so the text and its column grow together and the breaks
   * barely move, but below 992 the root locks at 16px while the column keeps
   * narrowing — and there the breaks change completely. A block that has
   * already played is marked done rather than re-cut into a fresh animation,
   * so re-measuring never replays a reveal the reader has watched. */
  const applySplits = (): void => {
    for (const el of lines) {
      if (!splittable(el)) continue;
      const played = el.classList.contains('is-in');
      splitIntoLines(el, delayFor(el));
      if (played) el.classList.add('is-done');
    }
  };

  void document.fonts.ready.then(() => {
    applySplits();
    // The rebuild can move a block's height by a fraction of a line, and every
    // pinned section below it is positioned off that.
    ScrollTrigger.refresh();
  });

  let resplit = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resplit);
    resplit = window.setTimeout(applySplits, 200);
  });

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

  /* Gallery captions enter sideways, not from below, so the bottom margin that
     holds back a normal reveal is on the wrong axis for them — it would do
     nothing at all. They also arrive one at a time under the horizontal scrub,
     which already staggers them; a document-order delay on top of that would
     fire a caption long after its own picture had gone past. */
  const galleryLines = lines.filter((el) => el.closest('.gallery'));
  const scrollLines = lines.filter((el) => !el.closest('.hero') && !el.closest('.gallery'));

  for (const line of heroLines) line.style.setProperty('--reveal-delay', `${delayFor(line)}ms`);
  onReady(() => {
    for (const line of heroLines) line.classList.add('is-in');
  });

  const textRevealer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        el.style.setProperty('--reveal-delay', `${delayFor(el)}ms`);
        el.classList.add('is-in');
        textRevealer.unobserve(el);
      }
    },
    /* A LEAD, not an inset. This used to be -8%, which held the reveal back
       until the line was already 8% of the viewport inside the frame — so the
       bar's covering half ran in full view and the line sat blank while the
       reader was looking straight at it.
     *
     * +10% starts it just under a viewport-tenth before the line crosses the
     * edge, which is roughly the covering half at an ordinary scroll rate. What
     * arrives on screen is the bar already retracting off finished text, which
     * is the half of this animation worth watching. */
    { rootMargin: '0px 0px 10% 0px' },
  );
  for (const line of scrollLines) textRevealer.observe(line);

  /* Inset on the RIGHT, which is the edge a caption actually crosses. A caption
     fires once it is properly inside the frame rather than the instant it clips
     the boundary, so the sweep reads as part of the picture arriving instead of
     something that already happened off-screen. */
  const galleryRevealer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        galleryRevealer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px -14% 0px 0px' },
  );
  for (const line of galleryLines) galleryRevealer.observe(line);
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

/**
 * Every Rosso button below the nav: the two On Track / Off Track arrows and the
 * hall of fame's closing callout.
 *
 * Same fill as the store button, mounted the same way — these are the only
 * other Rosso buttons on the page, so they should answer the pointer the way
 * the nav does rather than with a hover of their own invention. Each gets its
 * own state, so hovering one never moves another.
 */
function mountSectionFills(): void {
  const buttons = document.querySelectorAll<HTMLAnchorElement>(
    '.otot__link, .hof__cta-link, .store-cta__link, .footer-cta__link',
  );
  for (const link of buttons) {
    mountLiquidFill(link, (level) => link.style.setProperty('--liquid-level', String(level)));
  }
}

mountMonogram();
mountStoreFill();
mountSectionFills();

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
  let bgRenderer: THREE.WebGLRenderer | null = null;

  if (bgStage && !reducedMotion) {
    /* No alpha: this is the bottom layer and paints every pixel, so an alpha
       buffer only adds a blend the compositor then has to resolve. No antialias
       either — the scene is one fullscreen quad, and there is no geometry edge
       for MSAA to find. Neither is a downgrade from the hero; both are settings
       the hero needs and this does not. */
    bgRenderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    /* The SAME cap as the hero. This was 1.5, on the reasoning that a field of
       flat colour needs fewer pixels than a portrait — but the field is thin
       contour lines, which is exactly what undersampling shows up on, and on a
       HiDPI display it put softer lines behind a crisply drawn plate. The whole
       layer costs 0.015ms a frame; there was nothing to save. */
    bgRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

  /* Resolved once. The scrub writes to it every frame, and a querySelector per
     frame is a lookup the shrink does not need to repeat. */
  const navStyle = document.querySelector<HTMLElement>('.nav-inner')?.style;

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
    /* Switches the hero's four layers from the static overlap to the pinned
       layout. Set here, inside the branch that builds the timeline, so the CSS
       cannot end up describing a sequence that was never constructed. */
    document.documentElement.dataset.heroPinned = '';

    const p = { t: 0 };

    /**
     * Everything the shrink writes, for a raw progress through the pin.
     *
     * Named and called from two places on purpose. ScrollTrigger.refresh()
     * scrolls the document to 0 to take its measurements, which renders this
     * tween at t=0 and writes the whole top-of-hero state into the DOM; it then
     * restores the scroll and re-applies progress with events SUPPRESSED, so
     * onUpdate does not fire again. A tween with rendered properties survives
     * that, because the properties are re-applied either way — but every output
     * here is a side effect of the callback, so nothing came back and the page
     * was left describing the top of the hero from wherever it had been
     * reloaded or resized. The field then never drew at all, since the frame
     * loop gates on `shrunk`, and the ground went flat white.
     *
     * Driving it from onRefresh as well is what the gallery and both On/Off
     * Track triggers already do, for the same reason.
     */
    const applyShrink = (t: number): void => {
      /* Two clocks: t is raw scroll through the pin, eased is the plate's
         curve. Anything belonging to the shrink reads `eased`; anything that
         should advance evenly with the wheel reads `t`. */
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

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
      rawProgress = t;
      if (signature) {
        signature.progress = (t - SIGN_FROM) / (SIGN_TO - SIGN_FROM);
      }
      // Muted, not faded. Draining saturation keeps the plate solid; dropping
      // opacity would dissolve it into the screen behind. Stops at 0.2 — a
      // fully grey plate reads as broken rather than as receding.
      head.saturation = 1 - 0.8 * eased;
      // The furniture belongs to the full-bleed screen, so it clears early —
      // gone by the time the plate is a third of the way in.
      heroTrack.style.setProperty(
        '--hero-furniture',
        String(Math.max(0, 1 - eased / 0.3)),
      );
      /* These three go on the NAV, not on the document element.
       *
       * A custom property set on :root invalidates style for every element
       * that could inherit it, which is all of them — so writing three of
       * them per frame was scheduling three whole-document style recalcs on
       * every frame of the shrink. Every consumer of all three lives inside
       * .nav-inner (the wordmark, its two halves, the monogram, the topbar),
       * so scoping the write there confines the recalc to about a dozen
       * elements. Nothing about the rendered result changes. */
      // The nav does not travel; it is already fixed in the corners. It just
      // settles smaller as the screen behind it changes.
      navStyle?.setProperty('--nav-shrink', String(1 - 0.18 * eased));

      /* The nav's monogram clears early and does NOT come back. It used to
         return over the last tenth of the shrink, but the nav is fixed — so
         the mark it brought back then hung over every section below the hero
         instead of belonging to the plate. The copy in .hero-mark takes that
         job over and travels with the plate. */
      navStyle?.setProperty('--mono-in', String(Math.max(0, 1 - eased / 0.15)));

      /* And here it is, arriving as the plate settles. Late and quick, so it
         lands WITH the plate rather than drifting in alongside it. Set on the
         track rather than the root, for the same reason as the nav's. */
      heroTrack.style.setProperty(
        '--hero-mark',
        String(gsap.utils.clamp(0, 1, (eased - 0.82) / 0.18)),
      );

      /* Wordmark crosses to the revealed screen's palette. Giallo on that
         cream measures about 1.06:1, so it has to. Eased, not raw — it tracks
         the screen changing, and a linear ramp would leave it half-inverted
         while the hero still filled the frame. */
      navStyle?.setProperty(
        '--nav-invert',
        String(gsap.utils.clamp(0, 1, (eased - 0.1) / 0.5)),
      );
    };

    gsap.to(p, {
      t: 1,
      /* LINEAR, so `p.t` is raw scroll position through the pin.
       *
       * The reference's curve on the plate is power1.inOut — confirmed against
       * its own render at nine consecutive scroll increments, matching to within
       * a pixel — and that curve is applied inside applyShrink, explicitly, to
       * the things that want it. It used to live here on the tween instead,
       * which meant EVERYTHING read an eased clock, including the signature.
       * That is what made the signature feel like it snapped: it started near
       * the middle of the pin, which is exactly where an inOut curve is moving
       * fastest, so it inherited the plate's acceleration on top of its own. */
      ease: 'none',
      onUpdate: () => applyShrink(p.t),
      scrollTrigger: {
        trigger: heroTrack,
        start: 'top top',
        end: () => `+=${window.innerHeight}`,
        scrub: true,
        invalidateOnRefresh: true,
        // See applyShrink. Without this a reload or a resize anywhere past the
        // hero leaves the whole page in its scroll-zero state.
        onRefresh: (self) => applyShrink(self.progress),
      },
    });
  }

  /* Live handle on the scene, the way the reference exposes window.landoGL.
     Reading and setting values from the console beats re-editing source to tune
     by eye, and ScrollTrigger rides along so a trigger's live start, end and
     progress can be read directly. Typed rather than cast, so a rename here is
     a compile error rather than a console session that quietly returns
     undefined. */
  // lenis too: without it there is no way to put the page at an exact scroll
  // position from the console. window.scrollTo fights the smoothing and the
  // page drifts somewhere else entirely, which makes every measurement a lie.
  window.hamiltonGL = { head, renderer, background, bgRenderer, ScrollTrigger, lenis };

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
    // Nothing on screen is worth a frame: the panel is opaque over both canvases.
    if (document.documentElement.hasAttribute('data-menu-open')) return;

    /* The field is the page's ground now, so it is on screen for the whole
       document and cannot be gated on the hero being visible. Two things still
       gate it:
         - the plate covering the viewport, which is where anyone who never
           scrolls stays. The threshold is above zero because the scrub settles
           on values like 1e-7.
         - a backgrounded tab. rAF already throttles hard there, but not always
           to zero, and this is the one pass that now runs the whole page. */
    if (shrunk > 0.001 && !document.hidden) {
      background?.update();
      background?.render();
    }

    // The portrait is the opposite case: it is a fixed-size plate that leaves
    // the viewport for good, so it stops as soon as it is gone.
    if (!heroVisible) return;

    /* It keeps drawing after it goes inert, though. No preserveDrawingBuffer, so
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
