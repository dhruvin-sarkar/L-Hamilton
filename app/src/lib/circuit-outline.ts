/**
 * Madring and Sepang, drawn the way circuits.riv draws its 24 tracks.
 *
 * The file has no shape for either and cannot be edited, so these two are
 * drawn here from path data (content/circuit-outlines.ts) with the file's own
 * parameters -- read out of its objects, animations and state machine, not
 * eyeballed off a screenshot:
 *
 *   - Artboard 100x60, laid out `contain` and centred, on a backing store of
 *     the canvas's CSS size x devicePixelRatio: lib/circuit.ts's Rive layout.
 *   - A turntable. The track sits in a node squashed to 0.4 vertically and
 *     turns inside it about the artboard's centre: a one-second loop played at
 *     speed -0.3, so one turn anticlockwise every 3 1/3 seconds.
 *   - Two strokes, both in artboard units after that squash (the file's
 *     `transformAffectsStroke: false`). A rest stroke of 1 -- 0.6 for
 *     `weight_thin`, 2 for `weight_thick` -- with butt caps and round joins, in
 *     #535450, or #111112 under `color_black`, lime under `color_lime`. Over it
 *     a 1.8 highlight in lime, round caps and joins, trimmed along the path.
 *   - `hover_on` runs the trim's end 0 -> 1 in 50 frames at 60fps on
 *     cubic-bezier(0.46, 0, 0, 1); `hover_off` runs its start 0 -> 1 in the
 *     same on cubic-bezier(0.57976, 0, 0.15014, 1). Each hands over to the
 *     other only once 60% through, and idle gives way to `hover_on` only while
 *     neither ink is set -- so a `lit` or light-ground drawing never plays it.
 *   - The file's own listener holds `hover` while the pointer is inside an
 *     89x52 rectangle centred on (49.5, 30), edges included. The runtime's
 *     2-unit hit radius never widens it: the rectangle's bounds are checked
 *     first. The pointer comes from the same mouse and touch events canvas-lite
 *     reads, so both see the same whole-pixel coordinates.
 *
 * Canvas2D, because canvas-lite is Canvas2D: the same path commands, stroke
 * parameters and transform reach the same rasteriser, so these lines are the
 * file's lines. The trim is Rive's ContourMeasure -- Wang's formula at its 0.5
 * tolerance, its segment lookup, its cubic chop -- run on the squashed, turned
 * path as the file's is, so the highlight's head travels as it does on every
 * other circuit.
 *
 * The highlight is drawn in the file's lime on a canvas with the Rive
 * canvases' classes, so partials/circuit-filters.html recolours it exactly as
 * it recolours theirs. Under reduced motion the turntable holds still and the
 * highlight is simply on while hovered: the same states, without the movement.
 */

import { CIRCUIT_OUTLINES } from '../content/circuit-outlines';
import type { CircuitHandle, CircuitOptions, CircuitWeight } from './circuit';
import { reducedMotion } from './motion';

/* ------------------------------------------------------------------ *
 * The file's numbers
 * ------------------------------------------------------------------ */

const ARTBOARD = { width: 100, height: 60 } as const;

/** The spin axis. The file's nodes put it within 0.0002 units of the centre. */
const AXIS = { x: 50, y: 30 } as const;
const TILT = 0.4;
const TURNS_PER_SECOND = 0.3;

const LIME = '#d2ff00';
const REST_INK = { grey: '#535450', black: '#111112', lime: LIME } as const;
const REST_WIDTH: Readonly<Record<CircuitWeight | 'regular', number>> = {
  thin: 0.6,
  regular: 1,
  thick: 2,
};
const HIGHLIGHT_WIDTH = 1.8;

const HOVER_SECONDS = 50 / 60;
/** Exit time: 60% of either hover animation before the other may take over. */
const HANDOVER_SECONDS = 0.6 * HOVER_SECONDS;

/** The hover listener's rectangle, 89x52 about (49.5, 30). Inclusive on every edge. */
const HIT = { left: 5, top: 4, right: 94, bottom: 56 } as const;

