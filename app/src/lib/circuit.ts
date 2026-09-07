/**
 * Traced circuit outlines, drawn by Rive.
 *
 * The reference draws every track from one file, `circuits.riv`: a single
 * artboard with a `circuits` state machine whose BOOLEAN inputs pick the track
 * (`monza`, `zandvoort`, …), the ink (`color_lime`, `color_black`,
 * `color_flouro-green`; none set = the file's cream default) and the stroke
 * (`weight_thin` / `weight_normal` / `weight_thick`). Selecting a track is
 * "every track input off, then this one on" — copied from its own loader, which
 * is also how its schedule rows retarget the shape on hover.
 *
 * The file is the reference's own, supplied for this build. Fetched once and
 * shared by every canvas on the page; the runtime's wasm is served from this
 * bundle rather than from unpkg, which is what its default loader would do.
 *
 * Colour is the one place this diverges. The file only knows the reference's
 * palette, so an instance that must be in OUR accent is drawn in black and
 * tinted with an SVG filter (`#circuit-tint-accent`, in the page's defs):
 * flood the accent, composite `in` SourceAlpha. Exact colour, alpha preserved,
 * and it holds through the file's own hover transitions because it is applied
 * per frame by the compositor, not once by us.
 */

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
 * Only the tracks the file actually carries. The 2026 calendar's Madring is
 * not among them, and neither are the historic circuits in the wins record —
 * `hasTrack` is how a caller finds that out before asking for a shape.
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

export const hasTrack = (circuitId: string): boolean => circuitId in TRACKS;

/** The file's input name for one of our circuit ids. Throws for one it lacks. */
export const trackOf = (circuitId: string): string => {
  const track = TRACKS[circuitId];
  if (!track) throw new Error(`[circuit] no shape for "${circuitId}" — check hasTrack() first`);
  return track;
};

export type CircuitColor = 'default' | 'black' | 'lime' | 'flouro-green';
export type CircuitWeight = 'thin' | 'normal' | 'thick';

export interface CircuitOptions {
  /** A circuit id from the content model, not a Rive input name. */
  circuitId: string;
  color?: CircuitColor;
  weight?: CircuitWeight;
  /** Tint the drawing to the site accent. Draws in black underneath. */
  accent?: boolean;
}

export interface CircuitHandle {
  readonly canvas: HTMLCanvasElement;
  /** Retargets the shape. Returns false, and changes nothing, for an id the file lacks. */
  select(circuitId: string): boolean;
  /** Drives the file's own `hover_on` / `hover_off`, which is how it animates. */
  hover(on: boolean): void;
  destroy(): void;
}

let bytes: Promise<ArrayBuffer> | null = null;

const file = (): Promise<ArrayBuffer> =>
  (bytes ??= fetch(FILE).then((response) => {
    if (!response.ok) throw new Error(`[circuit] ${FILE} → ${response.status}`);
    return response.arrayBuffer();
  }));

/**
 * Draws a circuit into `host`, filling it. The host sizes the drawing: give it
 * the box the reference gives its canvas and `fit: contain` does the rest.
 */
export async function mountCircuit(host: HTMLElement, opts: CircuitOptions): Promise<CircuitHandle> {
  const buffer = await file();

  const canvas = document.createElement('canvas');
  canvas.className = 'circuit-canvas';
  if (opts.accent) canvas.classList.add('circuit-canvas--accent');
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
        rive.resizeDrawingSurfaceToCanvas();

        const inputs = rive.stateMachineInputs(MACHINE);
        const bools = inputs.filter((input) => input.type === StateMachineInputType.Boolean);
        const turn = (name: string, on: boolean): boolean => {
          const input = bools.find((b) => b.name === name);
          if (!input) return false;
          input.value = on;
          return true;
        };

        /* `hover_on` / `hover_off` drive the file's own transition — the shape
         * redraws rather than simply appearing, which is the thing worth having
         * and the reason the reference wires its schedule rows to a canvas at
         * all. Fired by name across every input type, because whether the file
         * declares them as triggers or as booleans is its business, not ours:
         * a trigger has `fire()`, a boolean takes a value, and this handles
         * both without asking. */
        const pulse = (name: string, on: boolean): void => {
          const input = inputs.find((i) => i.name === name);
          if (!input) return;
          if (typeof input.fire === 'function' && input.type === StateMachineInputType.Trigger) {
            input.fire();
            return;
          }
          input.value = on;
        };
        const isTrack = (name: string): boolean =>
          !name.startsWith('color_') && !name.startsWith('weight_');

        const color = opts.accent ? 'black' : (opts.color ?? 'default');
        if (color !== 'default') turn(`color_${color}`, true);
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
        const watch = new ResizeObserver(() => rive.resizeDrawingSurfaceToCanvas());
        watch.observe(canvas);

        resolve({
          canvas,
          select,
          hover: (on: boolean) => pulse(on ? 'hover_on' : 'hover_off', on),
          destroy: () => {
            watch.disconnect();
            rive.cleanup();
            canvas.remove();
          },
        });
      },
    });
  });
}
