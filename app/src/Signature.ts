/**
 * The signature, drawn on as the plate closes.
 *
 * WHY THIS IS A CANVAS AND NOT AN SVG MASK
 *
 * It was an SVG `<mask>`: the outline trace filled, uncovered by the skeleton
 * trace stroked wide and animated through its dash. Visually right, and far too
 * expensive. Measured while scrubbing the back half of the sequence, the median
 * frame went from 7.4ms with the signature hidden to 16.4ms with it shown —
 * more than the rest of the page put together, including both WebGL scenes.
 *
 * Isolating it further: filling the same complex path with NO mask cost 9.1ms,
 * and masking a trivial four-point rectangle still cost 14.5ms. So it was not
 * the letterforms, it was the mask. Every frame the dash changes Blink
 * re-rasterises the whole mask layer, and this one is a thousand-odd segment
 * path stroked 520 units wide across a 780x620 box at device resolution.
 *
 * A canvas does the same compositing with two draws and a blit.
 *
 * WHY IT CALIBRATES ITSELF
 *
 * The skeleton trace is potrace's OUTLINE of a thinned line, not a centreline.
 * A one-pixel-wide stroke traced as a boundary comes back along its other side,
 * so the pen walks every stroke twice — and because the nib is 520 units wide
 * against a gap of about one, the return pass uncovers nothing the outward pass
 * did not already. Three subpaths, three out-and-back trips, so a dash animated
 * evenly along the path spends roughly half its time doing nothing visible, in
 * three separate stretches. That is exactly the "bursts of progress and then
 * nothing" this is meant to avoid.
 *
 * Rather than trying to reconstruct a true centreline from a trace that does not
 * contain one, this measures the problem away: at construction it renders the
 * reveal at a series of points, counts how much ink each one actually uncovers,
 * and builds the inverse mapping. Scroll then drives COVERAGE evenly, and the
 * pen speeds up over the stretches that were repeating themselves. The dead
 * passes disappear without the path being touched.
 */

/** Nib width, in path units. Matches the asset's own generator. */
const NIB = 520;

/** Samples taken when learning the coverage curve. */
const CALIBRATION_STEPS = 48;

/** Width of the offscreen used for calibration. Small on purpose — this is
 *  measuring a ratio, and a ratio does not need resolution. */
const CALIBRATION_WIDTH = 180;

interface Trace {
  ink: Path2D;
  nib: Path2D;
  nibLength: number;
  viewBox: { w: number; h: number };
  /** The trace's own `<g>` transform: scale then translate. */
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
}

/** Pull both paths and the coordinate space out of the generated asset. */
function parse(svgText: string): Trace {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('signature: malformed SVG');

  const inkEl = doc.querySelector('[data-signature-ink]');
  const nibEl = doc.querySelector('[data-signature-nib]');
  const svgEl = doc.querySelector('svg');
  if (!inkEl || !nibEl || !svgEl) throw new Error('signature: missing ink, nib or root');

  const inkD = inkEl.getAttribute('d');
  const nibD = nibEl.getAttribute('d');
  const viewBox = svgEl.getAttribute('viewBox');
  if (!inkD || !nibD || !viewBox) throw new Error('signature: missing path data or viewBox');

  const parts = viewBox.split(/[\s,]+/).map(Number);
  const vbW = parts[2];
  const vbH = parts[3];
  if (!vbW || !vbH) throw new Error('signature: unreadable viewBox');

  /* The trace's transform, read rather than assumed. potrace emits
     `translate(0,H) scale(0.1,-0.1)` — a tenth-scale with a flipped Y — and
     hardcoding that here would break silently the day a trace is regenerated at
     a different resolution. */
  const g = doc.querySelector('g[transform]');
  const m = g?.getAttribute('transform') ?? '';
  const translate = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(m);
  const scale = /scale\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(m);
  if (!translate || !scale) throw new Error('signature: unreadable <g> transform');

  /* Length has to come from a real SVGPathElement — Path2D has no geometry
     query. It has to be in the document to measure, so it goes in and comes
     straight back out. */
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  probe.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  const probePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  probePath.setAttribute('d', nibD);
  probe.appendChild(probePath);
  document.body.appendChild(probe);
  const nibLength = probePath.getTotalLength();
  probe.remove();

  if (!Number.isFinite(nibLength) || nibLength <= 0) {
    throw new Error('signature: pen path has no length');
  }

  return {
    ink: new Path2D(inkD),
    nib: new Path2D(nibD),
    nibLength,
    viewBox: { w: vbW, h: vbH },
    scaleX: Number(scale[1]),
    scaleY: Number(scale[2]),
    translateX: Number(translate[1]),
    translateY: Number(translate[2]),
  };
}

export class Signature {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly trace: Trace;

  /** The filled letterforms, rendered once and blitted through the reveal. */
  private inkCache: HTMLCanvasElement | null = null;

  /** Coverage at each calibration step, normalised 0..1. See the class note. */
  private coverage: number[] = [];

  private lastDrawn = -1;

  constructor(host: HTMLElement, svgText: string, private readonly colour: string) {
    this.trace = parse(svgText);

    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('signature: no 2D context');
    this.ctx = ctx;
    host.appendChild(this.canvas);

    this.calibrate();
    this.resize();
  }

