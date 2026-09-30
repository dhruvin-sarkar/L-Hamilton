/**
 * The sections Home and On Track both carry.
 *
 * The reference runs the same full-screen picture into the same helmet wall,
 * and the same socials block, at the foot of both pages, and its own study of
 * that says plainly: reuse the component, do not re-implement it
 * (docs/ON-TRACK-REFERENCE.md §13). This module is that reuse. The markup lives
 * in partials/otot-end.html, partials/helmets.html and partials/socials.html
 * (and Home's store in partials/store.html); the behaviour lives here; both
 * entry points call the mounts.
 *
 * Moved out of main.ts unchanged, with one exception, which is the only thing
 * about these sections that actually differs between the two pages: the store's
 * report of how far the ground has come back to light. Home has a WebGL field to
 * report into and On Track does not, so it is a callback rather than a direct
 * write. Everything else is the code that was already verified on Home.
 */

import { gsap, mm, ScrollTrigger, reducedMotion, WIDE_AND_ANIMATED } from './motion';
import {
  helmets,
  helmetSrc,
  helmetSrcset,
  helmetAlt,
  revealSrc,
  revealSrcset,
  revealSize,
  pendingHelmets,
} from '../content/helmets';
import type { Helmet } from '../content/helmets';

/* ------------------------------------------------------------------ *
 * The riser — one screen of photograph handing on to the wall.
 *
 * The reference's `.s.is-otot-end`, which it runs on both pages: Home as the
 * second screen of On Track / Off Track, On Track straight after its
 * schedule. Same picture, same tween, so one mount.
 *
 * A slow push-in over exactly the span in which the frame covers the screen —
 * its top entering at the bottom to its top reaching the top — and then it
 * scrolls away whole. See .otot__end-img in home.css for why the push-in, and
 * not the reference's lift, is what this photograph can take.
 *
 * The progress is written on the riser itself, not on a section around it: on
 * On Track there is no section around it.
 * ------------------------------------------------------------------ */

export function mountRiser(): void {
  mm.add(WIDE_AND_ANIMATED, () => {
    const riser = document.querySelector<HTMLElement>('[data-riser]');
    if (!riser) return;

    const apply = (progress: number): void => {
      riser.style.setProperty('--otot-rise', String(progress));
    };

    gsap.to(
      {},
      {
        ease: 'none',
        scrollTrigger: {
          trigger: riser,
          start: 'top bottom',
          end: 'top top',
          scrub: true,
          invalidateOnRefresh: true,
          // Also on refresh: a reload landing inside the range fires no update
          // until something moves, and the picture would sit at its opening
          // scale rather than where the scroll position puts it.
          onUpdate: (self) => apply(self.progress),
          onRefresh: (self) => apply(self.progress),
        },
      },
    );

    /* Our own inline write, so the context will not clear it. Removed, the CSS
       falls back to the resting value, which is what the stacked layout and
       reduced motion both want. */
    return () => riser.style.removeProperty('--otot-rise');
  });
}

/* ------------------------------------------------------------------ *
 * Helmets hall of fame — the wall itself.
 *
 * Built here rather than written into index.html: 26 entries times two
 * photographs times a label is a lot of markup to keep in step by hand, and
 * every value in it already lives in src/content/helmets.ts. Done before any
 * ScrollTrigger is created, so the page is its final height when they measure.
 * ------------------------------------------------------------------ */

/* Resolved once, at module scope, because two of the mounts below read them —
   the wall builder and the column drift — and neither should depend on having
   been called after the other. */
const hof = document.querySelector<HTMLElement>('[data-hof]');
const hofGrid = document.querySelector<HTMLElement>('[data-hof-grid]');

