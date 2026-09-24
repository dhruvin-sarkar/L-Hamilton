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
 * Two timings, because the two pages that use it do not agree — see
 * GalleryScrollOptions. Home keeps the one it was tuned with; On Track runs the
 * reference's own, which is what its section is measured against.
 *
 * What is NOT here: the ground crossing. Home darkens its WebGL field as the
 * gallery scrubs over it, and On Track has no field to darken. That stays in
 * main.ts, on its own ScrollTrigger over the same section — the same split
 * showcase.ts already makes for the store's ground reporter.
 */

import { gsap, mm, ScrollTrigger, WIDE_AND_ANIMATED } from './motion';

export interface GalleryScrollOptions {
  /**
   * Where the sideways travel begins.
   *
   * `pinned` (the default, Home): once the section's top reaches the top of
   * the screen. The track holds still while the section rises into view and
   * all of its travel happens under the pin.
   *
   * `rising` (On Track): as soon as the section's top enters from the bottom —
   * the reference's own mechanic, `I_()` in lando-gl.js: start "top bottom",
   * section height = travel, so the first screenful of travel happens while the
   * section is still rising and the pictures arrive on a diagonal.
   */
  start?: 'pinned' | 'rising';
  /**
   * GSAP scrub. `true` locks the track to the scroll; a number is seconds of
   * catch-up. The reference's is 1, and the per-photo pan reads the track's
   * smoothed position, so the two stay in step either way.
   */
  scrub?: true | number;
}

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
export function mountGalleryScroll(opts: GalleryScrollOptions = {}): void {
  const gallery = document.querySelector<HTMLElement>('[data-gallery]');
  const track = document.querySelector<HTMLElement>('[data-gallery-track]');
  if (!gallery || !track) return;

  const start = opts.start ?? 'pinned';
  const scrub = opts.scrub ?? true;

  mm.add(WIDE_AND_ANIMATED, () => {
    /** Every photo, with the frame it slides inside. Resolved once. */
    const panes = [...track.querySelectorAll<HTMLElement>('.gallery__frame')].map(
      (frame) => ({ frame, img: frame.querySelector('img') }),
    );

    /** How far the track has to travel: everything past one screenful. */
    let travel = 0;

    /* Run on refreshInit, BEFORE ScrollTrigger measures its start and end: the
       height written here is what those are measured against. */
    const measure = (): void => {
      travel = Math.max(0, track.scrollWidth - window.innerWidth);
      /* `pinned`: travel PLUS one screen, and the screenful is the load-bearing
       * part. .gallery__pin is `sticky; top: 0`, so it only begins to hold once
       * the section's top edge reaches y=0 — and it lets go once the section's
       * bottom edge reaches the viewport bottom. That window is
       * `height - innerHeight` long, so with one screen added it is exactly
       * `travel` long and starts exactly where the tween does.
       *
       * `rising`: travel alone, as the reference sets it. The tween runs from
       * the section's top entering to its bottom leaving the viewport bottom,
       * which is `height` of scroll, so travel is still 1:1 — it simply starts
       * a screen earlier than the pin does. */
      const height = start === 'pinned' ? travel + window.innerHeight : travel;
      gallery.style.height = `${height}px`;
    };

    /**
     * Slide each photo inside its own frame.
     *
     * 0 while the frame is still off the right edge, 1 once it has left past
     * the left — so a photo pans across its crop exactly once per pass, and two
     * frames of different widths travel the same 4rem at different rates. The
     * reference's formula, on its containerAnimation trigger: "left right" to
     * "right left" of the item. Which WAY the photo moves is the stylesheet's.
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

    /* A proxy tween rather than the trigger's own progress, so a numeric scrub
       smooths what is drawn: the trigger reports the raw scroll, the tween's
       value is what the track should show. */
    const progress = { value: 0 };
    const draw = (): void => {
      track.style.setProperty('--gallery-x', `${-travel * progress.value}px`);
      pan();
    };

    measure();
    ScrollTrigger.addEventListener('refreshInit', measure);

    gsap.to(progress, {
      value: 1,
      ease: 'none',
      onUpdate: draw,
      scrollTrigger: {
        trigger: gallery,
        /* `pinned`: top-of-section to top-of-screen is where the pin takes
           hold, and bottom-to-bottom is where it lets go. `rising`: the
           reference's pair, from the moment the section appears. */
        start: start === 'pinned' ? 'top top' : 'top bottom',
        end: 'bottom bottom',
        scrub,
        invalidateOnRefresh: true,
        onRefresh: draw,
      },
    });

    /* The context reverts its own tweens and ScrollTriggers, but not the marks
       they left on the DOM: a stale travel height and a track shifted off to
       the left would both survive into the column layout. */
    return () => {
      ScrollTrigger.removeEventListener('refreshInit', measure);
      gallery.style.removeProperty('height');
      track.style.removeProperty('--gallery-x');
      for (const { img } of panes) img?.style.removeProperty('--pan');
    };
  });
}