  /** Map path space onto a context whose backing store is `w` pixels wide. */
  private applyTransform(ctx: CanvasRenderingContext2D, w: number): void {
    const s = w / this.trace.viewBox.w;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.translate(this.trace.translateX, this.trace.translateY);
    ctx.scale(this.trace.scaleX, this.trace.scaleY);
  }

  /**
   * Learn how much ink each share of the pen path actually uncovers.
   *
   * Renders the reveal alone — no letterforms — at a series of points and counts
   * covered pixels. What comes back is a curve that climbs where the pen is
   * opening new ground and flattens where it is retracing.
   */
  private calibrate(): void {
    const w = CALIBRATION_WIDTH;
    const h = Math.max(1, Math.round((w * this.trace.viewBox.h) / this.trace.viewBox.w));
    const probe = document.createElement('canvas');
    probe.width = w;
    probe.height = h;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('signature: no 2D context for calibration');

    const raw: number[] = [];
    for (let i = 0; i <= CALIBRATION_STEPS; i++) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      this.strokeReveal(ctx, w, i / CALIBRATION_STEPS);
      const { data } = ctx.getImageData(0, 0, w, h);
      let covered = 0;
      // Alpha only — the reveal is drawn opaque, so anything non-zero counts.
      for (let p = 3; p < data.length; p += 4) if (data[p]! > 8) covered++;
      raw.push(covered);
    }

    const max = raw[raw.length - 1] || 1;
    /* Forced monotone. Anti-aliasing can make a later sample read a hair lower
       than an earlier one, and a curve that dips cannot be inverted. */
    let running = 0;
    this.coverage = raw.map((v) => {
      running = Math.max(running, v / max);
      return Math.min(1, running);
    });
  }

  /** Stroke the pen path up to `t` of its length, as an opaque reveal. */
  private strokeReveal(ctx: CanvasRenderingContext2D, w: number, t: number): void {
    if (t <= 0) return;
    this.applyTransform(ctx, w);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = NIB;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    /* One dash as long as the drawn part, then a gap twice the path, so the
       pattern cannot repeat and light the start up again near the end. */
    ctx.setLineDash([this.trace.nibLength * t, this.trace.nibLength * 2]);
    ctx.stroke(this.trace.nib);
    ctx.setLineDash([]);
  }

  /**
   * Turn a scroll fraction into the path fraction that uncovers that much ink.
   * The inverse of the calibration curve, interpolated between steps.
   */
  private pathFractionFor(target: number): number {
    const c = this.coverage;
    if (target <= 0 || c.length < 2) return 0;
    if (target >= 1) return 1;
    for (let i = 1; i < c.length; i++) {
      const lo = c[i - 1]!;
      const hi = c[i]!;
      if (hi >= target) {
        const span = hi - lo;
        /* A flat step means the pen was retracing there. Jump to the end of it
           rather than dividing by nothing — that skip IS the fix. */
        const within = span > 1e-6 ? (target - lo) / span : 1;
        return (i - 1 + within) / (c.length - 1);
      }
    }
    return 1;
  }

  resize(): void {
    /* The CANVAS's own box, not the host's. The host is the full-viewport
       sticky layer that centres this; the width that matters is the one CSS
       puts on the canvas itself. */
    const box = this.canvas.getBoundingClientRect();
    if (box.width < 1) return;

    /* Sized to the HOST, which CSS has already sized against the plate. Capped
       at 1.75 rather than the full device ratio: this is flat vector ink with no
       fine detail to preserve, and the cost is per-pixel stroking every frame. */
    const dpr = Math.min(window.devicePixelRatio, 1.75);
    const cssH = box.width * (this.trace.viewBox.h / this.trace.viewBox.w);
    const w = Math.max(1, Math.round(box.width * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));

    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${cssH}px`;

    // The letterforms never change, so they are rendered once here and blitted
    // through the reveal on every frame after.
    const cache = document.createElement('canvas');
    cache.width = w;
    cache.height = h;
    const cctx = cache.getContext('2d');
    if (!cctx) throw new Error('signature: no 2D context for the ink cache');
    this.applyTransform(cctx, w);
    cctx.fillStyle = this.colour;
    cctx.fill(this.trace.ink);
    this.inkCache = cache;

    const wasDrawn = this.lastDrawn;
    this.lastDrawn = wasDrawn < 0 ? 0 : wasDrawn;
    this.render();
  }

  /** Scroll progress, 0..1. Remapped so INK grows evenly, not path length. */
  set progress(p: number) {
    const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
    // Sub-half-a-thousandth changes cannot show up on screen, and skipping them
    // means a settling scrub stops re-stroking a thousand-segment path.
    if (Math.abs(clamped - this.lastDrawn) < 0.0005) return;
    this.lastDrawn = clamped;
    this.render();
  }

  private render(): void {
    const { ctx, canvas, inkCache } = this;
    if (!inkCache) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const p = this.lastDrawn;
    if (p <= 0) return;

    // The reveal goes down first...
    this.strokeReveal(ctx, canvas.width, this.pathFractionFor(p));

    // ...then the letterforms are kept only where it landed.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(inkCache, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose(): void {
    this.canvas.remove();
    this.inkCache = null;
  }
}
