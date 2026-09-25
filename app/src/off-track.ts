/**
 * /off-track — Lewis Hamilton away from the car.
 *
 * Section order follows the reference (public/off-track.html): the page header
 * and the statement share one scroll group, then the side-scrolling gallery,
 * then the socials block and the footer. There is no helmet wall and no store
 * call on this page, so neither is included.
 *
 * Every word of copy and every picture comes from src/content/off-track.ts,
 * which carries a source for each claim and refuses to load without one. The
 * figures (his age, his debut year, the team and the year he joined it) come
 * from the same records the other pages read.
 */

import './styles/off-track.css';
import Lenis from 'lenis';
import { gsap, mm, reducedMotion, ScrollTrigger } from './lib/motion';
import { mountChrome } from './lib/chrome';
import { whenEntranceCued } from './lib/transition';
import { mountReveals } from './lib/reveal';
import { mountGalleryScroll } from './lib/gallery';
import { mountSocials } from './lib/showcase';
import { Signature } from './Signature';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { age, driver, eras } from './content/hamilton';
import { career } from './content/live-stats';
import { galleryIntro, hero, projects } from './content/off-track';
import type { Photo } from './content/off-track';

/* The flight follows a drawn path, as the reference's does (its motionPath). */
gsap.registerPlugin(MotionPathPlugin);

/* ------------------------------------------------------------------ *
 * Smooth scroll
 *
 * The same instance, with the same options, that Home and On Track build — see
 * main.ts. `lerp` IS the scroll feel, and the reference measures 0.1.
 * ScrollTrigger is driven from Lenis, and Lenis from gsap's ticker, so the two
 * share one clock.
 * ------------------------------------------------------------------ */

let lenis: Lenis | null = null;

if (!reducedMotion) {
  lenis = new Lenis({
    lerp: 0.1,
    smoothWheel: true,
    syncTouch: true,
    syncTouchLerp: 0.075,
    wheelMultiplier: 1,
    touchMultiplier: 1.25,
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis?.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A required element. Missing markup is a build fault, not a quiet gap. */
function must<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`[off-track] missing ${selector}`);
  return found;
}

/** The team he drives for now and the year he joined it, off the open era. */
const currentEra = (() => {
  const era = eras.find((e) => e.to === null);
  if (!era) throw new Error('[off-track] no open era in the content model');
  return era;
})();

/* ------------------------------------------------------------------ *
 * Text bindings
 * ------------------------------------------------------------------ */

const SMALL_NUMBERS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen',
];

/** A small count spelled out, for a figure that sits inside a sentence. */
function spell(n: number): string {
  const word = SMALL_NUMBERS[n];
  if (word === undefined) throw new Error(`[off-track] cannot spell ${n}`);
  return word;
}

const bindings: Record<string, string> = {
  'driver-age': String(age()),
  'team-since': `${currentEra.team} F1 since ${currentEra.from}`,
  /* The statement's "chasing eight": the title after the ones he has, counted
     from the same record the On Track page reads. */
  'next-title-word': spell(career.championships + 1),
};

for (const [key, value] of Object.entries(bindings)) {
  for (const node of document.querySelectorAll<HTMLElement>(`[data-bind="${key}"]`)) {
    node.textContent = value;
  }
}

/* ------------------------------------------------------------------ *
 * The page header's copy
 * ------------------------------------------------------------------ */

must('[data-hero-eyebrow]').textContent = hero.eyebrow;
must('[data-hero-recently]').textContent = hero.recently.text;

{
  const lead = must('[data-hero-lead]');
  lead.replaceChildren(
    document.createTextNode(`${hero.lead.before.replace('{debut}', String(driver.debutYear))} `),
    el('span', 'oft-hero__accent', hero.lead.accent),
    document.createTextNode(hero.lead.after),
  );
}

must('[data-hero-ventures]').textContent =
  `Lewis Hamilton's ventures: ${hero.ventures.map((v) => v.name).join(', ')}.`;

/* ------------------------------------------------------------------ *
 * The ventures row
 *
 * The reference's .marquee-advanced, read out of lando-gl.js (O$):
 *
 *   - the collection is repeated (data-marquee-duplicate="4") and every copy
 *     loops xPercent 0 -> -100, linear, repeat forever
 *   - duration = speed x (collection width / viewport width), speed 40, so it
 *     runs one screen-width every 40 seconds whatever the list length
 *   - its direction follows the SCROLL: scrolling down runs it one way,
 *     scrolling up the other ("data-marquee-direction=right")
 *   - and on top of the loop the whole row is scrubbed bodily across the
 *     viewport, -10vw to +10vw, over the row's pass through the screen
 * ------------------------------------------------------------------ */

