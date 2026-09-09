/**
 * The side-scrolling photo gallery.
 *
 * The reference runs this on Home AND On Track — `section.s.is-horizontal-track`
 * in both pages, same markup, different pictures — so like the helmet wall it is
 * a component, not a page feature.
 *
 * Its mechanism, read out of the reference's own CSS rather than guessed at:
 *
 *   .c.is-horiz-scroll     { position: sticky; top: 0 }
 *   .horizontal-pin-sticky { position: sticky; top: 0; display: flex }
 *   .horizontal-track      { display: flex; flex: none; height: 100vh }
 *
 * There is no pin. The section is made tall, a sticky viewport inside it holds
 * still, and the flex track — wider than the screen — is translated on X by
 * scroll progress. One ScrollTrigger, no pinning machinery, which is also why
 * it survives a resize cleanly.
 *
 * The travel and the scroll distance are deliberately the SAME number, so the
 * mapping is 1:1 rather than a ratio that shifts whenever the content changes.
 *
 * What is NOT here: the ground crossing. Home darkens its WebGL field as the
 * gallery scrubs over it, and On Track has no field to darken. That stays in
 * main.ts, on its own ScrollTrigger over the same section — the same split
 * showcase.ts already makes for the store's ground reporter.
 */

import { gsap, mm, WIDE_AND_ANIMATED } from './motion';

/**
 * Bind the horizontal scroll, if this page has a gallery.
 *
 * Bound to the breakpoint through gsap.matchMedia rather than a one-time
 * `matchMedia().matches` read: below 992px the gallery is a plain column, and
 * the two halves must agree. A context sets up on entering the query and
 * REVERTS on leaving, which is the half a hand-rolled resize listener misses —
 * a page loaded narrow and then widened had no travel height and no
 * --gallery-x, leaving the track overflowing a sticky viewport with no scroll
 * distance to move it.
 */
export function mountGalleryScroll(): void {
  const gallery = document.querySelector<HTMLElement>('[data-gallery]');
  const track = document.querySelector<HTMLElement>('[data-gallery-track]');
  if (!gallery || !track) return;

  mm.add(WIDE_AND_ANIMATED, () => {
    /** Every photo, with the frame it slides inside. Resolved once. */
    const panes = [...track.querySelectorAll<HTMLElement>('.gallery__frame')].map(
      (frame) => ({ frame, img: frame.querySelector('img') }),
    );

    /** How far the track has to travel: everything past one screenful. */
    let travel = 0;

    const measure = (): void => {
      travel = Math.max(0, track.scrollWidth - window.innerWidth);
      /* travel PLUS one screen, and the screenful is the load-bearing part.
       *
       * .gallery__pin is `sticky; top: 0`, so it only begins to hold once the
       * section's top edge reaches y=0 — and it lets go once the section's
       * bottom edge reaches the viewport bottom. That window is
       * `height - innerHeight` long. Setting height to `travel` alone made that
       * window `travel - innerHeight`, while the tween ran over `travel`: the
       * two ended together but started a full screen apart, so at 1728x1080
       * two thirds of the sideways travel had already happened before the pin
       * engaged, off the bottom of the screen, and the part you could actually
       * watch was crushed into the remainder.
       *
       * With one screen added, the sticky window is exactly `travel` long and
       * starts exactly where the tween does. */
      gallery.style.height = `${travel + window.innerHeight}px`;
    };

    /**
     * Slide each photo inside its own frame.
     *
     * 0 while the frame is still off the right edge, 1 once it has left past
     * the left — so a photo pans across its crop exactly once per pass, and two
     * frames of different widths travel the same 4rem at different rates.
     */
    const pan = (): void => {
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
          /* Top-of-section to top-of-screen is where the pin takes hold, and
             bottom-to-bottom is where it lets go. Anchoring the scrub to the
             same two points is what keeps the sideways travel 1:1 with the
             scroll and entirely on screen. */
          start: 'top top',
          end: 'bottom bottom',
          scrub: true,
          invalidateOnRefresh: true,
          onRefresh: measure,
          onUpdate: (self) => {
            track.style.setProperty('--gallery-x', `${-travel * self.progress}px`);
            pan();
          },
        },
      },
    );

    /* The context reverts its own tweens and ScrollTriggers, but not the marks
       they left on the DOM: a stale travel height and a track shifted off to
       the left would both survive into the column layout. */
    return () => {
      gallery.style.removeProperty('height');
      track.style.removeProperty('--gallery-x');
      for (const { img } of panes) img?.style.removeProperty('--pan');
    };
  });
}
