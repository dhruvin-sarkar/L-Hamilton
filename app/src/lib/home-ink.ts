/**
 * The three things on Home that are DRAWN rather than revealed: the laurel
 * crest over the impact wall, the script "On" across ON TRACK, and the arrow
 * inside each On / Off Track button.
 *
 * The reference runs all three as Rive artboards. These are original SVGs
 * given the same mechanics — the same trigger, the same one-shot, the same
 * order of strokes — and nothing of the reference's own drawings.
 *
 * The two scroll-triggered draws are built inside the WIDE_AND_ANIMATED
 * context, so below 992px and under reduced motion they are never hidden and
 * the drawing simply stands, whole. Leaving that context puts them back.
 */

import { gsap, mm, reducedMotion, ScrollTrigger, WIDE_AND_ANIMATED } from './motion';
import { clearInk, measureInk, setInk } from './pen';

/**
 * The impact crest: hidden until its top reaches 80% of the viewport, then
 * grown in once — the laurels first, the helmet landing inside them — as the
 * reference's `helmet-reef_play` does off B4()'s "top 80%".
 *
 * Driven through the hooks the shared drawing already exposes
 * (partials/crest.html), which On Track's header crest grows in by too.
 */
function mountImpactCrest(): void {
  const crest = document.querySelector<SVGSVGElement>('.impact__crest');
  if (!crest) return;

  mm.add(WIDE_AND_ANIMATED, () => {
    gsap.set(crest, { '--crest-branch-hide': '100%', '--crest-helmet': 0 });
    const grow = gsap
      .timeline({ paused: true })
      .to(crest, { '--crest-branch-hide': '0%', duration: 0.5, ease: 'power2.out' }, 0)
      .to(crest, { '--crest-helmet': 1, duration: 0.45, ease: 'power2.out' }, 0.35);
    const trigger = ScrollTrigger.create({
      trigger: crest,
      start: 'top 80%',
      once: true,
      onEnter: () => grow.play(),
    });

    return () => {
      trigger.kill();
      grow.kill();
      crest.style.removeProperty('--crest-branch-hide');
      crest.style.removeProperty('--crest-helmet');
    };
  });
}

/**
 * The script "On" over ON TRACK: nothing until the drawing's top reaches the
 * middle of the viewport (the reference's `data-rive-scrolltrigger-start`
 * "top center"), then written once, stroke after stroke in pen order.
 */
function mountOtotScript(): void {
  const script = document.querySelector<SVGSVGElement>('.otot__script');
  if (!script) return;
  const ink = measureInk([...script.querySelectorAll<SVGPathElement>('path')]);

  mm.add(WIDE_AND_ANIMATED, () => {
    const pen = { t: 0 };
    setInk(ink, 0);
    const write = gsap.to(pen, {
      t: 1,
      duration: 0.8,
      ease: 'power2.out',
      paused: true,
      onUpdate: () => setInk(ink, pen.t),
    });
    const trigger = ScrollTrigger.create({
      trigger: script,
      start: 'top center',
      once: true,
      onEnter: () => write.play(),
    });

    return () => {
      trigger.kill();
      write.kill();
      clearInk(ink);
    };
  });
}

/**
 * The arrow buttons' hover. The reference's `btn-ui/arrow` keeps the button
 * exactly as it is and plays the arrow instead: the stroke lifts off in pen
 * order (gone by ~0.5s) and is written back (whole by ~1.5s). A one-shot per
 * entry — leaving mid-play lets it finish rather than snapping, and entering
 * again while it plays does not restart it.
 *
 * Focus plays it too, so the keyboard gets the same answer as the pointer.
 */
function mountArrowHover(): void {
  if (reducedMotion) return;

  for (const link of document.querySelectorAll<HTMLAnchorElement>('.otot__link')) {
    const paths = [...link.querySelectorAll<SVGPathElement>('.otot__arrow path')];
    if (!paths.length) continue;
    const ink = measureInk(paths);
    const pen = { from: 0, to: 1 };
    const draw = () => setInk(ink, pen.to, pen.from);

    const replay = gsap
      .timeline({ paused: true, onComplete: () => clearInk(ink) })
      .to(pen, { from: 1, duration: 0.5, ease: 'power2.in', onUpdate: draw }, 0)
      .set(pen, { from: 0, to: 0 }, 0.5)
      .to(pen, { to: 1, duration: 1, ease: 'power2.out', onUpdate: draw }, 0.5);

    const play = () => {
      if (!replay.isActive()) replay.restart();
    };
    link.addEventListener('pointerenter', play);
    link.addEventListener('focus', play);
  }
}

export function mountHomeInk(): void {
  mountImpactCrest();
  mountOtotScript();
  mountArrowHover();
}
