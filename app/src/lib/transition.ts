/**
 * The page loader and the page transition: one panel, `partials/transition.html`.
 *
 * The reference's `.transition-w`, rebuilt. Its choreography comes out of
 * lando-gl.js and its Rive file, whose three state-machine inputs (`initial`,
 * `transition-out`, `transition-in`) were driven by hand on a virtual clock and
 * the canvas read back every 1/60s:
 *
 *   first load  The panel is up at the first paint: brand colour, the button
 *               label at the bottom, the mark looping in the middle once the
 *               file has loaded. When the document is complete the page is
 *               initialised, and 1000ms later (mL's setTimeout(H$, 1000)) the
 *               reveal plays.
 *   reveal      The mark folds into the driver's number, which opens as a HOLE
 *               in the panel and zooms until the page shows through entirely:
 *               450ms. The label starts fading 100ms in, over 300ms; the panel
 *               is taken away at 500ms.
 *   link        The number zooms in SOLID from the centre until it covers the
 *               screen (~430ms), the mark appears inside it at ~270ms and joins
 *               its loop, and at 1000ms (v$) the next page is swapped in. That
 *               page reveals 500ms after it enters (cL's setTimeout(H$, 500)).
 *
 * The zoom is exponential: the glyph grows by a near-constant ~1.2x per frame
 * (log-linear) from 100ms and lands softly over the last ~60ms, with a quick
 * pop out of nothing before that. Its fixed point is the middle of the
 * number's crossbar, which sits on the centre of the screen, so the last thing
 * on screen is the inside of that bar — which is also why it covers exactly.
 *
 * Two deliberate differences, both from the site being multi-page:
 * - The next page is a new document. The last page's panel is held on screen
 *   by the browser until the new one paints its own, identical, panel, and the
 *   mark's loop resumes at the phase it had reached, so the swap is invisible.
 * - Back and forward are the browser's. A restored page (bfcache) and a fresh
 *   load reached by history both open with the arrival reveal, but the cover
 *   cannot play first, because the old page is gone before any script hears
 *   about it.
 *
 * Reduced motion: the panel never shows (main.css hides it), links navigate
 * normally, and nothing here runs beyond the scroll reset.
 */

import { gsap, reducedMotion } from './motion';

/* ------------------------------------------------------------------ *
 * Timings, all the reference's.
 * ------------------------------------------------------------------ */

const TIMING = {
  /** v$: the cover plays this long before the next page is requested. */
  cover: 1.0,
  /** mL: H$ runs 1000ms after the document is complete, on a first load. */
  holdFirst: 1.0,
  /** cL: H$ runs 500ms after the next page has entered. */
  holdArrival: 0.5,
  /** H$: visibility hidden 500ms after the reveal starts. */
  hide: 0.5,
  /** H$: the label's opacity goes 100ms in, on a 300ms CSS transition. */
  labelDelay: 0.1,
  labelFade: 0.3,
  /** The zoom, both ways: the pop out of nothing, then the long exponential. */
  pop: 0.1,
  zoom: 0.45,
  /** Cover: the mark scales up inside the glyph over this window. */
  markIn: [0.267, 0.35],
  /** Reveal: the mark folds into the glyph over the first 100ms. */
  markOut: 0.1,
  /** A load that never completes must not keep the page behind the panel. */
  loadCap: 8,
} as const;

/** chrome.css's `transition-failsafe` delay. Keep the two in step. */
const FAILSAFE_S = 10;

/**
 * The reference's hero cues (its k0/o0) fire BEFORE its reveal: 250ms before
 * on a first load (750 vs 1000ms) and 450ms before on an arrival (50 vs 500ms),
 * so the page's own entrance is already moving as the hole opens onto it.
 */
const ENTRANCE_LEAD = { first: 0.25, arrival: 0.45 } as const;

const STORAGE = {
  /** Set as a page is left through the panel; read (and cleared) by the next. */
  left: 'lh:transition',
  /** Wall-clock origin of the mark's loop, so the next page resumes its phase. */
  loopEpoch: 'lh:loop-epoch',
} as const;

