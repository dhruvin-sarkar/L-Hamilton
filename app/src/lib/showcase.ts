/**
 * The three sections Home and On Track both carry.
 *
 * The reference runs the same helmet wall, the same socials block and the same
 * store call-to-action at the foot of both pages, and its own study of that says
 * plainly: reuse the component, do not re-implement it
 * (docs/ON-TRACK-REFERENCE.md §13). This module is that reuse. The markup lives
 * in partials/helmets.html, partials/socials.html and partials/store.html; the
 * behaviour lives here; both entry points call the mounts.
 *
 * Moved out of main.ts unchanged, with one exception, which is the only thing
 * about these sections that actually differs between the two pages: the store's
 * report of how far the ground has come back to light. Home has a WebGL field to
 * report into and On Track does not, so it is a callback rather than a direct
 * write. Everything else is the code that was already verified on Home.
 */

import { gsap, mm, ScrollTrigger, reducedMotion, WIDE_AND_ANIMATED } from './motion';
import { helmets, helmetSrc, helmetAlt, revealSrc, revealAlt, pendingHelmets } from '../content/helmets';

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
}

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

export function mountHofDrift(): void {

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
}