/** Rive's ContourMeasure: max chord error 0.5 units, at most 100 chords a cubic. */
const MEASURE_TOLERANCE = 0.5;
const MAX_CHORDS = 100;
/** rive::math::EPSILON, which getSegment uses to skip a start at a cubic's very end. */
const EPSILON = 1 / 4096;

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Cubic {
  readonly c1: Point;
  readonly c2: Point;
  readonly to: Point;
}

/** A closed run of cubics: the last one ends back on `start`. */
interface Outline {
  readonly start: Point;
  readonly cubics: readonly Cubic[];
}

/** Reads the data module's one-M, many-C, one-Z paths. Throws on anything else. */
function parse(circuitId: string, d: string): Outline {
  const tokens = d.match(/[MCZ]|-?\d*\.?\d+/g) ?? [];
  let i = 0;
  const fail = (why: string): never => {
    throw new Error(`[circuit-outline] "${circuitId}": ${why}`);
  };
  const num = (): number => {
    const value = Number(tokens[i++]);
    return Number.isFinite(value) ? value : fail(`expected a number at token ${i}`);
  };
  const point = (): Point => ({ x: num(), y: num() });

  if (tokens[i++] !== 'M') fail('must begin with M');
  const start = point();
  const cubics: Cubic[] = [];
  while (tokens[i] === 'C') {
    i++;
    cubics.push({ c1: point(), c2: point(), to: point() });
  }
  if (tokens[i++] !== 'Z' || i !== tokens.length) fail('must be one M, then Cs, then Z');
  const end = cubics.at(-1)?.to;
  if (!end || end.x !== start.x || end.y !== start.y) fail('the last C must end where the M began');
  return { start, cubics };
}

/** Parsed once, at load: malformed data fails here, not mid-page. */
const OUTLINES: ReadonlyMap<string, Outline> = new Map(
  Object.entries(CIRCUIT_OUTLINES).map(([id, d]) => [id, parse(id, d)]),
);

export const hasOutline = (circuitId: string): boolean => OUTLINES.has(circuitId);

/** The track on the turntable at `angle`, in artboard units. */
function placed(outline: Outline, angle: number): Outline {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const place = (p: Point): Point => ({
    x: AXIS.x + cos * p.x - sin * p.y,
    y: AXIS.y + TILT * (sin * p.x + cos * p.y),
  });
  return {
    start: place(outline.start),
    cubics: outline.cubics.map((c) => ({ c1: place(c.c1), c2: place(c.c2), to: place(c.to) })),
  };
}

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** A cubic's four points: its start is the previous cubic's end. */
function cubicAt(outline: Outline, index: number): [Point, Point, Point, Point] {
  const cubic = outline.cubics[index];
  if (!cubic) throw new Error(`[circuit-outline] no cubic ${index}`);
  const from = index === 0 ? outline.start : outline.cubics[index - 1]?.to;
  if (!from) throw new Error(`[circuit-outline] no cubic ${index - 1}`);
  return [from, cubic.c1, cubic.c2, cubic.to];
}