/* ------------------------------------------------------------------ *
 * The glyph: "44", drawn for this site.
 *
 * Two open fours sharing one crossbar, slanted at the LH mark's own angle
 * (84 across 390 down its stem). Units: 100 tall, y down. The bar runs the full
 * width at y 58..78, so scaling about its middle ends with the screen inside
 * it: the bar is 20 units thick, and the glyph stops at 5x the viewport height.
 * ------------------------------------------------------------------ */

const SLANT = 84 / 390;
const BAR = { top: 58, bottom: 78 } as const;

/** [x, y, corner radius] around the outline, clockwise from the first upright. */
const GLYPH_OUTLINE: [number, number, number][] = [
  [0, 8, 0], [19, 8, 0], [19, 58, 0], [37, 58, 0], [37, 0, 0], [56, 0, 4],
  [56, 58, 0], [70, 58, 0], [70, 8, 0], [89, 8, 0], [89, 58, 0], [107, 58, 0],
  [107, 0, 0], [126, 0, 4], [126, 100, 0], [107, 100, 0], [107, 78, 0],
  [56, 78, 0], [56, 100, 0], [37, 100, 0], [37, 78, 0], [0, 78, 5],
];

/** The fixed point of the zoom: the middle of the shared bar. */
const ANCHOR = { x: 63, y: (BAR.top + BAR.bottom) / 2 };

type Cmd = { c: 'M' | 'L'; x: number; y: number } | { c: 'Q'; cx: number; cy: number; x: number; y: number };

const slant = (x: number, y: number): [number, number] => [x + (100 - y) * SLANT, y];

/** The outline as absolute commands, rounded corners as quadratic curves. */
function glyphCommands(): Cmd[] {
  const n = GLYPH_OUTLINE.length;
  const cmds: Cmd[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y, r] = GLYPH_OUTLINE[i]!;
    const [px, py] = GLYPH_OUTLINE[(i + n - 1) % n]!;
    const [nx, ny] = GLYPH_OUTLINE[(i + 1) % n]!;
    const first = i === 0;
    if (r === 0) {
      const [sx, sy] = slant(x, y);
      cmds.push({ c: first ? 'M' : 'L', x: sx, y: sy });
      continue;
    }
    // Step back along the incoming edge and forward along the outgoing one,
    // then bend between them with the corner as the control point.
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(nx - x, ny - y);
    const [ax, ay] = slant(x - ((x - px) / inLen) * r, y - ((y - py) / inLen) * r);
    const [bx, by] = slant(x + ((nx - x) / outLen) * r, y + ((ny - y) / outLen) * r);
    const [cx, cy] = slant(x, y);
    cmds.push({ c: first ? 'M' : 'L', x: ax, y: ay });
    cmds.push({ c: 'Q', cx, cy, x: bx, y: by });
  }
  return cmds;
}

const GLYPH = glyphCommands();
const [ANCHOR_X, ANCHOR_Y] = slant(ANCHOR.x, ANCHOR.y);

/** The glyph `h` px tall with its anchor at (ox, oy), as path data. */
function glyphPath(h: number, ox: number, oy: number): string {
  const s = h / 100;
  const X = (x: number) => (ox + (x - ANCHOR_X) * s).toFixed(1);
  const Y = (y: number) => (oy + (y - ANCHOR_Y) * s).toFixed(1);
  let d = '';
  for (const k of GLYPH) {
    d += k.c === 'Q' ? `Q${X(k.cx)} ${Y(k.cy)} ${X(k.x)} ${Y(k.y)}` : `${k.c}${X(k.x)} ${Y(k.y)}`;
  }
  return `${d}Z`;
}

/**
 * The zoom's curve in log space: a straight line — constant growth per frame —
 * that lands on a quadratic over its last fifth. Continuous in value and slope
 * at the join. Measured on the reference: ~0.2 of ln-size per frame through the
 * middle, then 0.14, 0.08, 0.05, 0.03 over the last four frames.
 */
const LANDING_AT = 0.8;
function zoomEase(p: number): number {
  const m = 2 / (1 + LANDING_AT);
  if (p <= LANDING_AT) return m * p;
  const c = m / (2 * (1 - LANDING_AT));
  return 1 - c * (1 - p) ** 2;
}