const MARQUEE_SPEED = 40;
const MARQUEE_COPIES = 5;
const MARQUEE_DRIFT_VW = 10;

{
  const box = must('[data-hero-marquee]');
  const scroller = must('.oft-hero__marquee-scroll', box);
  const track = must('.oft-hero__marquee-track', box);

  const buildCopy = (): HTMLElement => {
    const copy = el('div', 'oft-hero__marquee-track');
    hero.ventures.forEach((v, i) => {
      // Every other name in the serif, so the row reads as a set of different
      // marks the way the reference's logos do, rather than one repeated face.
      copy.append(el('span', `oft-hero__venture${i % 2 ? ' is-serif' : ''}`, v.name));
    });
    return copy;
  };

  const copies = [buildCopy()];
  track.replaceWith(copies[0] as HTMLElement);
  for (let i = 1; i < MARQUEE_COPIES; i++) {
    const copy = buildCopy();
    copies.push(copy);
    scroller.append(copy);
  }

  if (!reducedMotion) {
    const first = copies[0] as HTMLElement;
    const duration = MARQUEE_SPEED * (first.offsetWidth / window.innerWidth);
    const loop = gsap.to(copies, { xPercent: -100, repeat: -1, duration, ease: 'none' });
    loop.totalProgress(0.5);

    /* Scrolling down runs the row to the right, scrolling up to the left:
       the reference's timeScale(-Z) / timeScale(Z) with Z = 1. At rest it
       keeps whichever way it was last sent. */
    loop.timeScale(1);
    ScrollTrigger.create({
      trigger: box,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (self) => loop.timeScale(self.direction === 1 ? -1 : 1),
    });

    gsap.fromTo(
      scroller,
      { x: `${-MARQUEE_DRIFT_VW}vw` },
      {
        x: `${MARQUEE_DRIFT_VW}vw`,
        ease: 'none',
        scrollTrigger: { trigger: box, start: 'top bottom', end: 'bottom top', scrub: 0 },
      },
    );

    new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) loop.play();
      else loop.pause();
    }).observe(box);
  }
}

/* ------------------------------------------------------------------ *
 * The header's entrance
 *
 * The reference's, read out of lando-gl.js (e0, for data-oval-scroll):
 *
 *   OFF TRACK   the title's line sits in a box clipped to an ellipse that
 *               opens from the BOTTOM centre — ellipse(20% 0% at 50% 100%)
 *               to ellipse(100% 120% at 50% 100%) — while every letter rises
 *               from +40% of its height, 1.5s power2.inOut, 0.015s apart out
 *               from the centre.
 *   signature   written on with the page, as the On Track header's is.
 *
 * Every text line in the header sweeps in through mountReveals, on the same
 * cue. Nothing is hidden under reduced motion.
 * ------------------------------------------------------------------ */

/** Seconds from ready to the moment the header plays: the reference's k0. */
const HERO_CUE = 0.75;

const titleLine = must('.oft-hero__title');
const signHost = must('.oft-hero__sign');