/** de Casteljau at t: the seven points of the two halves, sharing the middle. */
function subdivide(p: readonly [Point, Point, Point, Point], t: number): Point[] {
  const [p0, p1, p2, p3] = p;
  const ab = lerp(p0, p1, t);
  const bc = lerp(p1, p2, t);
  const cd = lerp(p2, p3, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  return [p0, ab, abc, lerp(abc, bcd, t), bcd, cd, p3];
}

/** Rive's cubic_extract: the part of a cubic between two of its t values. */
function extract(p: [Point, Point, Point, Point], from: number, to: number): Point[] {
  if (from === 0 && to === 1) return p;
  if (from === 0) return subdivide(p, to).slice(0, 4);
  if (to === 1) return subdivide(p, from).slice(3);
  const head = subdivide(p, to).slice(0, 4) as [Point, Point, Point, Point];
  return subdivide(head, from / to).slice(3);
}

/* ------------------------------------------------------------------ *
 * Trim: Rive's ContourMeasure, chord for chord
 * ------------------------------------------------------------------ */

interface Chord {
  /** Length along the path to this chord's end. */
  readonly distance: number;
  readonly cubic: number;
  /** The cubic's t at this chord's end. */
  readonly t: number;
}

interface Measure {
  readonly chords: readonly Chord[];
  readonly length: number;
}

function measure(outline: Outline): Measure {
  const chords: Chord[] = [];
  let length = 0;
  outline.cubics.forEach((_, index) => {
    const [p0, p1, p2, p3] = cubicAt(outline, index);
    // Wang's formula: chords needed to stay within the tolerance of the curve.
    const bend = Math.max(
      Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y),
      Math.hypot(p1.x - 2 * p2.x + p3.x, p1.y - 2 * p2.y + p3.y),
    );
    const count = Math.min(MAX_CHORDS, Math.ceil(Math.sqrt((0.75 / MEASURE_TOLERANCE) * bend)));
    if (count === 0) return; // Rive skips a cubic with no bend at all, length and all
    let previous = p0;
    for (let k = 1; k <= count; k++) {
      const t = k / count;
      const point = k === count ? p3 : subdivide([p0, p1, p2, p3], t)[3];
      if (!point) continue;
      length += distance(previous, point);
      chords.push({ distance: length, cubic: index, t });
      previous = point;
    }
  });
  return { chords, length };
}

/** The first chord reaching `at` -- std::lower_bound, then past any zero-length lead. */
function chordFor(chords: readonly Chord[], at: number): number {
  let low = 0;
  let high = chords.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((chords[mid]?.distance ?? 0) < at) low = mid + 1;
    else high = mid;
  }
  while (low < chords.length - 1 && chords[low]?.distance === 0) low++;
  return low;
}

/** The cubic's t at distance `at` inside chord `index`, interpolated along the chord. */
function tFor(chords: readonly Chord[], index: number, at: number): number {
  const chord = chords[index];
  if (!chord) return 0;
  const before = index > 0 ? chords[index - 1] : undefined;
  const fromDistance = before?.distance ?? 0;
  const fromT = before && before.cubic === chord.cubic ? before.t : 0;
  const ratio = (at - fromDistance) / (chord.distance - fromDistance);
  return Math.min(chord.t, Math.max(fromT, fromT + (chord.t - fromT) * ratio));
}

/** The stretch of the path between two fractions of its length, as getSegment builds it. */
function trimmed(outline: Outline, start: number, end: number): Path2D | null {
  const { chords, length } = measure(outline);
  const from = Math.max(0, length * start);
  const to = Math.min(length, length * end);
  if (from >= to || chords.length === 0) return null;

  let first = chordFor(chords, from);
  const last = chordFor(chords, to);
  let fromT = tFor(chords, first, from);
  const toT = tFor(chords, last, to);
  if (1 - fromT < EPSILON && first < last) {
    first++;
    fromT = 0;
  }
  const a = chords[first]?.cubic ?? 0;
  const b = chords[last]?.cubic ?? 0;

  const path = new Path2D();
  const add = (points: Point[], move: boolean): void => {
    const [p0, p1, p2, p3] = points;
    if (!p0 || !p1 || !p2 || !p3) return;
    if (move) path.moveTo(p0.x, p0.y);
    path.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  };
  if (a === b) {
    add(extract(cubicAt(outline, a), fromT, toT), true);
  } else {
    add(extract(cubicAt(outline, a), fromT, 1), true);
    // Only cubics that were measured: one with no bend has no chords, and Rive skips it here too.
    const measured = new Set(chords.map((chord) => chord.cubic));
    for (let c = a + 1; c < b; c++) if (measured.has(c)) add(cubicAt(outline, c), false);
    add(extract(cubicAt(outline, b), 0, toT), false);
  }
  if (from === 0 && to - from >= length) path.closePath();
  return path;
}

