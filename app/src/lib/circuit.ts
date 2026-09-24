/**
 * Traced circuit outlines, drawn by Rive.
 *
 * The reference draws every track from one file, `circuits.riv`: a single
 * artboard with a `circuits` state machine of 29 BOOLEAN inputs, read off the
 * file: one per track (`monza`, `zandvoort`, …), the ink (`color_lime`,
 * `color_black`; neither set = the file's grey default), the stroke
 * (`weight_thin` / `weight_thick`) and `hover`. The file's own pointer
 * listeners set `hover` when the pointer is over the artboard. Selecting a track
 * is "every track input off, then this one on" -- copied from its own loader,
 * which is also how its schedule rows retarget the shape on hover.
 *
 * The file is the reference's own, supplied for this build. Fetched once and
 * shared by every canvas on the page; the runtime's wasm is served from this
 * bundle rather than from unpkg, which is what its default loader would do.
 *
 * The inks are the file's own, as the reference uses them: a thin grey outline
 * at rest, and on hover the file's own transition redraws it as a heavy
 * highlight. Only that highlight's colour differs. The file draws it in the
 * reference's lime, and an SVG colour matrix (partials/circuit-filters.html)
 * turns lime into ours -- Giallo Modena on a dark ground, Rosso Corsa on a
 * light one -- while mapping every neutral to itself, so the grey rest state
 * and the black one are untouched. The compositor applies it per frame, so it
 * holds through every step of the transition.
 *
 * Two 2026 circuits, Madring and Sepang, are not in the file. They are drawn by
 * lib/circuit-outline.ts from path data, with the file's own strokes, turntable
 * and transition, onto a canvas with these same classes -- so to a caller, and
 * on the page, a circuit is a circuit whichever of the two draws it.
 */

import { hasOutline, mountOutline } from './circuit-outline';
import {
  Alignment,
  Fit,
  Layout,
  Rive,
  RuntimeLoader,
  StateMachineInputType,
} from '@rive-app/canvas-lite';
import wasmUrl from '@rive-app/canvas-lite/rive.wasm?url';

RuntimeLoader.setWasmUrl(wasmUrl);

const FILE = '/assets/rive/circuits.riv';
const ARTBOARD = 'circuits';
const MACHINE = 'circuits';

/**
 * Our circuit ids (career.json) → the file's track inputs.
 *
 * Only the tracks the file actually carries. The 2026 calendar's Madring and
 * Sepang are not among them (lib/circuit-outline.ts draws those), and neither
 * are the historic circuits in the wins record -- `hasTrack` is how a caller
 * finds that out before asking for a shape.
 * The file spells Spielberg "speilberg"; that is its input name, not a typo
 * to fix here.
 */
const TRACKS: Readonly<Record<string, string>> = {
  albert_park: 'melbourne',
  shanghai: 'shanghai',
  suzuka: 'suzuka',
  bahrain: 'sakhir',
  jeddah: 'jeddah',
  miami: 'miami',
  imola: 'imola',
  monaco: 'monaco',
  catalunya: 'barcelona',
  villeneuve: 'montreal',
  red_bull_ring: 'speilberg',
  silverstone: 'silverstone',
  spa: 'spa-francorchamps',
  hungaroring: 'mogyorod',
  zandvoort: 'zandvoort',
  monza: 'monza',
  baku: 'baku',
  marina_bay: 'singapore',
  americas: 'austin',
  rodriguez: 'mexico-city',
  interlagos: 'sao-paulo',
  vegas: 'las-vegas',
  losail: 'lusail',
  yas_marina: 'yas-marina',
};

/** Whether a circuit can be drawn at all: from the file, or from an outline. */
export const hasTrack = (circuitId: string): boolean => circuitId in TRACKS || hasOutline(circuitId);

/** The file's input name for one of our circuit ids. Throws for one it lacks. */
export const trackOf = (circuitId: string): string => {
  const track = TRACKS[circuitId];
  if (!track) throw new Error(`[circuit] "${circuitId}" is not a track in ${FILE}`);
  return track;
};

export type CircuitWeight = 'thin' | 'thick';

/** The surface under a drawing, which decides both of its inks. */
export type CircuitGround = 'dark' | 'light';