mm.add('(prefers-reduced-motion: no-preference)', () => {
  const words = [...titleLine.querySelectorAll<HTMLElement>('.oft-hero__off, .oft-hero__track')];
  const texts = words.map((w) => w.textContent ?? '');
  const letters: HTMLElement[] = [];
  words.forEach((word, i) => {
    const chars = [...(texts[i] ?? '')].map((c) => el('span', 'oft-hero__char', c));
    letters.push(...chars);
    word.replaceChildren(...chars);
  });

  gsap.set(titleLine, { clipPath: 'ellipse(20% 0% at 50% 100%)' });
  gsap.set(letters, { yPercent: 40 });

  /* The signature, drawn by the same pen the other pages use. The still mask
     goes at once, or it would show whole and then vanish to be written. */
  const pen = { p: 0 };
  let signature: Signature | null = null;
  let live = true;
  signHost.classList.add('is-writing');
  fetch('/assets/brand/signature.svg')
    .then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    })
    .then((markup) => {
      if (!live) return;
      const ink = getComputedStyle(signHost).getPropertyValue('--grey-on-track').trim();
      signature = new Signature(signHost, markup, ink);
      signature.progress = pen.p;
    })
    .catch((err: unknown) => {
      // Decorative: the still mask comes back and the header is complete.
      console.error('[off-track] signature failed to load', err);
      signHost.classList.remove('is-writing');
    });
  const sized = new ResizeObserver(() => signature?.resize());
  sized.observe(signHost);

  const entrance = gsap
    .timeline({ paused: true })
    .to(titleLine, {
      clipPath: 'ellipse(100% 120% at 50% 100%)',
      duration: 1.5,
      ease: 'power2.inOut',
    }, HERO_CUE)
    .to(letters, {
      yPercent: 0,
      duration: 1.5,
      ease: 'power2.inOut',
      stagger: { amount: 0.015 * letters.length, from: 'center' },
    }, HERO_CUE)
    .to(pen, {
      p: 1,
      duration: 1.4,
      ease: 'sine.inOut',
      onUpdate: () => {
        if (signature) signature.progress = pen.p;
      },
    }, HERO_CUE);

  // Held for the loader too: the entrance plays as it opens onto the page.
  void Promise.all([document.fonts.ready, whenEntranceCued()]).then(() => entrance.play());

  return () => {
    live = false;
    entrance.kill();
    sized.disconnect();
    signature?.dispose();
    signHost.classList.remove('is-writing');
    words.forEach((word, i) => {
      word.textContent = texts[i] ?? '';
    });
    gsap.set(titleLine, { clearProps: 'clipPath' });
  };
});

/* ------------------------------------------------------------------ *
 * The flying picture's layers
 *
 * Ten photographs stacked in the frame, the first on top. The flight below
 * shows one at a time by scroll progress; at rest only the first shows.
 * ------------------------------------------------------------------ */

{
  const flight = must('[data-flight]');
  flight.replaceChildren(
    ...hero.flight.map((photo, i) => {
      const img = el('img', 'oft-flight__layer');
      img.src = photo.src;
      img.width = photo.width;
      img.height = photo.height;
      img.alt = '';
      img.decoding = 'async';
      img.loading = i === 0 ? 'eager' : 'lazy';
      return img;
    }),
  );
}

/* ------------------------------------------------------------------ *
 * The statement's oval reveal
 *
 * The reference's data-oval-scroll="top" (e0 in lando-gl.js), which is how its
 * Off Track statement arrives — not the accent bar the smaller copy uses:
 *
 *   - the block is cut into its visual lines, each in a box clipped to an
 *     ellipse that opens from the TOP centre: ellipse(20% 0% at 50% 0%) to
 *     ellipse(100% 120% at 50% 0%), 1.5s power2.inOut, 0.15s apart
 *   - each line drops from -40% of its height, 0.1s after the one above
 *   - and inside it every letter drops from -40% too, 0.015s apart out from
 *     the centre of the line
 *   - fired once, as the block's top passes 95% of the screen
 *
 * Lines are measured, not authored: every word gets its own box, the boxes
 * are grouped by the line they landed on, and the block is rebuilt one clip
 * box per line. The accent face is carried through the cut.
 * ------------------------------------------------------------------ */

interface Run {
  text: string;
  cls: string;
  br?: boolean;
}

/** The block's authored content as formatted runs, so a re-cut starts clean. */
function runsOf(block: HTMLElement): Run[] {
  const runs: Run[] = [];
  const walk = (node: Node, cls: string): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) runs.push({ text: child.nodeValue ?? '', cls });
      else if (child instanceof HTMLElement) {
        if (child.tagName === 'BR') runs.push({ text: '', cls: '', br: true });
        else walk(child, child.className);
      }
    }
  };
  walk(block, '');
  return runs;
}

interface OvalCut {
  boxes: HTMLElement[];
  lines: HTMLElement[];
  chars: HTMLElement[][];
}

