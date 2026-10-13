/**
 * Resolves once the section holding an element is within a screen of the
 * viewport.
 *
 * For work that only matters once its section is about to be seen -- booting
 * the Rive runtime for a circuit, calibrating a signature's pen -- and that
 * the page's first seconds should not pay for when the section is further
 * down.
 *
 * The SECTION is watched, not the element. An element can sit inside something
 * that has no box, or no visible box, until the moment it is wanted: Home's
 * next-race card keeps its circuit host `display: none` until the drawing
 * lands, and the schedule's hover card is clip-path'd shut until a row is
 * hovered. An observer counts both as never intersecting, so the work would
 * start as the thing opened -- visibly late -- or never. The section is always
 * laid out and never clipped, and its approach is the moment the work should
 * start anyway.
 *
 * A full screen of margin above and below, so the work is done a screen before
 * the section arrives from either direction and is ready before it is visible.
 */
export function nearViewport(el: Element): Promise<void> {
  const section = el.closest('section, header, footer') ?? el;
  return new Promise((resolve) => {
    let near = false;
    const settle = (entries: IntersectionObserverEntry[]): void => {
      if (near || !entries.some((entry) => entry.isIntersecting)) return;
      near = true;
      watch.disconnect();
      resolve();
    };
    const watch = new IntersectionObserver(settle, { rootMargin: '100% 0px' });
    watch.observe(section);

    /* The observer measures on every frame, but its callback is a task the
       browser holds back while the page is loading: measured here, it ran
       within 100ms of the load event every time -- seconds after a
       first-screen section was already intersecting, so the hero's circuits
       and pen only started loading as the loader opened onto them. Frames keep
       running meanwhile, so the second one reads the observer's queue itself:
       a section on screen from the start resolves on the frame after it is
       observed, and anything further down is left to the callback. */
    requestAnimationFrame(() => requestAnimationFrame(() => settle(watch.takeRecords())));
  });
}
