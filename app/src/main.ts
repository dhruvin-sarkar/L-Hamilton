// The stylesheet is NOT imported here. index.html links it in the head so it is
// render-blocking; importing it from this module made it arrive only after the
// whole graph resolved, which painted the page unstyled first. See the note on
// that link element.
import * as THREE from 'three';
import Lenis from 'lenis';
import { gsap, mm, reducedMotion, ScrollTrigger, WIDE_AND_ANIMATED } from './lib/motion';
import { mountChrome } from './lib/chrome';
import { hasTrack, mountCircuit } from './lib/circuit';
import { mountGalleryScroll } from './lib/gallery';
import { mountReveals } from './lib/reveal';
import { mountHelmets, mountHofDrift, mountSocials, mountStore } from './lib/showcase';
import { BackgroundField } from './BackgroundField';
import { HeadScene } from './HeadScene';
import { Signature } from './Signature';
import { age, driver, eras, seasonsRacing } from './content/hamilton';
import { nextRound } from './content/live-stats';

/** The era he is in now — the one with no end date. */
const currentEra = eras.find((e) => e.to === null);
if (!currentEra) {
  // Fail fast: an eras list where every entry has ended means the data is stale,
  // and silently rendering a blank team line would hide that.
  throw new Error('[content] no ongoing era — eras data is out of date');
}

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
  /* Read off the reference's own live window.lenis.options, not chosen. lerp
     0.14 here was a measurably tighter scroll than the reference's 0.1 — a
     ~110ms time constant against its ~158ms — and the whole parity mandate
     cashes out to how the page feels under the wheel, so this is the single
     value the rest of the site's motion is judged against. TECH-STACK.md
     already specified 0.1; this had drifted off it.

     The four touch options were absent entirely, so touch feel matched nothing
     at all. autoRaf stays false, as the reference's is: the ticker below drives
     raf so Lenis and ScrollTrigger share one clock. */
  const instance = new Lenis({
    lerp: 0.1,
    smoothWheel: true,
    syncTouch: true,
    syncTouchLerp: 0.075,
    wheelMultiplier: 1,
    touchMultiplier: 1.25,
  });
  /* The reference also sets touchInertiaMultiplier: 35. Deliberately NOT
     copied: Lenis renamed that option to touchInertiaExponent in 1.x and it is
     a different formulation — an exponent, not a multiplier — so passing 35
     would not reproduce the reference's feel, it would break touch inertia
     outright. Left at the library default until someone measures the curve. */

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
  /* The calendar feed has landed, so this is the real next round rather than
     the placeholder this card shipped with. Still degrades honestly: past the
     final race of a season there is no next round, and TBC is then the true
     answer rather than a stale one. The card's markup supplies the "gp" after
     it, so the suffix comes off the name. */
  'race-name': nextRound()?.raceName.replace(/ Grand Prix$/, '') ?? 'TBC',
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

    /* Identical copies side by side. The loop shifts by exactly one of them, so
       copy 2 lands where copy 1 was and the seam is invisible — one copy is the
       pattern's period and the only distance that keeps its phase.
     *
     * Build one, measure it, then take only as many as the shift needs:
     * copyWidth * (copies - 1) >= viewport. A fixed count overshoots badly —
     * four copies of this text made a 14,535px composited layer.
     *
     * One run of words per copy with a trailing space, no glyph between the
     * phrases: the reference's band is a single string (TEXT + " ") and its
     * copies are parted only by that space and the seam gap in CSS. */
    const addCopy = () => {
      track.append(el('span', 'marquee__item', `${words.join(' ')} `));
    };

    addCopy();
    const copyWidth = track.scrollWidth;
    /* +1 for the copy that gets shifted out, and never fewer than two — with a
       single copy there is no second one to hand over to at the seam. */
    const copies =
      copyWidth > 0
        ? Math.max(2, Math.ceil(row.clientWidth / copyWidth) + 1)
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

      /* Duration derived from WIDTH rather than fixed, or the two bands travel
         at visibly different speeds whenever their copy differs in length.
       *
       * The reference moves each band one world unit a second, and 6.906 units
       * span the viewport's height: 14.48vh a second on screen. The bottom row
       * is squeezed to 0.9 by a transform its track sits inside, so its own
       * layout distance is a ninth longer for the same on-screen speed. */
      const squeeze = rightward ? 0.9 : 1;
      const pxPerSecond = (window.innerHeight / 6.906) / squeeze;
      const duration = (track.scrollWidth * (step / 100)) / pxPerSecond;

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

    /* Scroll speeds the bands up, in either scroll direction — the reference
       adds |lenis.velocity| x 0.001 units to each frame's 1/60-unit step, so
       the rate is 1 + 0.06|v| and the bands never reverse. Read per frame off
       Lenis, which already smooths its velocity, exactly as the reference does. */
    let rate = 1;
    gsap.ticker.add(() => {
      const next = 1 + Math.abs(lenis?.velocity ?? 0) * 0.06;
      // Below a thousandth of base speed the difference is not observable, and
      // skipping it keeps the timeScale writes out of an idle frame.
      if (Math.abs(next - rate) < 0.001) return;
      rate = next;
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
  }
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
/* The wall is built before any ScrollTrigger is created, so the page is its
   final height when they measure. That ordering is the reason this call sits
   here rather than beside the other two below. */
mountHelmets();


/* The horizontal scroll itself is a component -- On Track runs the same one --
   so it lives in lib/gallery.ts. What stays here is the half that is Home's
   alone: the WebGL ground darkening under it as it scrubs past.
 *
 * The reference's own timing, which Home shares with On Track — both run one
 * function, I_() in lando-gl.js: travel starts as the section's top enters
 * from below, the section is exactly as tall as the travel, and the track
 * catches up over a one-second scrub. */
mountGalleryScroll({ start: 'rising', scrub: 1 });

mm.add(WIDE_AND_ANIMATED, () => {
  if (!gallery) return;

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
    gallery.style.removeProperty('--gallery-dark');
    gallery.style.removeProperty('--gallery-ink');
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

mountHofDrift();
mountStore({
  /* Home has a field to report into; the model in this file owns what the
     value means. See lib/showcase.ts for why it is reported rather than
     written. */
  onGround: (p) => {
    groundCross.lightening = p;
    applyGroundCross();
  },
});
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
  /** Travel direction. The reference runs both of its rows to the RIGHT. */
  direction?: 'left' | 'right';
  /** Loop rate. Measured off the reference at ~92px/s on both of its rows. */
  pxPerSecond?: number;
  /** The reference does not slow either row under the pointer. */
  slowOnHover?: boolean;
}): void {
  const {
    track, box, items, itemClass, drift = 0, scroller = null,
    direction = 'right', pxPerSecond = 92, slowOnHover = false,
  } = opts;

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
mountSocials();

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
 * lib/reveal.ts, because On Track leans on the same mechanic far harder
 * than home does. The two selectors below are the only parts that were ever
 * specific to this page.
 * ------------------------------------------------------------------ */

/* Gallery lines fire as they cross 95% of the width — the reference's
   containerAnimation trigger, "left 95%". */
mountReveals({
  immediate: '.hero',
  sideways: '.gallery',
  sidewaysMargin: '0px -5% 0px 0px',
  whenReady: onReady,
});
/* ------------------------------------------------------------------ *
 * Circuit outline — drawn on rather than faded in.
 * ------------------------------------------------------------------ */

/* The real traced circuit, from the same file On Track draws from. The hand
 * drawn loop below stays in the markup as the fallback: two rounds of the 2026
 * calendar have no shape in the file, and a generic loop is a more honest
 * answer there than some other track's outline.
 *
 * In the accent, like every circuit on the site — left to itself the file draws
 * in the reference's lime, which is the one colour this rebuild replaces. */
const homeCircuitHost = document.querySelector<HTMLElement>('[data-home-circuit-host]');
const homeRound = nextRound();
if (homeCircuitHost && homeRound && hasTrack(homeRound.circuitId)) {
  void mountCircuit(homeCircuitHost, { circuitId: homeRound.circuitId }).then(
    () => {
      // The loop steps aside only once a real shape is drawing over it.
      homeCircuitHost.dataset.circuitDrawn = '';
    },
    (error: unknown) => {
      console.warn('[home] next-race circuit did not load', error);
    },
  );
}

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
 * Site chrome — nav, menu, and the shared button behaviours.
 *
 * Lives in lib/chrome.ts because every page includes the same nav and menu
 * partials and must therefore share their behaviour, not copy it.
 * ------------------------------------------------------------------ */

mountChrome();

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
  /* Kept alongside navStyle: the mark needs a class toggled on it once it has
     faded out completely, which a custom property cannot express. */
  const monogram = document.querySelector<HTMLElement>('.nav-inner .monogram');

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
      /* ...and the pixels that split costs us, handed back.
         A clip inset removes from the element's own box, so an uneven split
         moves the surviving band's centre to 0.5 - 0.25 * cropYTotal of the
         box; scale() then works about the BOX centre, not the band's, and
         carries that offset with it. The plate therefore landed
         0.25 * cropYTotal * vh * zoom ABOVE the viewport centre — 32px at the
         landing values, measured, against a reference whose plate is centred
         to half a pixel at every moment of the close.
         Compensated here rather than by evening the split, because the uneven
         split is the point: it is what holds the face centred in the box. */
      cropShift: cropYTotal * 0.25 * vh * zoom,
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

    /* The furniture closes the moment the page leaves zero and reopens at the
       top — the reference toggles its card's `.hidden` exactly there (hidden at
       2px, shown at 0). A toggle rather than a scrub; the clip and its timing
       live in home.css. */
    const heroSection = heroTrack.querySelector<HTMLElement>('.hero');
    const syncFurniture = (): void => {
      heroSection?.classList.toggle('is-scrolled', window.scrollY > 0);
    };
    window.addEventListener('scroll', syncFurniture, { passive: true });
    syncFurniture();

    /* The landed label rises a character at a time, so each one is its own box
       carrying its index; the pacing is CSS's, off --hero-t. */
    const heroEyebrow = heroTrack.querySelector<HTMLElement>('[data-hero-eyebrow]');
    if (heroEyebrow) {
      const text = heroEyebrow.textContent ?? '';
      heroEyebrow.textContent = '';
      // Counted over letters only, as the reference splits its label: a space
      // is not a character that arrives.
      let letter = 0;
      for (const char of text) {
        const box = el('span', 'hero-mark__char', char);
        box.style.setProperty('--i', String(char === ' ' ? letter : letter++));
        heroEyebrow.append(box);
      }
    }

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
      stage.style.setProperty('--hero-crop-shift', `${box.cropShift}px`);

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
      /* These go on the NAV, not on the document element.
       *
       * A custom property set on :root invalidates style for every element
       * that could inherit it, which is all of them — so writing them per
       * frame was scheduling whole-document style recalcs on every frame of
       * the shrink. Every consumer lives inside .nav-inner (the wordmark, its
       * two halves, the monogram, the topbar), so scoping the write there
       * confines the recalc to about a dozen elements.
       *
       * The nav's own settle is not on this clock: the reference runs it over
       * the first tenth of a screen on every page, so it lives with the rest of
       * the chrome — mountNavSettle in lib/chrome.ts. */

      /* The nav's monogram clears early and does NOT come back. It used to
         return over the last tenth of the shrink, but the nav is fixed — so
         the mark it brought back then hung over every section below the hero
         instead of belonging to the plate. The copy in .hero-mark takes that
         job over and travels with the plate. */
      const monoIn = Math.max(0, 1 - eased / 0.15);
      navStyle?.setProperty('--mono-in', String(monoIn));
      /* CSS cannot branch on a number, so the fully-faded state is carried as a
         class. Without it the mark stays hit-testable and tabbable at opacity 0
         for the whole document below the hero. */
      monogram?.classList.toggle('is-faded', monoIn === 0);

      /* And here it is, arriving as the plate settles, with its label. Both
         are paced in CSS off the raw clock (see .hero-mark), so one number
         drives the mark and every character of the label. Set on the track
         rather than the root, for the same reason as the nav's. */
      heroTrack.style.setProperty('--hero-t', String(t));

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