/** Rebuild `block` one clip box per visual line. */
function cutLines(block: HTMLElement, runs: Run[]): OvalCut {
  interface Word {
    span: HTMLElement;
    text: string;
    cls: string;
    /** Whether real whitespace followed it — "eight" then "." must stay joined. */
    spaceAfter: boolean;
  }

  // Measuring pass: one span per word, the authored breaks kept in the flow.
  block.textContent = '';
  const words: Word[] = [];
  for (const run of runs) {
    if (run.br) {
      block.append(document.createElement('br'));
      continue;
    }
    for (const token of run.text.split(/(\s+)/)) {
      if (!token) continue;
      if (/^\s+$/.test(token)) {
        block.append(document.createTextNode(' '));
        const last = words[words.length - 1];
        if (last) last.spaceAfter = true;
        continue;
      }
      const span = el('span', run.cls, token);
      block.append(span);
      words.push({ span, text: token, cls: run.cls, spaceAfter: false });
    }
  }

  // Grouped by vertical midpoint against half a line: the serif accent sits a
  // few pixels off the grotesque's box on the same line, never a line away.
  const leading = Number.parseFloat(getComputedStyle(block).lineHeight) || 100;
  const rows: Word[][] = [];
  let anchor: number | null = null;
  for (const word of words) {
    const middle = word.span.offsetTop + word.span.offsetHeight / 2;
    if (anchor === null || Math.abs(middle - anchor) > leading / 2) {
      rows.push([]);
      anchor = middle;
    }
    rows[rows.length - 1]?.push(word);
  }

  block.textContent = '';
  const cut: OvalCut = { boxes: [], lines: [], chars: [] };
  for (const row of rows) {
    const box = el('span', 'oft-oval');
    const line = el('span', 'oft-oval__line');
    const chars: HTMLElement[] = [];
    row.forEach((word, i) => {
      const host = word.cls ? el('span', word.cls) : line;
      for (const c of word.text) {
        const ch = el('span', 'oft-oval__char', c);
        chars.push(ch);
        host.append(ch);
      }
      if (host !== line) line.append(host);
      // The space stays in the text, so the block still reads as words.
      if (word.spaceAfter && i < row.length - 1) line.append(document.createTextNode(' '));
    });
    box.append(line);
    block.append(box);
    cut.boxes.push(box);
    cut.lines.push(line);
    cut.chars.push(chars);
  }
  return cut;
}

function mountOval(block: HTMLElement): void {
  const runs = runsOf(block);
  const plain = runs.map((r) => (r.br ? ' ' : r.text)).join('').replace(/\s+/g, ' ').trim();
  // Read as one heading, whatever the cut does to its text nodes.
  block.setAttribute('aria-label', plain);

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    let played = false;
    let cut = cutLines(block, runs);

    const hide = (c: OvalCut): void => {
      gsap.set(c.boxes, { clipPath: 'ellipse(20% 0% at 50% 0%)' });
      gsap.set(c.lines, { yPercent: -40 });
      c.chars.forEach((chars) => gsap.set(chars, { yPercent: -40 }));
    };

    const play = (c: OvalCut): void => {
      const STEP = 0.15;
      gsap.to(c.boxes, {
        clipPath: 'ellipse(100% 120% at 50% 0%)',
        duration: 1.5,
        ease: 'power2.inOut',
        stagger: STEP,
      });
      c.lines.forEach((line, q) => {
        gsap.to(line, { yPercent: 0, duration: 1.5, ease: 'power2.inOut', delay: STEP + 0.1 * q });
        const chars = c.chars[q] ?? [];
        gsap.to(chars, {
          yPercent: 0,
          duration: 1.5,
          ease: 'power2.inOut',
          delay: STEP * q,
          stagger: { amount: 0.015 * chars.length, from: 'center' },
        });
      });
    };

    hide(cut);
    const trigger = ScrollTrigger.create({
      trigger: block,
      start: 'top 95%',
      once: true,
      onEnter: () => {
        played = true;
        play(cut);
      },
    });

    // Line breaks move with the width below 992px, where the root stops
    // scaling. Re-cut from the authored runs; a block already read stays read.
    let wait = 0;
    const recut = (): void => {
      window.clearTimeout(wait);
      wait = window.setTimeout(() => {
        gsap.killTweensOf([...cut.boxes, ...cut.lines, ...cut.chars.flat()]);
        cut = cutLines(block, runs);
        if (!played) hide(cut);
      }, 200);
    };
    window.addEventListener('resize', recut);

    return () => {
      window.removeEventListener('resize', recut);
      window.clearTimeout(wait);
      trigger.kill();
      gsap.killTweensOf([...cut.boxes, ...cut.lines, ...cut.chars.flat()]);
      block.textContent = '';
      for (const run of runs) {
        if (run.br) block.append(document.createElement('br'));
        else if (run.cls) block.append(el('span', run.cls, run.text));
        else block.append(document.createTextNode(run.text));
      }
    };
  });
}