export interface CircuitOptions {
  /** A circuit id from the content model, not a Rive input name. */
  circuitId: string;
  /**
   * Dark (the default): the file's grey outline, highlighting in Giallo Modena.
   * Light: the file's black outline, highlighting in Rosso Corsa.
   */
  ground?: CircuitGround;
  /** Drawn highlighted at rest -- the reference's countdown circuit is. */
  lit?: boolean;
  weight?: CircuitWeight;
  /**
   * An element whose pointer enter/leave should also play the hover. Without
   * one, the file's own listeners play it over the drawing, as the reference's do.
   */
  hoverTarget?: HTMLElement;
}

export interface CircuitHandle {
  readonly canvas: HTMLCanvasElement;
  /** Retargets the shape. Returns false, and changes nothing, for an id with no shape. */
  select(circuitId: string): boolean;
  /** Sets the file's `hover` input, which plays its highlight transition. */
  hover(on: boolean): void;
  destroy(): void;
}

let bytes: Promise<ArrayBuffer> | null = null;

const file = (): Promise<ArrayBuffer> =>
  (bytes ??= fetch(FILE).then((response) => {
    if (!response.ok) throw new Error(`[circuit] ${FILE} → ${response.status}`);
    return response.arrayBuffer();
  }));

type Renderer = 'rive' | 'outline';

const rendererOf = (circuitId: string): Renderer | null =>
  circuitId in TRACKS ? 'rive' : hasOutline(circuitId) ? 'outline' : null;

/**
 * Draws a circuit into `host`, filling it. The host sizes the drawing: give it
 * the box the reference gives its canvas and `fit: contain` does the rest.
 *
 * The file's tracks are drawn by Rive and the two it lacks from outlines. One
 * handle covers both, because the schedule points a single drawing at every
 * round in turn: the first `select` of the other kind builds that drawing, with
 * the same options, and only the one showing the selected circuit is displayed.
 */
export async function mountCircuit(host: HTMLElement, opts: CircuitOptions): Promise<CircuitHandle> {
  const first = rendererOf(opts.circuitId);
  if (!first) throw new Error(`[circuit] no shape for "${opts.circuitId}" -- check hasTrack() first`);

  const drawings = new Map<Renderer, Promise<CircuitHandle>>();
  const drawn = new Map<Renderer, CircuitHandle>();
  let showing: Renderer = first;
  let hovered = false;
  let destroyed = false;

  const drawing = (renderer: Renderer, circuitId: string): Promise<CircuitHandle> => {
    const existing = drawings.get(renderer);
    if (existing) return existing;
    const made =
      renderer === 'rive'
        ? mountRive(host, { ...opts, circuitId })
        : Promise.resolve(mountOutline(host, { ...opts, circuitId }));
    const settled = made.then((handle) => {
      if (destroyed) {
        handle.destroy();
        return handle;
      }
      drawn.set(renderer, handle);
      if (hovered) handle.hover(true);
      return handle;
    });
    // A failed build is forgotten, so a later select can try again.
    settled.catch(() => drawings.delete(renderer));
    drawings.set(renderer, settled);
    return settled;
  };

  const show = (): void => {
    for (const [renderer, handle] of drawn) handle.canvas.style.display = renderer === showing ? '' : 'none';
  };

  const firstHandle = await drawing(first, opts.circuitId);
  show();

  return {
    get canvas() {
      return drawn.get(showing)?.canvas ?? firstHandle.canvas;
    },
    select: (circuitId: string): boolean => {
      const renderer = rendererOf(circuitId);
      if (!renderer) return false;
      showing = renderer;
      drawing(renderer, circuitId).then(
        (handle) => {
          handle.select(circuitId);
          show();
        },
        (error: unknown) => console.error(`[circuit] could not draw "${circuitId}"`, error),
      );
      return true;
    },
    hover: (on: boolean): void => {
      hovered = on;
      for (const handle of drawn.values()) handle.hover(on);
    },
    destroy: () => {
      destroyed = true;
      for (const handle of drawn.values()) handle.destroy();
    },
  };
}

