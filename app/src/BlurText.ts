import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/* Per-word blur-in, ported from the React Bits <BlurText /> component.
 *
 * Same motion, different runtime. The original is React + `motion`, and pulling
 * both in for one paragraph would mean a second animation library running
 * beside GSAP. The keyframes, the step timing and the stagger below are the
 * component's, unchanged:
 *
 *   from   blur(10px)  opacity 0    y +/-50
 *   step 1 blur(5px)   opacity 0.5  y -/+5
 *   step 2 blur(0)     opacity 1    y 0
 *
 * Two steps at `stepDuration` each, so a word takes twice that to land, and
 * word N starts N * delay after the first.
 *
 * The one prop that could not carry over is the IntersectionObserver pair
 * (threshold / rootMargin). ScrollTrigger already watches the scroll for the
 * rest of the page, so this takes a `start` string instead. */

export type BlurTextOptions = {
  /** Milliseconds between one element starting and the next. */
  delay?: number;
  /** Whole words, or one letter at a time. Words wrap as units either way. */
  animateBy?: 'words' | 'letters';
  /** Which side the text rises from. */
  direction?: 'top' | 'bottom';
  /** Seconds per keyframe step. */
  stepDuration?: number;
  /** ScrollTrigger start. The default fires just before the block is fully in view. */
  start?: string;
  /** Override the resting state. */
  from?: gsap.TweenVars;
  /** Override the steps. Any length; each runs for stepDuration. */
  to?: gsap.TweenVars[];
  ease?: string;
  onComplete?: () => void;
};

const WORD = 'blur-text__word';
const UNIT = 'blur-text__unit';

/**
 * Wrap every word in the subtree in a span, in place.
 *
 * Recursive rather than a regex over innerHTML because the paragraph carries
 * inline markup — the accent words are <strong> — and rebuilding the string
 * would either drop those or need the tags parsed by hand.
 *
 * The whitespace between words stays a real text node, so the result still lays
 * out as a paragraph: normal wrapping, working text-align, no flexbox.
 */
function wrapWords(root: HTMLElement): HTMLSpanElement[] {
  const words: HTMLSpanElement[] = [];

  const walk = (node: Node): void => {
    // Snapshot: replaceWith mutates childNodes while we are iterating it.
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
        continue;
      }
      if (child.nodeType !== Node.TEXT_NODE) continue;

      const parts = (child.textContent ?? '').split(/(\s+)/);
      const frag = document.createDocumentFragment();

      for (const part of parts) {
        if (!part) continue;
        if (!part.trim()) {
          frag.append(part);
          continue;
        }
        const span = document.createElement('span');
        span.className = WORD;
        span.textContent = part;
        words.push(span);
        frag.append(span);
      }

      child.replaceWith(frag);
    }
  };

  walk(root);
  return words;
}

/** Split each word into per-letter spans. The word span stays, so the word still wraps whole. */
function splitLetters(words: HTMLSpanElement[]): HTMLSpanElement[] {
  const letters: HTMLSpanElement[] = [];

  for (const word of words) {
    const text = word.textContent ?? '';
    word.textContent = '';
    for (const char of text) {
      const span = document.createElement('span');
      span.className = UNIT;
      span.textContent = char;
      letters.push(span);
      word.append(span);
    }
  }

  return letters;
}

/**
 * Animate the text already inside `root`.
 *
 * Reads the element's own markup rather than taking a `text` string, which is
 * what lets the accent words keep their <strong> wrapper.
 */
export function mountBlurText(root: HTMLElement, opts: BlurTextOptions = {}): void {
  const {
    delay = 200,
    animateBy = 'words',
    direction = 'top',
    stepDuration = 0.35,
    start = 'top 85%',
    ease = 'none',
    onComplete,
  } = opts;

  /* Reduced motion gets the text and nothing else. Returning before the split
     also leaves the markup untouched, so there is no chance of a half-applied
     transform sticking on a word. */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    onComplete?.();
    return;
  }

  const words = wrapWords(root);
  if (!words.length) return;

  const units = animateBy === 'letters' ? splitLetters(words) : words;
  for (const unit of units) unit.classList.add(UNIT);

  const rise = direction === 'top' ? -1 : 1;
  const from: gsap.TweenVars = opts.from ?? { filter: 'blur(10px)', opacity: 0, y: 50 * rise };
  const steps: gsap.TweenVars[] = opts.to ?? [
    { filter: 'blur(5px)', opacity: 0.5, y: -5 * rise },
    { filter: 'blur(0px)', opacity: 1, y: 0 },
  ];

  gsap.set(units, from);

  /* Promotion is a class on the paragraph, on for the run and off after.
   *
   * Two style writes instead of two per word. Setting will-change per word as
   * it starts and clearing it as it lands reads as the tidier version, but it
   * creates and destroys a compositor layer for every word, interleaved with
   * the animation — and layer churn is the expensive part, not layer count.
   * Leaving it on permanently, which is what the original component does, is
   * the other end of the same mistake. */
  const tl = gsap.timeline({
    paused: true,
    onComplete: () => {
      root.classList.remove('is-blurring');
      onComplete?.();
    },
  });

  units.forEach((unit, i) => {
    tl.to(
      unit,
      { keyframes: steps.map((step) => ({ ...step, duration: stepDuration, ease })) },
      (i * delay) / 1000,
    );
  });

  /* Promotion goes on here rather than in the timeline's onStart. A timeline
     built paused and started with play() does not reliably fire onStart — the
     class was never applied and the will-change rule never matched, which is
     invisible because the animation itself runs either way. The trigger is the
     thing that definitely fires, so it owns the switch-on; onComplete owns the
     switch-off. */
  ScrollTrigger.create({
    trigger: root,
    start,
    once: true,
    onEnter: () => {
      root.classList.add('is-blurring');
      tl.play();
    },
  });
}