/* After the bindings, so the counted word is what gets cut; after the fonts,
   so lines are measured in the real faces. */
void document.fonts.ready.then(() => {
  mountOval(must('.oft-impact__text'));
  ScrollTrigger.refresh();
});

/* ------------------------------------------------------------------ *
 * The statement's signature
 *
 * The reference's signature_scroll artboard: written as the mark crosses the
 * screen, scrubbed from its top at 50% of the viewport to its top at 10%.
 * ------------------------------------------------------------------ */

{
  const host = must('.oft-impact__sign');
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    let signature: Signature | null = null;
    let live = true;
    const pen = { p: 0 };
    host.classList.add('is-writing');
    fetch('/assets/brand/signature.svg')
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((markup) => {
        if (!live) return;
        const ink = getComputedStyle(host).getPropertyValue('--grey-on-track').trim();
        signature = new Signature(host, markup, ink);
        signature.progress = pen.p;
      })
      .catch((err: unknown) => {
        console.error('[off-track] signature failed to load', err);
        host.classList.remove('is-writing');
      });
    const sized = new ResizeObserver(() => signature?.resize());
    sized.observe(host);

    const trigger = ScrollTrigger.create({
      trigger: host,
      start: 'top 50%',
      end: 'top 10%',
      scrub: true,
      onUpdate: (self) => {
        pen.p = self.progress;
        if (signature) signature.progress = pen.p;
      },
    });

    return () => {
      live = false;
      trigger.kill();
      sized.disconnect();
      signature?.dispose();
      host.classList.remove('is-writing');
    };
  });
}

/* ------------------------------------------------------------------ *
 * The flight
 *
 * The reference's heroflip (z_ in lando-gl.js), measured rather than eyeballed:
 *
 *   - the picture is lifted out of the header into the group and centred on
 *     each stop in turn: the header slot, the statement, the signature
 *   - it travels a two-segment cubic through the three centres, with the
 *     control points below, scrubbed 1:1 from the group's top at the top of
 *     the screen to its bottom at the centre ("20% top" to "bottom 80%" on a
 *     narrow screen)
 *   - its size runs stop 1 -> stop 2 over the first half and stop 2 -> stop 3
 *     over the second
 *   - and it flicks through the ten photographs by progress, one at a time
 *
 * Under reduced motion none of this runs: the picture stays in the header.
 * ------------------------------------------------------------------ */

mm.add('(prefers-reduced-motion: no-preference)', () => {
  const track = must('[data-flight-track]');
  const flight = must('[data-flight]');
  const home = flight.parentElement;
  const stops = [1, 2, 3].map((n) => must(`[data-flight-stop="${n}"]`));
  const layers = [...flight.children] as HTMLElement[];
  if (!home || layers.length === 0) throw new Error('[off-track] flight has nothing to fly');

  track.append(flight);
  flight.classList.add('is-flying');

  let shown = 0;
  const show = (i: number): void => {
    if (i === shown) return;
    const was = layers[shown];
    const now = layers[i];
    if (was) was.style.opacity = '0';
    if (now) now.style.opacity = '1';
    shown = i;
  };

  let tween: gsap.core.Tween | null = null;

  const build = (): void => {
    tween?.scrollTrigger?.kill();
    tween?.kill();

    const origin = track.getBoundingClientRect();
    const [a, b, c] = stops.map((stop) => {
      const r = stop.getBoundingClientRect();
      return {
        x: r.left - origin.left + r.width / 2,
        y: r.top - origin.top + r.height / 2,
        w: r.width,
        h: r.height,
      };
    }) as [Box, Box, Box];

    gsap.set(flight, { xPercent: -50, yPercent: -50, x: a.x, y: a.y, width: a.w, height: a.h });

    // The reference's control points, verbatim.
    const p1 = { x: a.x, y: a.y + (b.y - a.y) * 0.8 };
    const p2 = { x: b.x, y: b.y - Math.min(800, (b.y - a.y) * 0.3) };
    const p3 = { x: b.x, y: b.y + Math.min(80, (c.y - b.y) * 0.3) };
    const p4 = { x: b.x + (c.x - b.x) * 0.6, y: c.y - (c.y - b.y) * 0.2 };
    const path =
      `M${a.x},${a.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${b.x},${b.y} ` +
      `C${p3.x},${p3.y} ${p4.x},${p4.y} ${c.x},${c.y}`;

    const narrow = window.innerWidth <= 991;
    tween = gsap.to(flight, {
      duration: 1.5,
      ease: 'none',
      motionPath: { path, autoRotate: false },
      onUpdate: function (this: gsap.core.Tween) {
        const p = this.progress();
        show(Math.min(Math.floor(p * layers.length), layers.length - 1));
        const [from, to, t] = p <= 0.5 ? [a, b, p * 2] : [b, c, (p - 0.5) * 2];
        flight.style.width = `${from.w + (to.w - from.w) * t}px`;
        flight.style.height = `${from.h + (to.h - from.h) * t}px`;
      },
      scrollTrigger: {
        trigger: track,
        start: narrow ? '20% top' : 'top top',
        end: narrow ? 'bottom 80%' : 'bottom center',
        scrub: true,
      },
    });
  };

  interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  let wait = 0;
  const rebuild = (): void => {
    window.clearTimeout(wait);
    wait = window.setTimeout(build, 200);
  };

  build();
  // Positions settle with the real faces and the statement's cut.
  void document.fonts.ready.then(() => requestAnimationFrame(build));
  window.addEventListener('resize', rebuild);

  return () => {
    window.removeEventListener('resize', rebuild);
    window.clearTimeout(wait);
    tween?.scrollTrigger?.kill();
    tween?.kill();
    flight.classList.remove('is-flying');
    gsap.set(flight, { clearProps: 'all' });
    layers.forEach((layer) => layer.style.removeProperty('opacity'));
    home.append(flight);
  };
});

