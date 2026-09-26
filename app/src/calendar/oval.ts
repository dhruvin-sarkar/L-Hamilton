/**
 * The oval reveal: the reference's `[data-oval-scroll]`, read off its script.
 *
 * Each line of the block sits in its own clip, closed to a sliver of ellipse
 * at its top centre -- `ellipse(20% 0% at 50% 0%)` -- with the line (and, where
 * it is split into letters, each letter) raised 40% of its height. When the
 * block's top passes 95% of the viewport the clips open to
 * `ellipse(100% 120% at 50% 0%)` over 1.5s on power2.inOut, 0.15s apart.
 *
 * The lines' and letters' drop back to 0 is NOT on that trigger in the
 * reference: it is a set of standalone tweens started when the block is set
 * up -- 1.5s, power2.inOut, the lines 0.15 + 0.1 x i late and the letters
 * spread 0.015s each from the centre. So a block already on screen at load
 * sees the letters settle as its oval opens, and one further down has long
 * since settled by the time it is scrolled to. Kept exactly that way.
 *
 * Lines are either the block's own `[data-oval-line]` children, or -- for a
 * run of copy -- measured off the rendered text, and measured again on a
 * resize. Under reduced motion nothing here runs and the block is as written.
 */

import { gsap, reducedMotion, ScrollTrigger } from '../lib/motion';

const CLOSED = 'ellipse(20% 0% at 50% 0%)';
const OPEN = 'ellipse(100% 120% at 50% 0%)';
const DURATION = 1.5;
const STAGGER = 0.15;

/** The block's copy as lines of text: its own line children, or measured. */
function linesOf(block: HTMLElement, text: string): { text: string; className: string }[] {
  const authored = [...block.querySelectorAll<HTMLElement>('[data-oval-line]')];
  if (authored.length) {
    return authored.map((line) => ({ text: line.textContent ?? '', className: line.className }));
  }

  /* Measure: one span per word, grouped by the line box it lands in. */
  const words = text.split(/(\s+)/).filter(Boolean);
  block.replaceChildren(
    ...words.map((word) => {
      const span = document.createElement('span');
      span.textContent = word;
      return span;
    }),
  );
  const lines: string[] = [];
  let top: number | null = null;
  for (const span of block.children as HTMLCollectionOf<HTMLElement>) {
    const word = span.textContent ?? '';
    if (/^\s+$/.test(word)) {
      if (lines.length) lines[lines.length - 1] += word;
      continue;
    }
    if (top === null || span.offsetTop > top + 1) {
      lines.push(word);
      top = span.offsetTop;
    } else {
      lines[lines.length - 1] += word;
    }
  }
  return lines.map((line) => ({ text: line.trimEnd(), className: '' }));
}

export function mountOvalScroll(block: HTMLElement): void {
  if (reducedMotion) return;

  const splitChars = block.hasAttribute('data-oval-chars');
  const text = block.textContent?.trim() ?? '';
  const authored = [...block.childNodes].map((node) => node.cloneNode(true));
  const hasAuthoredLines = block.querySelector('[data-oval-line]') !== null;
  let opened = false;

  const build = (): { clips: HTMLElement[]; lines: HTMLElement[]; chars: HTMLElement[][] } => {
    block.replaceChildren(...authored.map((node) => node.cloneNode(true)));
    const spec = linesOf(block, text);

    const outer = document.createElement('span');
    outer.className = 'oval';
    const clips: HTMLElement[] = [];
    const lines: HTMLElement[] = [];
    const chars: HTMLElement[][] = [];

    for (const { text: lineText, className } of spec) {
      const clip = document.createElement('span');
      clip.className = 'oval__clip';
      const line = document.createElement('span');
      line.className = `oval__line ${className}`.trim();
      const letters: HTMLElement[] = [];
      if (splitChars) {
        for (const ch of lineText) {
          const c = document.createElement('span');
          c.className = 'oval__char';
          c.textContent = ch;
          letters.push(c);
          line.appendChild(c);
        }
      } else {
        line.textContent = lineText;
      }
      clip.appendChild(line);
      outer.appendChild(clip);
      clips.push(clip);
      lines.push(line);
      chars.push(letters);
    }
    block.replaceChildren(outer);
    return { clips, lines, chars };
  };

  let parts = build();

  const settle = (): void => {
    parts.lines.forEach((line, i) => {
      gsap.fromTo(line, { yPercent: -40 }, {
        yPercent: 0,
        duration: DURATION,
        ease: 'power2.inOut',
        delay: STAGGER + 0.1 * i,
      });
      const letters = parts.chars[i] ?? [];
      if (letters.length) {
        gsap.fromTo(letters, { yPercent: -40 }, {
          yPercent: 0,
          duration: DURATION,
          ease: 'power2.inOut',
          delay: STAGGER * i,
          stagger: { amount: 0.015 * letters.length, from: 'center' },
        });
      }
    });
  };

  gsap.set(parts.clips, { clipPath: CLOSED });
  settle();

  ScrollTrigger.create({
    trigger: block,
    start: 'top 95%',
    once: true,
    onEnter: () => {
      opened = true;
      gsap.to(parts.clips, { clipPath: OPEN, duration: DURATION, ease: 'power2.inOut', stagger: STAGGER });
    },
  });

  /* A measured block re-measures when its width changes: the line breaks are
     a rendering fact. Authored lines never move. */
  if (!hasAuthoredLines) {
    let width = block.clientWidth;
    new ResizeObserver(() => {
      if (block.clientWidth === width) return;
      width = block.clientWidth;
      parts = build();
      gsap.set(parts.clips, { clipPath: opened ? OPEN : CLOSED });
    }).observe(block);
  }
}