/** The file's drawing of one of its tracks. */
async function mountRive(host: HTMLElement, opts: CircuitOptions): Promise<CircuitHandle> {
  const buffer = await file();

  const ground = opts.ground ?? 'dark';
  const canvas = document.createElement('canvas');
  canvas.className = `circuit-canvas circuit-canvas--${ground}`;
  host.appendChild(canvas);

  return new Promise((resolve, reject) => {
    const rive = new Rive({
      buffer,
      canvas,
      artboard: ARTBOARD,
      stateMachines: MACHINE,
      autoplay: true,
      layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
      onLoadError: () => {
        canvas.remove();
        reject(new Error(`[circuit] ${FILE} failed to load`));
      },
      onLoad: () => {
        /* Sized from the canvas's layout box. The runtime's own
           resizeDrawingSurfaceToCanvas() reads getBoundingClientRect(), which
           includes CSS transforms: a canvas tilted in 3D -- the schedule's
           track is -- would get a surface the shape of its projection and
           draw the circuit stretched. */
        const fitSurface = (): void => {
          const dpr = window.devicePixelRatio || 1;
          canvas.width = Math.round(canvas.offsetWidth * dpr);
          canvas.height = Math.round(canvas.offsetHeight * dpr);
          rive.devicePixelRatioUsed = dpr;
          rive.resizeToCanvas();
          rive.drawFrame();
        };
        fitSurface();

        const inputs = rive.stateMachineInputs(MACHINE);
        const bools = inputs.filter((input) => input.type === StateMachineInputType.Boolean);
        const turn = (name: string, on: boolean): boolean => {
          const input = bools.find((b) => b.name === name);
          if (!input) return false;
          input.value = on;
          return true;
        };

        const isTrack = (name: string): boolean =>
          name !== 'hover' && !name.startsWith('color_') && !name.startsWith('weight_');

        /* Lime is the file's highlight ink, so "lit" is simply that ink at rest;
           the page's colour matrix carries it to ours like any other lime. */
        if (opts.lit) turn('color_lime', true);
        else if (ground === 'light') turn('color_black', true);
        if (opts.weight) turn(`weight_${opts.weight}`, true);

        const select = (circuitId: string): boolean => {
          const track = TRACKS[circuitId];
          if (!track || !bools.some((b) => b.name === track)) return false;
          for (const b of bools) if (isTrack(b.name)) b.value = false;
          turn(track, true);
          return true;
        };

        if (!select(opts.circuitId)) {
          rive.cleanup();
          canvas.remove();
          reject(new Error(`[circuit] "${opts.circuitId}" is not a track in ${FILE}`));
          return;
        }

        /* The canvas is CSS-sized by its host; the drawing surface has to follow
           it or the shape blurs the moment the fluid root changes. */
        const watch = new ResizeObserver(fitSurface);
        watch.observe(canvas);

        /* The file's `hover` input redraws the outline as its heavy highlight --
           the transition is the thing worth having. Its own listeners set it
           while the pointer is over the artboard, so a caller only wires a
           target when a larger area should play it too. Pointer, not mouse: a
           pen hovers as well. */
        /* On a light ground the file's black ink outranks its hover highlight:
           measured, a hovered black outline stays black. So the black is lifted
           while hovered, which lets the file's own highlight through in its
           lime -- and the light-ground matrix turns that Rosso Corsa. A lit
           drawing is already its highlight colour and is left alone. */
        const inkForHover = (on: boolean): void => {
          if (ground === 'light' && !opts.lit) turn('color_black', !on);
        };
        const hover = (on: boolean): void => {
          turn('hover', on);
          inkForHover(on);
        };
        const target = opts.hoverTarget;
        const enter = (): void => hover(true);
        const leave = (): void => hover(false);
        const canvasEnter = (): void => inkForHover(true);
        const canvasLeave = (): void => inkForHover(false);
        target?.addEventListener('pointerenter', enter);
        target?.addEventListener('pointerleave', leave);
        canvas.addEventListener('pointerenter', canvasEnter);
        canvas.addEventListener('pointerleave', canvasLeave);

        resolve({
          canvas,
          select,
          hover,
          destroy: () => {
            target?.removeEventListener('pointerenter', enter);
            target?.removeEventListener('pointerleave', leave);
            canvas.removeEventListener('pointerenter', canvasEnter);
            canvas.removeEventListener('pointerleave', canvasLeave);
            watch.disconnect();
            rive.cleanup();
            canvas.remove();
          },
        });
      },
    });
  });
}