/* ------------------------------------------------------------------ *
 * Personal projects: the side-scrolling gallery
 *
 * The reference's Off Track track, measured at 1728x1080 (every size in vh,
 * as it writes them): an opening column, then four projects, each a title
 * column, a column with the large picture and a callout, and a column with a
 * pair of pictures, the spacers between them alternating as its own do.
 *
 *   top   title 1.67vh down; large picture at the top, the callout at the
 *         foot; the pair one at 14.92vh, the other poking half a spacer back
 *         and sitting 2 gaps off the foot
 *   mid   title 50.5vh off the foot; the callout at the top, the large
 *         picture at the foot; the pair both pushed down, 8.42vh off the foot
 *         and 14.42vh in (or only the second of them, in the last project)
 *
 * The frame sizes are the reference's own classes, named after them here.
 * ------------------------------------------------------------------ */

type Frame = 'offt1' | 'large' | 'offt6' | 'offt7' | 'offt3' | 'offt4';
type Spacer = 'full' | 'half' | 'quarter';

interface ProjectLayout {
  title: 'top' | 'mid';
  /** The reference sets one descriptor in its bolder descriptor face. */
  descriptor: 'eyebrow' | 'descriptor';
  /** The callout beside the large picture: at its foot, or above it. */
  callout: 'foot' | 'head' | 'head-hidden';
  pair: 'a' | 'b' | 'd';
  /** Spacers after the large column and after the pair. */
  after: [Spacer, Spacer];
}

/** One per project, in the reference's order. */
const LAYOUT: readonly ProjectLayout[] = [
  { title: 'top', descriptor: 'eyebrow', callout: 'foot', pair: 'a', after: ['full', 'half'] },
  /* The reference keeps this callout in the flow but invisible (`.op-0`) at
     every width, holding its cell open beside the picture; the same here. */
  { title: 'mid', descriptor: 'descriptor', callout: 'head-hidden', pair: 'b', after: ['half', 'full'] },
  { title: 'top', descriptor: 'eyebrow', callout: 'foot', pair: 'a', after: ['full', 'half'] },
  { title: 'mid', descriptor: 'eyebrow', callout: 'head', pair: 'd', after: ['half', 'full'] },
];

