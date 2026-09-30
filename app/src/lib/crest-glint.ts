/**
 * The glint on the metal crest: one soft band of light swept across the
 * helmet and laurels when the crest finishes growing in, and again when the
 * pointer enters the crest's section. Not in the reference, whose crest is
 * flat; the metal and this glint are a deliberate, requested departure.
 *
 * The band is a gradient (#crest-glint in partials/crest.html) that the
 * drawing's glint layer paints with, parked just off the drawing so that at
 * rest it paints nothing. Every crest on a page is a <use> of that ONE
 * drawing, so moving the template would sweep every crest at once. A crest
 * that glints therefore gets its own pair of gradients — the band, and the
 * band as the mirrored right branch sees it — which take the template's
 * stops and vector through `href` and own only the transform moved here. The
 * glint layer finds them through --crest-glint and --crest-glint-mirror, set
 * on this crest alone.
 *
 * GSAP tweens one number, the band's distance along its own axis, and writes
 * it into both transforms. A gradient transform repaints the small SVG that
 * uses it and nothing else: no layout, no filter.
 *
 * Under reduced motion it never runs, and the crest is simply its metal.
 */

import { gsap, reducedMotion } from './motion';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One pass: unhurried at both ends, so the light arrives and leaves rather than flicking. */
const SWEEP = { duration: 1.1, ease: 'power2.inOut' };

const sweeps = new WeakMap<SVGElement, gsap.core.Tween>();
let made = 0;

function template(id: string): SVGLinearGradientElement {
  const gradient = document.getElementById(id);
  if (!(gradient instanceof SVGLinearGradientElement)) {
    throw new Error(`crest glint: no #${id} on this page (partials/crest.html)`);
  }
  return gradient;
}

/** This crest's own copy of the band, and the tween that carries it across. */
function makeSweep(crest: SVGElement): gsap.core.Tween {
  const band = template('crest-glint');
  const mirroredBand = template('crest-glint-mirror');
  const travel = Number(band.dataset.travel);
  if (!(travel > 0)) throw new Error('crest glint: #crest-glint needs a positive data-travel');
  // The templates' own transforms lay the band across the drawing (and, for
  // the right branch, back through its mirror); the sweep is appended to them.
  const lay = band.getAttribute('gradientTransform') ?? '';
  const layMirrored = mirroredBand.getAttribute('gradientTransform') ?? '';

  made += 1;
  const own = (id: string) => {
    const gradient = document.createElementNS(SVG_NS, 'linearGradient');
    gradient.id = id;
    gradient.setAttribute('href', `#${band.id}`);
    return gradient;
  };
  const glint = own(`crest-glint-${made}`);
  const glintMirrored = own(`crest-glint-mirror-${made}`);
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.append(glint, glintMirrored);
  crest.prepend(defs);
  crest.style.setProperty('--crest-glint', `url(#${glint.id})`);
  crest.style.setProperty('--crest-glint-mirror', `url(#${glintMirrored.id})`);

  const pass = { along: 0 };
  const place = () => {
    glint.setAttribute('gradientTransform', `${lay} translate(${pass.along} 0)`);
    glintMirrored.setAttribute('gradientTransform', `${layMirrored} translate(${pass.along} 0)`);
  };
  place();
  // Both ends are parked off the drawing, so a restart jumps between two
  // positions that paint nothing.
  return gsap.to(pass, { along: travel, ...SWEEP, paused: true, onUpdate: place });
}

/**
 * Sweep the glint across `crest` (the <svg> that <use>s the drawing) once.
 * A pass already under way is left to finish rather than restarted.
 */
export function glintCrest(crest: SVGElement): void {
  if (reducedMotion) return;
  let sweep = sweeps.get(crest);
  if (!sweep) {
    sweep = makeSweep(crest);
    sweeps.set(crest, sweep);
  }
  if (!sweep.isActive()) sweep.restart();
}

/** Glint `crest` whenever the pointer enters `section`. Returns the undo. */
export function glintCrestOnHover(crest: SVGElement, section: Element): () => void {
  const play = () => glintCrest(crest);
  section.addEventListener('pointerenter', play);
  return () => section.removeEventListener('pointerenter', play);
}