function whole(outline: Outline): Path2D {
  const path = new Path2D();
  path.moveTo(outline.start.x, outline.start.y);
  for (const { c1, c2, to } of outline.cubics) path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
  path.closePath();
  return path;
}

/* ------------------------------------------------------------------ *
 * Easing: the file's CubicEaseInterpolator, i.e. CSS cubic-bezier()
 * ------------------------------------------------------------------ */

function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;

  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-7) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let low = 0;
    let high = 1;
    t = x;
    for (let i = 0; i < 40 && high - low > 1e-7; i++) {
      if (sampleX(t) < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return sampleY(t);
  };
}

const DRAW_ON = cubicBezier(0.46, 0, 0, 1);
const DRAW_OFF = cubicBezier(0.57976, 0, 0.15014, 1);

/* ------------------------------------------------------------------ *
 * The drawing
 * ------------------------------------------------------------------ */

/**
 * Draws a circuit from its outline into `host`, filling it -- the same
 * contract, options and handle as lib/circuit.ts's Rive drawing, which is the
 * only caller. Throws for an id with no outline; check `hasOutline` first.
 */
export function mountOutline(host: HTMLElement, opts: CircuitOptions): CircuitHandle {
  const initial = OUTLINES.get(opts.circuitId);
  if (!initial) throw new Error(`[circuit-outline] no outline for "${opts.circuitId}"`);
  let outline: Outline = initial;

  const ground = opts.ground ?? 'dark';
  const canvas = document.createElement('canvas');
  canvas.className = `circuit-canvas circuit-canvas--${ground}`;
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('[circuit-outline] no 2D context');
  const ctx = context;

  /* The file's inputs, as lib/circuit.ts sets them: `lit` is `color_lime`,
     a light ground `color_black`, and either one shuts the hover out. */
  const restInk = opts.lit ? REST_INK.lime : ground === 'light' ? REST_INK.black : REST_INK.grey;
  const restWidth = REST_WIDTH[opts.weight ?? 'regular'];
  const canHover = !opts.lit && ground !== 'light';

  let hovered = false;
  /** The hover layer: which animation is playing, and how long it has run. */
  let phase: 'idle' | 'on' | 'off' = 'idle';
  let phaseSeconds = 0;
  /** Seconds the turntable has run. */
  let spun = 0;

  const advance = (seconds: number): void => {
    // A one-shot passing its end this frame hands the overshoot to the next state.
    let spilled = 0;
    if (phase !== 'idle') {
      const before = phaseSeconds;
      phaseSeconds += seconds;
      if (before < HOVER_SECONDS && phaseSeconds > HOVER_SECONDS) spilled = phaseSeconds - HOVER_SECONDS;
    }
    if (phase === 'idle') {
      if (hovered && canHover) {
        phase = 'on';
        phaseSeconds = 0;
      }
    } else if (phase === 'on') {
      if (!hovered && phaseSeconds >= HANDOVER_SECONDS) {
        phase = 'off';
        phaseSeconds = spilled;
      }
    } else if (hovered && phaseSeconds >= HANDOVER_SECONDS) {
      phase = 'on';
      phaseSeconds = spilled;
    }
  };

  /** The highlight's trim, [start, end], as fractions of the path's length. */
  const trim = (): [number, number] => {
    if (reducedMotion) return hovered && canHover ? [0, 1] : [0, 0];
    if (phase === 'idle') return [0, 0];
    const progress = Math.min(phaseSeconds / HOVER_SECONDS, 1);
    return phase === 'on' ? [0, DRAW_ON(progress)] : [DRAW_OFF(progress), 1];
  };

  const render = (): void => {
    const { width, height } = canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!width || !height) return;

    // contain, centred
    const scale = Math.min(width / ARTBOARD.width, height / ARTBOARD.height);
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      width / 2 - (scale * ARTBOARD.width) / 2,
      height / 2 - (scale * ARTBOARD.height) / 2,
    );

    const angle = -TAU * ((TURNS_PER_SECOND * spun) % 1);
    const track = placed(outline, angle);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.lineWidth = restWidth;
    ctx.strokeStyle = restInk;
    ctx.stroke(whole(track));

    const [start, end] = trim();
    if (end <= start) return;
    const highlight = trimmed(track, start, end);
    if (!highlight) return;
    ctx.lineCap = 'round';
    ctx.lineWidth = HIGHLIGHT_WIDTH;
    ctx.strokeStyle = LIME;
    ctx.stroke(highlight);
  };

  /* One frame loop, run while the canvas is on screen. Time only moves on
     frames, as the file's does, and a frame after a pause simply covers the
     gap -- so nothing about the drawing depends on whether it was watched. */
  let frame = 0;
  let lastFrame: number | null = null;
  let onScreen = false;
  let destroyed = false;

  const tick = (now: number): void => {
    frame = 0;
    const seconds = lastFrame === null ? 0 : Math.max(0, now - lastFrame) / 1000;
    lastFrame = now;
    spun += seconds;
    advance(seconds);
    render();
    if (onScreen && !destroyed) frame = requestAnimationFrame(tick);
  };
  const play = (): void => {
    if (reducedMotion) {
      render();
      return;
    }
    if (!frame && onScreen && !destroyed) frame = requestAnimationFrame(tick);
  };

  const view = new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
    play();
  });
  view.observe(canvas);

  /* The backing store follows the CSS box at the device's pixel ratio, as
     `resizeDrawingSurfaceToCanvas` has the Rive canvases do. */
  const resize = (): void => {
    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = ratio * box.width;
    canvas.height = ratio * box.height;
    render();
  };
  const watch = new ResizeObserver(resize);
  watch.observe(canvas);

  const hover = (on: boolean): void => {
    hovered = on;
    play();
  };

  /* The file's own listener: enter and exit of its hit rectangle, mapped
     through the same contain layout. Fed by the events canvas-lite listens to,
     read the way it reads them -- a touch by its first finger, and a point at
     (0, 0) ignored -- so an edge falls on the same pixel for both. Unlike
     canvas-lite, a touch here never cancels the page's scroll. */
  let pointerOver = false;
  const onPointer = (event: MouseEvent | TouchEvent): void => {
    const point =
      'touches' in event ? (event.type === 'touchend' ? event.changedTouches[0] : event.touches[0]) : event;
    if (!point || (!point.clientX && !point.clientY)) return;
    const box = canvas.getBoundingClientRect();
    const scale = Math.min(box.width / ARTBOARD.width, box.height / ARTBOARD.height);
    if (!scale) return;
    const x = ARTBOARD.width / 2 + (point.clientX - box.left - box.width / 2) / scale;
    const y = ARTBOARD.height / 2 + (point.clientY - box.top - box.height / 2) / scale;
    const over = x >= HIT.left && x <= HIT.right && y >= HIT.top && y <= HIT.bottom;
    if (over === pointerOver) return;
    pointerOver = over;
    hover(over);
  };
  for (const type of ['mouseover', 'mouseout', 'mousemove', 'mousedown', 'mouseup'] as const) {
    canvas.addEventListener(type, onPointer);
  }
  for (const type of ['touchstart', 'touchmove', 'touchend'] as const) {
    canvas.addEventListener(type, onPointer, { passive: true });
  }

  const target = opts.hoverTarget;
  const enter = (): void => hover(true);
  const leave = (): void => hover(false);
  target?.addEventListener('pointerenter', enter);
  target?.addEventListener('pointerleave', leave);

  return {
    canvas,
    select: (circuitId: string): boolean => {
      const next = OUTLINES.get(circuitId);
      if (!next) return false;
      outline = next;
      play();
      return true;
    },
    hover,
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(frame);
      view.disconnect();
      watch.disconnect();
      target?.removeEventListener('pointerenter', enter);
      target?.removeEventListener('pointerleave', leave);
      canvas.remove();
    },
  };
}