function buildGallery(): void {
  const track = must('[data-gallery-track]');
  if (projects.length !== LAYOUT.length) {
    throw new Error(`[off-track] the gallery is laid out for ${LAYOUT.length} projects`);
  }

  const spacer = (size: Spacer): HTMLElement =>
    el('div', size === 'full' ? 'gallery__spacer' : `gallery__spacer is-${size}`);

  const col = (...mods: string[]): HTMLElement =>
    el('div', ['gallery__col', ...mods.map((m) => `gallery__col--${m}`)].join(' '));

  /** A captioned picture. The caption is the reveal target, as the reference's is. */
  const figure = (photo: Photo, frame: Frame, ...mods: string[]): HTMLElement => {
    const fig = el('figure', ['gallery__item', `oft-frame--${frame}`, ...mods].join(' '));
    if (photo.caption) fig.append(el('figcaption', 'gallery__cap reveal-text', photo.caption));
    const box = el('div', 'gallery__frame');
    const img = el('img');
    img.src = photo.src;
    img.width = photo.width;
    img.height = photo.height;
    // The caption says where; the picture itself is not described in text.
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    box.append(img);
    fig.append(box);
    return fig;
  };

  /** A title set on the lines the content breaks it on. */
  const title = (text: string, tag: 'h2' | 'h3', cls: string): HTMLElement => {
    const h = el(tag, cls);
    text.split('\n').forEach((line, i) => {
      if (i) h.append(el('br'));
      h.append(document.createTextNode(line));
    });
    return h;
  };

  /* ---- the opening column ---- */
  const intro = col('intro');
  const head = el('div', 'oft-gal__head');
  head.append(el('span', 'oft-gal__icon'));
  const h2 = el('h2', 'oft-gal__heading');
  h2.id = 'oft-gallery-h';
  h2.append(el('span', 'oft-gal__heading-plain', galleryIntro.plain), el('span', 'oft-gal__heading-serif', galleryIntro.serif));
  head.append(h2);
  const lead = figure(galleryIntro.lead, 'offt1', 'oft-gal__lead');
  lead.prepend(head);
  intro.append(lead);
  track.append(intro, spacer('full'));

  projects.forEach((project, i) => {
    const layout = LAYOUT[i] as ProjectLayout;
    const [large, first, second] = project.photos as [Photo, Photo, Photo];

    /* ---- the title ---- */
    const titleCol = col(`title-${layout.title}`);
    const block = el('div', `oft-gal__title oft-gal__title--${layout.title}`);
    block.append(title(project.title, 'h3', 'oft-gal__name'));
    block.append(
      el('p', layout.descriptor === 'descriptor' ? 'oft-gal__descriptor' : 'oft-gal__eyebrow reveal-text', project.descriptor),
    );
    titleCol.append(block);

    /* ---- the large picture and its callout ---- */
    const callout = el('div', `gallery__callout oft-callout oft-callout--${layout.callout}`);
    callout.append(el('p', 'gallery__quote oft-callout__text reveal-text', project.callout.text));
    // The reference's signature slot. Left empty: this is site copy, not his
    // words, and a signature under it would say otherwise.
    callout.append(el('span', 'oft-callout__mark'));

    const largeCol = col('large', `large-${layout.callout === 'foot' ? 'top' : 'foot'}`);
    const largeFig = figure(large, 'large');
    if (layout.callout === 'foot') largeCol.append(largeFig, callout);
    else largeCol.append(callout, largeFig);

    /* ---- the pair ---- */
    const pairCol = col(`pair-${layout.pair}`);
    pairCol.append(
      figure(first, layout.pair === 'a' ? 'offt6' : 'offt3', `oft-pair-${layout.pair}-1`),
      figure(second, layout.pair === 'a' ? 'offt7' : 'offt4', `oft-pair-${layout.pair}-2`),
    );

    track.append(titleCol, spacer('quarter'), largeCol, spacer(layout.after[0]), pairCol, spacer(layout.after[1]));
  });
}

buildGallery();

/* The reference's own timing for this section, the same as On Track's: travel
   from the moment the section enters, with a second of catch-up. */
mountGalleryScroll({ start: 'rising', scrub: 1 });

mountSocials();

/* ------------------------------------------------------------------ *
 * Chrome, reveals, and the entrance
 * ------------------------------------------------------------------ */

mountChrome();

mountReveals({
  immediate: '.oft-hero',
  /* The gallery's captions and callouts arrive on the X axis, each as its
     item's left edge passes 95% of the screen. The reference's C_() sends the
     section's first two (the first project's descriptor and caption) through
     a vertical "top 90%" trigger instead, as they rise into view before any
     sideways travel starts. */
  sideways: '.gallery',
  sidewaysMargin: '0px -5% -10% 0px',
  sidewaysFromBelow: 2,
  whenReady: (run) =>
    void Promise.all([document.fonts.ready, whenEntranceCued()]).then(() => gsap.delayedCall(HERO_CUE, run)),
});

void document.fonts.ready.then(() => {
  document.body.classList.add('is-ready');
  ScrollTrigger.refresh();
});
