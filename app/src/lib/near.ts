/**
 * Resolves once an element is within a screen of the viewport.
 *
 * For work that only matters once its section is about to be seen -- booting
 * the Rive runtime for a circuit, calibrating a signature's pen -- and that
 * the page's first seconds should not pay for when the section is further
 * down.
 *
 * A full screen of margin above and below, so the work is done a screen before
 * the element arrives from either direction and is ready before it is visible.
 * An element already on screen resolves on the observer's first callback, one
 * frame after it is observed.
 *
 * The element needs a box to intersect: one that is `display: none` never
 * resolves, so a caller whose target can be hidden observes its container.
 */
export function nearViewport(el: Element): Promise<void> {
  return new Promise((resolve) => {
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watch.disconnect();
        resolve();
      },
      { rootMargin: '100% 0px' },
    );
    watch.observe(el);
  });
}
