/**
 * A pen over a set of stroked paths: how much of the ink is on the page, paced
 * by LENGTH rather than by path count.
 *
 * The same idea the collabs word uses in main.ts — a drawing's strokes can
 * differ in length several times over, so advancing one path per equal slice
 * of progress would crawl through the long ones and flick through the short.
 * Splitting progress by cumulative length keeps the pen at a constant speed.
 *
 * The visible ink is always one run along the whole drawing, [from, to] as
 * fractions of its total length: writing moves `to` from 0 to 1, and lifting
 * the ink off in the same direction moves `from` from 0 to 1.
 */

export interface Ink {
  paths: SVGGeometryElement[];
  lengths: number[];
  total: number;
}

/** Measures the paths once. Untouched by setInk, they stay whole. */
export function measureInk(paths: SVGGeometryElement[]): Ink {
  const lengths = paths.map((p) => p.getTotalLength());
  return { paths, lengths, total: lengths.reduce((a, b) => a + b, 0) };
}

/** Back to whole: every dash and hidden stroke cleared. */
export function clearInk(ink: Ink): void {
  for (const path of ink.paths) {
    path.style.removeProperty('stroke-dasharray');
    path.style.removeProperty('stroke-dashoffset');
    path.style.removeProperty('visibility');
  }
}

/** Shows the run of ink between `from` and `to` (fractions of the whole). */
export function setInk(ink: Ink, to: number, from = 0): void {
  const start = from * ink.total;
  const end = to * ink.total;
  let consumed = 0;
  for (const [i, path] of ink.paths.entries()) {
    const len = ink.lengths[i] ?? 0;
    const lo = Math.min(Math.max(start - consumed, 0), len);
    const hi = Math.min(Math.max(end - consumed, 0), len);
    consumed += len;
    /* Hidden outright rather than dashed away: a round cap draws a dot even
       on an empty dash, which would leave the pen's nib on every unwritten
       stroke. */
    path.style.visibility = hi <= lo ? 'hidden' : '';
    if (hi <= lo) continue;
    /* A dash exactly as long as the run, then a gap longer than the path,
       shifted so the dash begins at `lo` — so it ends at `hi`. */
    path.style.strokeDasharray = `${hi - lo} ${len}`;
    path.style.strokeDashoffset = String(-lo);
  }
}