/**
 * The size unit. The reference's artboard is 1728x1080 on Fit.Cover, so it
 * scales by whichever axis is further over; measured, its mark is 59px tall at
 * 1728x1080, 49px at 1440x900 and 50px at 390x844.
 */
const unit = () => Math.max(window.innerWidth / 1728, window.innerHeight / 1080);

/** Glyph height at the end of the pop, at unit 1. */
const POP_HEIGHT = 120;

/* ------------------------------------------------------------------ *
 * The mark's loop.
 *
 * The reference's mark folds away stroke by stroke into a point and draws
 * itself back, on a 950ms cycle: fold 250ms, gone 50ms, redraw 300ms, hold
 * 350ms. Ours wipes each of the three LH shapes off and back on down its own
 * length, in the order a hand would draw them — the L, the short bar, then the
 * H's stem and crossbar.
 * ------------------------------------------------------------------ */

const LOOP = { period: 0.95, fold: 0.25, gone: 0.05, draw: 0.3 } as const;

/** Where in the cycle the fold starts, measured from the cover's start. */
const COVER_FOLD_AT = 0.433;

interface Mark {
  loop: gsap.core.Timeline;
  applyAll: () => void;
}

function buildMark(svg: SVGSVGElement): Mark | null {
  const source = document.getElementById('lh-mark');
  if (!source) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(NS, 'defs');
  svg.append(defs);

  // Draw order: the L, the short bar, the H's stem. #lh-mark lists them as
  // L, H stem, short bar.
  const shapes = [...source.querySelectorAll('path')];
  const order = [shapes[0], shapes[2], shapes[1]].filter((p): p is SVGPathElement => Boolean(p));
  const wipes = order.map((shape, i) => {
    const path = shape.cloneNode(true) as SVGPathElement;
    const box = shape.getBBox();
    const clip = document.createElementNS(NS, 'clipPath');
    clip.id = `transition-wipe-${i}`;
    clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const rect = document.createElementNS(NS, 'rect');
    // A little wider than the shape so the wipe's side edges never show.
    rect.setAttribute('x', String(box.x - 4));
    rect.setAttribute('width', String(box.width + 8));
    clip.append(rect);
    defs.append(clip);
    path.setAttribute('clip-path', `url(#${clip.id})`);
    svg.append(path);
    // The visible band runs from `off` to `on`, both fractions of the height.
    const state = { on: 1, off: 0 };
    const top = box.y - 2;
    const height = box.height + 4;
    const apply = () => {
      rect.setAttribute('y', (top + state.off * height).toFixed(1));
      rect.setAttribute('height', (Math.max(0, state.on - state.off) * height).toFixed(1));
    };
    return { state, apply };
  });
  const applyAll = () => wipes.forEach((w) => w.apply());
  applyAll();

  /* The clip rects are written from the timeline's own update rather than per
     tween: a seek (which is how a new page resumes the phase) suppresses tween
     callbacks, and a tween that has finished never calls its onUpdate again,
     so per-tween writes would leave a stale band on screen. */
  const loop = gsap.timeline({ repeat: -1, paused: true, onUpdate: applyAll });
  const foldStep = LOOP.fold / 5;
  const drawStep = LOOP.draw / 5;
  // Fold: the stem first, the L last, each wiped away down its length.
  [...wipes].reverse().forEach((w, i) => {
    loop.fromTo(
      w.state,
      { on: 1, off: 0 },
      { off: 1, duration: foldStep * 3, ease: 'power2.in', immediateRender: false },
      i * foldStep,
    );
  });
  // Gone for LOOP.gone, then each drawn back on down its length.
  wipes.forEach((w, i) => {
    loop.fromTo(
      w.state,
      { on: 0, off: 0 },
      { on: 1, duration: drawStep * 3, ease: 'power2.out', immediateRender: false },
      LOOP.fold + LOOP.gone + i * drawStep,
    );
  });
  // Hold to the end of the cycle.
  loop.set({}, {}, LOOP.period);
  return { loop, applyAll };
}

/* ------------------------------------------------------------------ *
 * The panel.
 * ------------------------------------------------------------------ */