export function mountHelmets(): void {

  /* The card silhouette, stroked. Inset half a pixel so a 1px line lands inside
     the 407x411 viewBox rather than straddling its edge. The bottom edge steps up
     on the right and returns on a diagonal, and the notch that opens up is where
     the label sits — which is why the shape is not simply a rounded rectangle.

     The #hof-card clipPath in index.html is this same outline normalised to the
     0..1 box, and clips each photograph to it. Change one and the other has to
     follow, or the pictures will stop where the line does not. */
  /* Two outlines, as the reference draws them: the resting line inset half a
     pixel with a non-scaling 2px stroke, the hover line inset a whole pixel at a
     2px stroke that scales with the card. The corners where the step meets the
     diagonal are rounded rather than mitred — 23.5 and 22.5 radii, measured. */
  const HOF_CARD_PATH =
    'M8 .5h390.89a7.5 7.5 0 0 1 7.5 7.5v356.983a7.5 7.5 0 0 1-7.5 7.5H263.329' +
    'a23.502 23.502 0 0 0-18.375 8.849l-16.499 20.695a22.502 22.502 0 0 1-17.593 8.473' +
    'H8A7.5 7.5 0 0 1 .5 403V8A7.5 7.5 0 0 1 8 .5Z';
  const HOF_CARD_PATH_ON =
    'M8 1h390.89a7 7 0 0 1 7 7v356.983a7 7 0 0 1-7 7H263.329a23.999 23.999 0 0 0-18.766 9.038' +
    'l-16.499 20.694A21.999 21.999 0 0 1 210.862 410H8a7 7 0 0 1-7-7V8a7 7 0 0 1 7-7Z';
  /* The phone outline, drawn under 480px in place of the two above: the
     reference's `.helmet-grid-frame-w.mobile`, one 187x188 path for both the
     resting and the hover line. Its step sits at the LEFT, so the notch runs
     three quarters of the card and "Silverstone 2021" fits where the wide
     card's half-width notch would have it across the diagonal. The
     #hof-card-narrow clipPath in partials/helmets.html is this normalised. */
  const HOF_CARD_PATH_NARROW =
    'M8 .5h170.12a7.5 7.5 0 0 1 7.5 7.5v154.61a7.5 7.5 0 0 1-7.5 7.5H60.681' +
    'a10.5 10.5 0 0 0-8.21 3.954l-7.86 9.858a9.5 9.5 0 0 1-7.427 3.578H8' +
    'A7.5 7.5 0 0 1 .5 180V8A7.5 7.5 0 0 1 8 .5Z';

  /** Attribute-safe text. The data is ours, but a name carrying a quote would
      otherwise close the attribute it sits in and swallow the rest of the tag. */
  function attr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  /** Both outlines for one variant; home.css shows the wide one or the narrow
      one by viewport, as the reference toggles its two frame wrappers. */
  function hofFrame(variant: 'base' | 'on'): string {
    const svg = (shape: 'wide' | 'narrow', viewBox: string, d: string) =>
      `<svg class="hof__frame hof__frame--${variant} hof__frame--${shape}" viewBox="${viewBox}" ` +
      `preserveAspectRatio="none" aria-hidden="true"><path d="${d}" /></svg>`;
    return (
      svg('wide', '0 0 407 411', variant === 'on' ? HOF_CARD_PATH_ON : HOF_CARD_PATH) +
      svg('narrow', '0 0 187 188', HOF_CARD_PATH_NARROW)
    );
  }



  /* Not focusable, as the reference's cards are not: a card has no action, so a
     tab stop on each was 26 stops that did nothing. The wearing shot is a hover
     flourish over the helmet shot rather than content of its own, so it is
     decorative, and the helmet's alt and the label carry what there is to say.

     The label only writes the parts that exist. An empty year span still took
     its 0.8rem margin and pushed a name-only label off the notch's right edge;
     a card with neither renders no label at all, as the reference would with
     an empty CMS field. */
  function hofLabel(helmet: Helmet): string {
    const parts = [
      helmet.name ? `<span class="hof__name">${attr(helmet.name)}</span>` : '',
      helmet.year !== null ? `<span class="hof__year">${helmet.year}</span>` : '',
    ].join('');
    return parts ? `<p class="hof__label">${parts}</p>` : '';
  }

  /* Drawn widths for the srcsets. A card is a quarter of the grid from 992px
     (just under 24vw), half of it on a phone (50vw less the gutters). The
     helmet is 65% of the card and scales 1.1 on hover, so 18vw. The wearing
     shots are landscape and `contain`ed, so they are drawn card-wide. See the
     note over the Home gallery in index.html. */
  const HELMET_SIZES = '(min-width: 992px) 18vw, calc(35.75vw - 21px)';
  const REVEAL_SIZES = '(min-width: 992px) 24vw, calc(50vw - 30px)';

  function revealImg(helmet: Helmet, className: string): string {
    const [width, height] = revealSize(helmet);
    return `<img class="${className}" src="${revealSrc(helmet)}" alt=""
                srcset="${revealSrcset(helmet)}" sizes="${REVEAL_SIZES}"
                width="${width}" height="${height}" loading="lazy" decoding="async" />`;
  }

  if (hofGrid) {
    hofGrid.innerHTML = helmets
      .map(
        (helmet) => `
        <li class="hof__item">
          <div class="hof__media">
            <img class="hof__helmet" src="${helmetSrc(helmet)}"
              srcset="${helmetSrcset(helmet)}" sizes="${HELMET_SIZES}" width="800" height="800"
              alt="${attr(helmetAlt(helmet))}" loading="lazy" decoding="async" />
            <span class="hof__reveal-w" aria-hidden="true">
              ${revealImg(helmet, 'hof__reveal-bg')}
              ${revealImg(helmet, 'hof__reveal')}
            </span>
          </div>
          <div class="hof__frame-w">${hofFrame('base')}${hofFrame('on')}</div>
          ${hofLabel(helmet)}
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
}

/* ------------------------------------------------------------------ *
 * Hall of fame — the columns drifting past each other.
 *
 * Two offsets, both easing to nothing as the wall crosses the screen, and both
 * moving the same direction: columns 1 and 3 travel 5rem, columns 2 and 4
 * travel 25rem. Measured off the reference, where the ratio is exactly 5 and
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

export function mountHofDrift(): void {

  mm.add(WIDE_AND_ANIMATED, () => {
    if (!hof || !hofGrid) return;

    /* The reference's transforms, read straight off its cards at sixteen scroll
       positions (1728x1080): columns 1 and 3 sit 5rem low, columns 2 and 4 sit
       25rem low — two nested tweens of 10rem and 15rem on the same range — and
       both fall linearly to zero between the grid's top reaching the bottom of
       the screen and its bottom leaving the top. Sampled at the section's own
       top it reads 57.9px and 289.7px, which is what these produce. */
    const apply = (progress: number) => {
      const rest = 1 - progress;
      hof.style.setProperty('--hof-lead', `${5 * rest}rem`);
      hof.style.setProperty('--hof-lag', `${25 * rest}rem`);
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
       every even column would stay parked 25rem low in the two-column layout. */
    return () => {
      hof.style.removeProperty('--hof-lead');
      hof.style.removeProperty('--hof-lag');
    };
  });

}

/* ------------------------------------------------------------------ *
 * The callout's crest, drawn in by scroll.
 *
 * The reference's callout mark is a Rive file (artboard "helmet-reef", state
 * machine "helmet-reef_scroll") keyed to the callout's scroll position. Read
 * off its canvas at 1728x1080, as painted pixels at held scroll positions and
 * allowed two seconds to settle (the Rive eases toward its scroll target, so a
 * quick read lags): nothing until the section top reaches 65% of the
 * viewport, the two branches grown up from their stems by 39%, then the
 * helmet coming up between them, complete by 23%.
 *
 * Ours is the site's own crest — the same drawing the next-race card and the
 * menu carry — through the two hooks it already exposes for the On Track
 * header's entrance: --crest-branch-hide clips the branches from the top, so
 * running it from 100% to 0% grows them upward, and --crest-helmet is the
 * helmet's opacity. Set on the <svg>, they reach the <use> clone by
 * inheritance.
 *
 * Reduced motion leaves both unset, and the crest is simply whole.
 * ------------------------------------------------------------------ */

export function mountCalloutCrest(): void {
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    for (const icon of document.querySelectorAll<SVGSVGElement>('.callout__icon')) {
      const section = icon.closest<HTMLElement>('.callout');
      if (!section) throw new Error('callout crest: .callout__icon outside a .callout');

      /* fromTo, not set-then-to: a `.to` reads its start value when it first
         renders, and a reload landing past this range renders it first at its
         END — so the branches recorded 0% as their start and never grew again
         on the way back up. Both ends are stated, so the scrub is the same
         whichever way the page arrives. */
      gsap
        .timeline({
          scrollTrigger: {
            trigger: section,
            start: 'top 65%',
            end: 'top 23%',
            scrub: true,
          },
        })
        // The first 62% of the range is the branches, the rest the helmet.
        .fromTo(
          icon,
          { '--crest-branch-hide': '100%' },
          { '--crest-branch-hide': '0%', duration: 0.62, ease: 'none', immediateRender: true },
        )
        .fromTo(
          icon,
          { '--crest-helmet': 0 },
          { '--crest-helmet': 1, duration: 0.38, ease: 'none', immediateRender: true },
          0.62,
        );
    }
  });
}

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

export interface StoreOptions {
  /**
   * How far this section has taken the page's ground back to light, 0 to 1.
   *
   * Home wires this to the field's ground-cross model; On Track has no field
   * and leaves it unset. The section behaves identically either way — the
   * visor is its own animation and does not depend on the report landing.
   */
  onGround?: (progress: number) => void;
}

export function mountStore({ onGround }: StoreOptions = {}): void {

  const store = document.querySelector<HTMLElement>('[data-store]');

  if (store && !reducedMotion) {
    /* This section's share of the ground: how far the field has come BACK to
       cream. It never assigns the ground — the page that owns a ground decides
       what to do with this — because above this section the visor's progress is
       0 and "1 - 0" is a perfectly confident instruction to paint the top of the
       page black.

       Reported rather than written, because only one of the two pages carrying
       this section has a ground to report into. On Track has no WebGL field at
       all, and passes nothing. */
    const applyGround = (p: number): void => {
      onGround?.(p);
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

export function mountSocials(): void {

  const fan = document.querySelector<HTMLElement>('.socials__fan');


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
        card.style.setProperty('--lift', '0rem');
      }

      /* Timed off the reference frame by frame, from a fresh load, at 1728:
       *
       *   trigger  fires with the fan's top at 90% of the viewport (its section
       *            top between 588 and 578 of 1080). 80% dealt the cards a
       *            108px later than the reference does.
       *   rise     160px (10rem) to 0 over 0.8s on a CUBIC out — GSAP's power2;
       *            its power3 is quartic, and ran visibly ahead of the samples —
       *            with no fade: the cards come up from below the fold, where
       *            they were never visible. LAST card first, 83ms apart: the
       *            right-hand card starts at 0ms, the centre at 252, the
       *            left-hand at 501.
       *   spread   the centre's slot at 900ms, before the last card is home, then
       *            outwards 200ms across the fan. It overshoots and rings — the
       *            outer card reaches 110% of its offset about 370ms in, dips to
       *            99.4% and settles — which is an elastic, not a back: a back
       *            never comes up short on the way down. A fit against 40 samples
       *            had put it at elastic.out(1, 0.78) over 1.12s; the reference's
       *            own timeline (lando-gl.js, the socials callout) says
       *            elastic.out(1, 0.75) over 1.2s, placed 0.4s before the rise
       *            ends, and that is what runs here.
       *
       * `amount` rather than `each` in both staggers, because from a centre or an
       * end GSAP spreads `each * (count - 1)` over the largest distance, which
       * made `each` mean twice the gap it reads as.
       *
       * The old deal ran 0.5s from 26rem with a fade, then spread on a quartic
       * with no give at the end, so the fan arrived flat where the reference's
       * lands. */
      ScrollTrigger.create({
        trigger: fan,
        start: 'top 90%',
        once: true,
        onEnter: () => {
          gsap
            .timeline({ onComplete: () => fan.classList.add('is-settled') })
            .to(cards, {
              '--rise': 0,
              duration: 0.8,
              ease: 'power2.out',
              stagger: { amount: 0.5, from: 'end' },
            })
            .to(
              cards,
              {
                '--spread': 1,
                duration: 1.2,
                ease: 'elastic.out(1, 0.75)',
                stagger: { amount: 0.2, from: 'center' },
              },
              '-=0.4',
            );
        },
      });

      /* ---- hover: the card pops, the fan opens around it ----
       *
       * The reference's own model, read out of lando-gl.js and checked against
       * its card transforms at 1728 with each card hovered in turn. A card's
       * move depends on its distance T from the hovered card and on how far in
       * from the ends of the fan it sits:
       *
       *   hovered    up 2.5rem and 8% larger, in place.
       *   the rest   out, away from it, by 8rem * reach * near, where reach is
       *              1 at the centre card and 0 at either end (so the end cards
       *              never move sideways) and near is 1.4 / 1.2 / 1 at T = 1..3.
       *              Each also leans away by 3 / (T + 1) degrees.
       *   last card  up 1rem whenever it is right of the hovered card. The first
       *              card has no such rule: the asymmetry is the reference's,
       *              reproduced rather than tidied away.
       *
       * Measured, hovering the card left of centre moves the centre card 179.2px
       * right at a 16px root. The "fixed span" model this replaced was fitted to
       * a hover on the centre card alone, and on every other hover it left the
       * centre card 60px short and threw the far-left pair 60px too far.
       *
       * Every tween is elastic.out(1, 0.75) over 0.5s, each 20ms per step of T
       * behind the last, and the release is the same with T counted from the
       * centre. The fan never restacks: its z stays 1,2,3,10,3,2,1. */
      const SPRING = 'elastic.out(1, 0.75)';
      const STAGGER = 0.02;
      const CENTRE = Math.floor(cards.length / 2);
      const LAST = cards.length - 1;

      const settle = (hovered: number | null): void => {
        cards.forEach((card, i) => {
          const distance = Math.abs(i - (hovered ?? CENTRE));
          let push = 0;
          let lean = 0;
          let lift = 0;
          if (hovered !== null && i !== hovered) {
            const dir = Math.sign(i - hovered);
            const reach = 1 - Math.abs((i - CENTRE) / CENTRE);
            const near = 1 + 0.2 * Math.max(0, 3 - distance);
            const pinned = dir > 0 && i === LAST;
            push = pinned ? 0 : dir * 8 * reach * near;
            lean = (dir * 3) / (distance + 1);
            lift = pinned ? -1 : 0;
          }
          gsap.to(card, {
            '--pop': hovered === i ? 1 : 0,
            '--push': `${push}rem`,
            '--lean': `${lean}deg`,
            '--lift': `${lift}rem`,
            duration: 0.5,
            ease: SPRING,
            delay: distance * STAGGER,
            overwrite: 'auto',
          });
        });
      };

      /* The reference's bookkeeping: entering a card claims the hover, and
         leaving it releases the fan 50ms later unless another card was entered
         in between. Crossing from card to card never flinches, and coming off
         the cards into the empty span beside them settles the fan — where it
         used to hold open until the pointer left the whole 80rem box. */
      let current: number | null = null;
      let release = 0;
      const reset = (): void => {
        window.clearTimeout(release);
        current = null;
        settle(null);
      };
      cards.forEach((card, i) => {
        card.addEventListener('pointerenter', () => {
          window.clearTimeout(release);
          current = i;
          settle(i);
        });
        card.addEventListener('pointerleave', () => {
          if (current !== i) return;
          release = window.setTimeout(() => {
            if (current === i) reset();
          }, 50);
        });
      });
      fan.addEventListener('pointerleave', reset);
    }
  }
}