type Arrival = 'first' | 'arrival';

let cueResolve: (() => void) | null = null;
const entranceCue = new Promise<void>((resolve) => {
  cueResolve = resolve;
});

/**
 * Resolves when the page's own entrance should start: just before the reveal,
 * by the reference's lead. Immediately under reduced motion or with no panel.
 */
export function whenEntranceCued(): Promise<void> {
  return entranceCue;
}

export function mountTransition(opts: { closeMenu: () => void }): void {
  // The reference starts every document at the top (scrollRestoration manual,
  // scrollTo(0, 0) before anything else) and every transition too.
  history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  const root = document.querySelector<HTMLElement>('[data-transition]');
  if (!root || reducedMotion) {
    root?.remove();
    cueResolve?.();
    return;
  }
  const shape = root.querySelector<SVGPathElement>('.transition__shape');
  const markSvg = root.querySelector<SVGSVGElement>('.transition__mark');
  const label = root.querySelector<HTMLElement>('.transition__label');
  if (!shape || !markSvg || !label) throw new Error('[transition] panel markup is incomplete');

  // chrome.css steps the panel aside by itself after FAILSAFE_S if no script
  // has claimed it. Arriving later than that, the reader has already been let
  // through: claim it as revealed rather than putting it back up.
  if (performance.now() > FAILSAFE_S * 1000) {
    root.dataset.state = 'revealed';
    cueResolve?.();
    return;
  }

  root.dataset.state = 'covered';
  const mark = buildMark(markSvg);

  /* Resume the loop where the last page left it, so the new document's mark
     carries on rather than restarting. */
  const epoch = Number(sessionStorage.getItem(STORAGE.loopEpoch)) || Date.now();
  sessionStorage.setItem(STORAGE.loopEpoch, String(epoch));
  const seekLoop = () => {
    if (!mark) return;
    const at = Number(sessionStorage.getItem(STORAGE.loopEpoch)) || epoch;
    mark.loop.time(((Date.now() - at) / 1000) % LOOP.period);
    mark.applyAll();
    mark.loop.play();
  };
  seekLoop();

  // One-shot: read by the page that follows a transition, then gone, so a
  // later reload is a first load again.
  sessionStorage.removeItem(STORAGE.left);
  const kind: Arrival = document.documentElement.hasAttribute('data-arrival') ? 'arrival' : 'first';

  let busy = false;
  let active: gsap.core.Timeline | null = null;

  /* ---------------------------------------------------------- reveal */

  const reveal = (): void => {
    active?.kill();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ox = vw / 2;
    const oy = vh / 2;
    const u = unit();
    const frame = `M0 0H${vw}V${vh}H0Z`;
    const popH = POP_HEIGHT * u;
    const endH = 5 * vh * 1.03;
    const size = { h: 0, z: 0 };
    const draw = () => shape.setAttribute('d', frame + glyphPath(size.h, ox, oy));

    root.dataset.state = 'revealing';
    draw();
    active = gsap
      .timeline({
        onComplete: () => {
          root.dataset.state = 'revealed';
          shape.setAttribute('d', '');
          mark?.loop.pause();
          busy = false;
        },
      })
      .to(size, { h: popH, duration: TIMING.pop, ease: 'power1.in', onUpdate: draw }, 0)
      .to(
        size,
        {
          z: 1,
          duration: TIMING.zoom - TIMING.pop,
          ease: zoomEase,
          onUpdate: () => {
            size.h = Math.exp(Math.log(popH) + (Math.log(endH) - Math.log(popH)) * size.z);
            draw();
          },
        },
        TIMING.pop,
      )
      .to(markSvg, { scale: 0, duration: TIMING.markOut, ease: 'power2.in' }, 0)
      .to(label, { opacity: 0, duration: TIMING.labelFade, ease: 'power1.inOut' }, TIMING.labelDelay)
      // Taken away at 500ms whatever the zoom is doing, as H$ does.
      .set({}, {}, TIMING.hide);
  };

  /* ---------------------------------------------------------- cover */

  const cover = (then: () => void): void => {
    active?.kill();
    busy = true;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ox = vw / 2;
    const oy = vh / 2;
    const u = unit();
    const popH = POP_HEIGHT * u;
    const endH = 5 * vh * 1.03;
    const size = { h: 0, z: 0 };
    const draw = () => shape.setAttribute('d', glyphPath(size.h, ox, oy));

    root.dataset.state = 'covering';
    gsap.set(markSvg, { scale: 0 });
    draw();
    if (mark) {
      // Line the loop up so its fold starts as the cover completes.
      mark.loop.time(LOOP.period - COVER_FOLD_AT);
      mark.loop.play();
      sessionStorage.setItem(
        STORAGE.loopEpoch,
        String(Date.now() - (LOOP.period - COVER_FOLD_AT) * 1000),
      );
    }
    active = gsap
      .timeline()
      .to(size, { h: popH, duration: TIMING.pop, ease: 'none', onUpdate: draw }, 0)
      .to(
        size,
        {
          z: 1,
          duration: TIMING.zoom - TIMING.pop,
          ease: zoomEase,
          onUpdate: () => {
            size.h = Math.exp(Math.log(popH) + (Math.log(endH) - Math.log(popH)) * size.z);
            draw();
          },
        },
        TIMING.pop,
      )
      .to(
        markSvg,
        { scale: 1, duration: TIMING.markIn[1] - TIMING.markIn[0], ease: 'power2.out' },
        TIMING.markIn[0],
      )
      // Solid from here: a panel colour rather than a path, so nothing can
      // show through at an edge whatever the window does next.
      .call(() => {
        root.dataset.state = 'covered';
        shape.setAttribute('d', '');
      }, [], TIMING.zoom)
      .call(then, [], TIMING.cover);
  };

  /* ---------------------------------------------------------- first paint */

  const hold = kind === 'first' ? TIMING.holdFirst : TIMING.holdArrival;

  const loaded = new Promise<void>((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', () => resolve(), { once: true });
  });
  const capped = new Promise<void>((resolve) => setTimeout(resolve, TIMING.loadCap * 1000));
  /* Wall-clock timers, as the reference's are, not gsap.delayedCall: a delayed
     call is placed relative to the global timeline's LAST RENDERED time, and
     the load event is exactly when the main thread has been too busy to tick —
     measured, a 1000ms delayed call made at load fired 83ms later. */
  void Promise.race([loaded, capped]).then(() => {
    after(hold - ENTRANCE_LEAD[kind], () => cueResolve?.());
    after(hold, reveal);
  });

  /* ---------------------------------------------------------- links */

  const samePage = (url: URL): boolean => {
    const norm = (p: string) => p.replace(/\/index\.html$/, '/');
    return norm(url.pathname) === norm(location.pathname) && url.search === location.search;
  };

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    if (link.getAttribute('href')?.startsWith('#')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;

    if (samePage(url)) {
      // The reference's router: the same page without a hash does nothing at
      // all, rather than reloading underneath the reader.
      if (!url.hash) event.preventDefault();
      return;
    }

    event.preventDefault();
    if (busy) return;
    opts.closeMenu();
    cover(() => {
      sessionStorage.setItem(STORAGE.left, String(Date.now() - TIMING.cover * 1000));
      location.href = url.href;
    });
  });

  /* ---------------------------------------------------------- history */

  // A page restored from the back/forward cache comes back exactly as it was
  // left — which, if it was left through the panel, is covered. Open it the
  // way an arrival opens.
  /* Dev only: a handle to play either half on demand and scrub it by time, so
     the choreography can be compared frame for frame against the reference's
     Rive file rather than judged by eye at full speed. */
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __lhTransition: {
        reveal,
        cover: () => cover(() => {}),
        timeline: () => active,
        loop: () => mark?.loop,
      },
    });
  }

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    active?.kill();
    busy = false;
    window.scrollTo(0, 0);
    root.dataset.state = 'covered';
    gsap.set(markSvg, { scale: 1 });
    shape.setAttribute('d', '');
    seekLoop();
    after(TIMING.holdArrival, reveal);
  });
}

function after(seconds: number, fn: () => void): void {
  window.setTimeout(fn, Math.max(0, seconds) * 1000);
}
