import './styles/main.css';
import * as THREE from 'three';
import gsap from 'gsap';
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin';
import { HeadScene } from './HeadScene';
import {
  age,
  careerTotals,
  championshipYears,
  driver,
  eras,
  seasonsRacing,
} from './content/hamilton';

/** The era he is in now — the one with no end date. */
const currentEra = eras.find((e) => e.to === null);
if (!currentEra) {
  // Fail fast: an eras list where every entry has ended means the data is stale,
  // and silently rendering a blank team line would hide that.
  throw new Error('[content] no ongoing era — eras data is out of date');
}

/* ------------------------------------------------------------------ *
 * Motion preference — read once, honoured everywhere.
 * ------------------------------------------------------------------ */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ *
 * Bind stable copy from the data model.
 * The markup ships empty placeholders rather than hardcoded values, so there
 * is exactly one place a number can be wrong.
 * ------------------------------------------------------------------ */

const bindings: Record<string, string> = {
  age: `${age()} y.o`,
  birthplace: driver.birthplace,
  seasons: String(seasonsRacing()),
  team: driver.currentTeam,
  debut: String(driver.debutYear),
  // When he joined the CURRENT team — not his F1 debut. The reference's card
  // reads "mclaren f1 since 2019", which is Norris's tenure at that team, so
  // binding debutYear here would say "ferrari since 2007" and be plainly wrong.
  'team-since': String(currentEra.from),
  // Placeholder until the calendar feed lands. Named honestly rather than
  // filled with a plausible-looking circuit that would read as real.
  'race-name': 'TBC',
};

for (const [key, value] of Object.entries(bindings)) {
  for (const el of document.querySelectorAll(`[data-bind="${key}"]`)) {
    el.textContent = value;
  }
}

/* ------------------------------------------------------------------ *
 * Stat band
 * ------------------------------------------------------------------ */

interface StatDef {
  label: string;
  value: number;
  hero?: boolean;
}

const stats: StatDef[] = [
  { label: 'Championships', value: careerTotals.championships, hero: true },
  { label: 'Wins', value: careerTotals.wins },
  { label: 'Poles', value: careerTotals.poles },
  { label: 'Podiums', value: careerTotals.podiums },
  { label: 'Starts', value: careerTotals.starts },
];

/** Build an element with text content set safely. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const statsGrid = document.querySelector<HTMLUListElement>('#stats-grid');
if (statsGrid) {
  // Built through the DOM rather than innerHTML. These values are static today,
  // but careerTotals is slated to come from a live API — and the moment it does,
  // a template string here becomes an injection sink.
  for (const s of stats) {
    const item = el('li', s.hero ? 'stat stat--hero' : 'stat');
    const value = el('span', 'stat__value', String(reducedMotion ? s.value : 0));
    value.dataset.count = String(s.value);
    item.append(value, el('span', 'stat__label', s.label));
    statsGrid.append(item);
  }
}

/**
 * Career totals are placeholders until the live fetch lands. Say so in the UI
 * rather than rendering zeroes that look like real results — a wrong number
 * presented confidently is worse than an absent one.
 */
const note = document.querySelector<HTMLParagraphElement>('#stats-note');
if (note) {
  note.textContent = careerTotals.verified
    ? `Updated ${new Date(careerTotals.lastUpdated).toLocaleDateString()}`
    : 'Career totals pending live data — championships shown are final.';
}

/* ------------------------------------------------------------------ *
 * Eras
 * ------------------------------------------------------------------ */

const erasList = document.querySelector<HTMLOListElement>('#eras-list');
if (erasList) {
  for (const e of eras) {
    const item = el('li', 'era');
    item.dataset.era = e.id; // drives the --era accent swap in tokens.css
    item.append(
      el('p', 'era__years', `${e.from}–${e.to ?? 'present'}`),
      el('h3', 'era__team', e.team),
      el('p', 'era__blurb', e.blurb),
    );
    erasList.append(item);
  }
}

/* ------------------------------------------------------------------ *
 * Reveal + count-up on scroll into view
 * ------------------------------------------------------------------ */

/** Ease-out count-up driven by rAF rather than a fixed interval, so it tracks
 *  real elapsed time instead of drifting on a busy frame. */
function countUp(el: HTMLElement, duration = 1100): void {
  const target = Number(el.dataset.count ?? 0);
  if (!target) return;
  const start = performance.now();

  const tick = (now: number) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // cubic out, matching --ease-out
    el.textContent = String(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

if (!reducedMotion) {
  const revealer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        revealer.unobserve(entry.target); // reveals fire once
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  for (const el of document.querySelectorAll('.reveal')) revealer.observe(el);

  const counter = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        countUp(entry.target as HTMLElement);
        counter.unobserve(entry.target);
      }
    },
    { threshold: 0.4 },
  );
  for (const el of document.querySelectorAll('[data-count]')) counter.observe(el);
}

/* ------------------------------------------------------------------ *
 * Marquee
 *
 * Content comes from the model, not the markup: the years are the seven title
 * seasons and the teams are the three eras, so neither can drift out of sync
 * with the rest of the page.
 * ------------------------------------------------------------------ */

/** How many copies of the phrase each track holds. */
const MARQUEE_COPIES = 4;

const marquee = document.querySelector<HTMLElement>('.marquee');
if (marquee) {
  const rows: Record<string, string[]> = {
    left: championshipYears.map(String),
    right: eras.map((e) => e.team),
  };

  for (const row of marquee.querySelectorAll<HTMLElement>('[data-marquee]')) {
    const words = rows[row.dataset.marquee ?? 'left'] ?? [];
    const track = row.querySelector<HTMLElement>('[data-marquee-track]');
    if (!track || words.length === 0) continue;

    // Several identical copies side by side. Translating the track by -100%
    // then lands copy 2 exactly where copy 1 started, which is the only reason
    // the loop has no visible seam.
    for (let copy = 0; copy < MARQUEE_COPIES; copy++) {
      words.forEach((word, i) => {
        const item = el('span', 'marquee__item', word);
        // Alternate solid and outline so the two rows read as one object.
        if ((copy * words.length + i) % 2 === 1) item.classList.add('is-outline');
        track.append(item, el('span', 'marquee__sep', '/'));
      });
    }
  }

  // The visible rows are aria-hidden because they repeat themselves several
  // times over. This is the copy a screen reader actually gets.
  const marqueeText = document.querySelector<HTMLElement>('#marquee-text');
  if (marqueeText) {
    marqueeText.textContent =
      `World championships in ${rows.left!.join(', ')}. ` +
      `Teams: ${rows.right!.join(', ')}.`;
  }

  if (reducedMotion) {
    // Never released — the tracks stay put and the row scrolls manually.
    marquee.classList.remove('is-running');
  } else {
    const runner = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Toggled both ways: a marquee animating off-screen is work the
          // compositor does for nobody.
          marquee.classList.toggle('is-running', entry.isIntersecting);
        }
      },
      { threshold: 0 },
    );
    runner.observe(marquee);
  }
}

/* ------------------------------------------------------------------ *
 * Hero entrance.
 *
 * Delays are assigned here rather than written into CSS so the order follows
 * the markup: reorder the furniture and the sequence follows, with no stylesheet
 * to keep in sync.
 * ------------------------------------------------------------------ */

const heroFurniture = [...document.querySelectorAll<HTMLElement>('.hero-in')];
heroFurniture.forEach((el, i) => {
  el.style.setProperty('--in-delay', `${i * 110}ms`);
});

let readyFired = false;
const readyCallbacks: (() => void)[] = [];

/** Run once the hero is ready — immediately if that has already happened. */
function onReady(fn: () => void): void {
  if (readyFired) fn();
  else readyCallbacks.push(fn);
}

/** Release the entrance. Called once the scene has painted, or on a timeout. */
function markReady(): void {
  if (readyFired) return;
  readyFired = true;
  document.body.classList.add('is-ready');
  for (const fn of readyCallbacks) fn();
  readyCallbacks.length = 0;
}

// Backstop: if the WebGL scene never reports in — no GL context, a failed
// texture — the hero must still appear. Content is never gated on an effect.
setTimeout(markReady, 1200);

/* ------------------------------------------------------------------ *
 * Text reveals — the accent bar sweeping across a line.
 *
 * Staggered by document order within the hero so the card reads top to bottom
 * rather than every line firing at once. CSS owns the animation; this only
 * decides when it starts and how long each line waits.
 * ------------------------------------------------------------------ */

if (!reducedMotion) {
  const lines = [...document.querySelectorAll<HTMLElement>('.reveal-text')];
  const delayFor = (el: HTMLElement) => `${lines.indexOf(el) * 90}ms`;

  /**
   * Hero lines fire with the entrance, NOT on intersection.
   *
   * The observer below uses a negative bottom margin so nothing triggers while
   * still at the very edge of the viewport. Inside the hero that is a trap: the
   * card sits at the bottom of a 100dvh section, so its last line starts inside
   * that dead band and there is no scroll position that ever moves it out. The
   * line stayed at opacity 0 permanently — content lost to an animation that
   * never ran.
   */
  const heroLines = lines.filter((el) => el.closest('.hero'));
  const scrollLines = lines.filter((el) => !el.closest('.hero'));

  for (const line of heroLines) line.style.setProperty('--reveal-delay', delayFor(line));
  onReady(() => {
    for (const line of heroLines) line.classList.add('is-in');
  });

  const textRevealer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        el.style.setProperty('--reveal-delay', delayFor(el));
        el.classList.add('is-in');
        textRevealer.unobserve(el);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const line of scrollLines) textRevealer.observe(line);
}

/* ------------------------------------------------------------------ *
 * Circuit outline — drawn on rather than faded in.
 * ------------------------------------------------------------------ */

const circuit = document.querySelector<SVGPathElement>('.next-race__circuit path');
if (circuit) {
  // Measured from the path itself. Hardcoding a length silently breaks the
  // animation the moment the outline is redrawn for a different circuit.
  const length = circuit.getTotalLength();
  circuit.style.strokeDasharray = String(length);

  if (reducedMotion) {
    circuit.style.strokeDashoffset = '0';
  } else {
    circuit.style.strokeDashoffset = String(length);
    const drawer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          circuit.style.strokeDashoffset = '0';
          drawer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    drawer.observe(circuit);
  }
}

/* ------------------------------------------------------------------ *
 * Cursor — a ring that trails the pointer and swells over targets.
 *
 * Skipped entirely without a fine pointer or with reduced motion: the ring is
 * decorative, and the native cursor is the correct fallback in both cases.
 * ------------------------------------------------------------------ */

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

if (finePointer && !reducedMotion) {
  const ring = document.createElement('div');
  ring.className = 'cursor';
  ring.setAttribute('aria-hidden', 'true');
  const dot = document.createElement('span');
  dot.className = 'cursor__dot';
  ring.append(dot);
  document.body.append(ring);

  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let started = false;

  window.addEventListener(
    'pointermove',
    (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!started) {
        // Jump to the first known position instead of gliding in from 0,0.
        x = targetX;
        y = targetY;
        started = true;
        ring.classList.add('is-active');
      }
      // Swell over anything clickable. Checked on move rather than with
      // per-element listeners so it covers content added later for free.
      const el = e.target as Element | null;
      ring.classList.toggle('is-hovering', Boolean(el?.closest('a, button')));
    },
    { passive: true },
  );

  // The ring must not linger over a window it has left.
  document.addEventListener('pointerleave', () => ring.classList.remove('is-active'));
  document.addEventListener('pointerenter', () => ring.classList.add('is-active'));

  const followCursor = () => {
    requestAnimationFrame(followCursor);
    // Lags the true pointer. The trailing ring against the exact dot is what
    // gives the cursor a sense of weight rather than being a second crosshair.
    x += (targetX - x) * 0.16;
    y += (targetY - y) * 0.16;
    // Off the layout path, so not top/left. But specifically the `translate`
    // PROPERTY rather than `transform`, and that distinction is load-bearing.
    //
    // CSS composes the transform family as T · R · S · transform, and a point
    // is mapped right to left — so `transform` applies FIRST and the standalone
    // `scale` from .is-hovering applies after it. Written into `transform`, the
    // hover scale multiplied the translation itself: the negative margins that
    // centre the ring put its transform-origin at viewport 0,0, so hovering the
    // STORE pill at x 765 threw the ring to 765 * 1.75 = 1339, clean off a
    // 950px viewport. It only ever misbehaved in the far corner because the
    // error is proportional to distance from that origin.
    //
    // Writing to `translate` puts the scale INSIDE the translation instead, so
    // the ring swells about its own centre and is then moved into place.
    ring.style.translate = `${x}px ${y}px`;
  };
  requestAnimationFrame(followCursor);
}

/* ------------------------------------------------------------------ *
 * Monogram
 *
 * The reference drives this slot with a Rive animation. This is the SVG + GSAP
 * equivalent: the mark is filled by one gradient spanning the whole viewBox in
 * user space, and activating it raises the boundary between the two stops from
 * the bottom of the glyph to the top. Because the gradient is shared across all
 * three paths, that reads as a single level rising through the mark rather than
 * three shapes changing colour together — which is the difference between a
 * liquid fill and a hover state.
 * ------------------------------------------------------------------ */

function mountMonogram(): void {
  const root = document.querySelector<HTMLAnchorElement>('.monogram');
  const fill = document.querySelector<SVGStopElement>('.monogram__stop-fill');
  const base = document.querySelector<SVGStopElement>('.monogram__stop-base');
  if (!root || !fill || !base) return;

  // The two stops sit a constant distance apart; that gap is the meniscus, so
  // it travels with the level rather than being animated separately.
  const GAP = 0.05;
  const state = { level: 0 };

  const apply = () => {
    fill.setAttribute('offset', String(state.level));
    base.setAttribute('offset', String(state.level + GAP));
  };
  apply();

  const to = (level: number, active: boolean) => {
    gsap.killTweensOf(state);
    if (reducedMotion) {
      // No travel, but the state change still has to be perceivable — snap the
      // level past the glyph so the colour flips outright.
      state.level = level;
      apply();
      return;
    }
    gsap.to(state, {
      level,
      // Filling is the expressive direction, so it gets the longer, softer
      // curve; draining is quicker and plainer, the way liquid actually falls
      // back faster than it climbs.
      duration: active ? 0.62 : 0.38,
      ease: active ? 'power3.out' : 'power2.in',
      onUpdate: apply,
    });
  };

  // Pointer and keyboard both count as activation. A monogram that only
  // responds to a mouse is invisible to anyone tabbing through the nav.
  root.addEventListener('pointerenter', () => to(1 + GAP, true));
  root.addEventListener('pointerleave', () => to(0, false));
  root.addEventListener('focus', () => to(1 + GAP, true));
  root.addEventListener('blur', () => to(0, false));
}

mountMonogram();

/* ------------------------------------------------------------------ *
 * Rolling button text
 *
 * Reverse-engineered off the reference's own STORE button rather than guessed.
 * Its label lives in a wrapper with `overflow: clip` exactly one line tall,
 * holding one `<span class="char">` per letter at `display: inline-block`. On
 * hover each char animates transform translateY(0 -> -100%), staggered left to
 * right: sampled mid-tween the offsets read -20.77, -20.38, -19.91, -19.34,
 * -18.67px, so the first letter leads and each one after trails a little. It
 * settles at exactly -100% of the line box.
 *
 * The split happens here rather than in the markup so the HTML keeps a plain,
 * readable label and the accessible name stays a single text node — a screen
 * reader announcing five separate character nodes is not a label, which is why
 * the visible copy is aria-hidden and an sr-only twin carries the real name.
 * ------------------------------------------------------------------ */

function mountRollingText(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-split-chars]');

  for (const el of targets) {
    const label = el.textContent ?? '';
    if (!label) continue;

    const buildLine = (modifier: string) => {
      const line = document.createElement('span');
      line.className = `btn-text__line${modifier}`;
      for (const ch of label) {
        const span = document.createElement('span');
        span.className = 'char';
        // Non-breaking space, so a gap between words survives becoming its own
        // inline-block.
        span.textContent = ch === ' ' ? ' ' : ch;
        line.appendChild(span);
      }
      return line;
    };

    const outgoing = buildLine('');
    const incoming = buildLine(' btn-text__line--in');
    el.textContent = '';
    el.append(outgoing, incoming);

    const outChars = [...outgoing.children] as HTMLElement[];
    const inChars = [...incoming.children] as HTMLElement[];

    // The button, not the label, owns the hover — the label is inline and its
    // box does not cover the padding the user is actually pointing at.
    const button = el.closest<HTMLElement>('a, button') ?? el;

    if (reducedMotion) {
      // No roll. The incoming copy would otherwise sit permanently below the
      // clip, so drop it and leave a plain static label.
      incoming.remove();
      continue;
    }

    gsap.set(inChars, { yPercent: 0 });

    const roll = (active: boolean) => {
      gsap.killTweensOf([...outChars, ...inChars]);
      const opts = {
        duration: 0.75,
        /* expo.out, NOT the site's cubic-bezier(0.65, 0.05, 0, 1).
         *
         * Passing that string to GSAP does nothing useful — parsing a raw
         * cubic-bezier needs the CustomEase plugin, so it silently falls back
         * to the default power1.out. That was measurable rather than
         * theoretical: at 260ms our first char sat at 56.5% of travel and
         * 1-(1-0.347)^2 is 57.4%, which is exactly power1.out. The reference
         * was at 94% by the same moment. expo.out gives ~91% there, so it
         * tracks the real curve closely without pulling in a plugin. */
        ease: 'expo.out',
        /* Solved for, not picked. Normalised against total travel, the
         * reference's spread across five letters is 9.5%. 24ms gave 18.5% and
         * 12ms gave 5.3%, so interpolating between the two measured points
         * lands here. */
        stagger: 0.016,
      };
      gsap.to(outChars, { ...opts, yPercent: active ? -100 : 0 });
      gsap.to(inChars, { ...opts, yPercent: active ? -100 : 0 });
    };

    button.addEventListener('pointerenter', () => roll(true));
    button.addEventListener('pointerleave', () => roll(false));
    button.addEventListener('focus', () => roll(true));
    button.addEventListener('blur', () => roll(false));
  }
}

mountRollingText();

/* ------------------------------------------------------------------ *
 * Menu button
 *
 * The reference drives this slot with a Rive state machine, which we cannot
 * reproduce, so it is rebuilt as SVG paths morphed by GSAP. Its resting
 * geometry is measured off the reference's artboard rather than guessed: a 66px
 * icon inside an 80px target, two ~16.3-unit bars at y 29.2 and 38.8, staggered
 * +/-6.05 either side of centre. The bars are EQUAL LENGTH and offset
 * horizontally — an earlier pass here had them as unequal lengths, which is
 * what it looks like at a glance but is not what the artboard does.
 *
 * Opening runs each bar through three states: line -> lobe -> diagonal. The two
 * lobes meet at the centre and together read as an infinity symbol, so the
 * button passes through a recognisable shape on its way to the X instead of
 * just rotating into it.
 *
 * All three states are generated below as FOUR CUBIC SEGMENTS, always. That is
 * the load-bearing detail: MorphSVGPlugin maps anchor i of one path to anchor i
 * of the next, so giving every state the same command structure makes the
 * correspondence something we choose rather than something the plugin guesses.
 * A hand-drawn loop with a different number of segments would still morph, but
 * which part of the bar becomes which part of the loop would be luck.
 * ------------------------------------------------------------------ */

gsap.registerPlugin(MorphSVGPlugin);

/** Handle length for a 90-degree elliptical arc: 4/3 * tan(pi/8). */
const ARC_K = 0.5522847498307936;

/** Every generated path uses this many cubic segments. See the note above. */
const PATH_SEGMENTS = 4;

interface Pt {
  x: number;
  y: number;
}

/** An anchor with its two absolute control handles. */
interface PathNode {
  p: Pt;
  in: Pt;
  out: Pt;
}

/* The whole icon's shape, in the 66-unit viewBox. These are the numbers to turn
   while tuning: everything else is derived from them. */
const MENU_ICON = {
  box: 66,
  /** Mean of the reference's two measured bars (15.9 and 16.7). */
  barLength: 16.3,
  /** Horizontal offset of each bar from centre; the reference's is +/-6.05. */
  barStagger: 6.05,
  /** Measured bar centres. */
  barY: [29.2, 38.8],
  /** Lobe radii. rx sets how far the infinity reaches; ry how fat it is. */
  loopRx: 8.2,
  loopRy: 7,
  /** Half-extent of the X along each axis, so each arm is this * sqrt(2) long. */
  crossReach: 7.6,
} as const;

function emitPath(nodes: PathNode[]): string {
  const round = (v: number) => (Math.round(v * 100) / 100).toString();
  const head = nodes[0];
  if (!head) throw new Error('emitPath: no nodes');

  let d = `M${round(head.p.x)} ${round(head.p.y)}`;
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const cur = nodes[i];
    if (!prev || !cur) throw new Error('emitPath: sparse nodes');
    d +=
      `C${round(prev.out.x)} ${round(prev.out.y)}` +
      ` ${round(cur.in.x)} ${round(cur.in.y)}` +
      ` ${round(cur.p.x)} ${round(cur.p.y)}`;
  }
  return d;
}

/** A straight line, but spent across PATH_SEGMENTS cubics so it can morph. */
function lineNodes(a: Pt, b: Pt): PathNode[] {
  // A cubic is straight when its handles lie a third of the way along it.
  const h: Pt = { x: (b.x - a.x) / PATH_SEGMENTS / 3, y: (b.y - a.y) / PATH_SEGMENTS / 3 };
  return Array.from({ length: PATH_SEGMENTS + 1 }, (_, i) => {
    const t = i / PATH_SEGMENTS;
    const p: Pt = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    return { p, in: { x: p.x - h.x, y: p.y - h.y }, out: { x: p.x + h.x, y: p.y + h.y } };
  });
}

/**
 * A full ellipse as four cubics, starting at `fromDeg` and travelling in
 * `sweep`. The handles are the parametric tangent scaled by ARC_K, which is the
 * standard four-arc circle approximation — accurate to about one part in 4000,
 * far finer than a 66px icon can show.
 */
function ellipseNodes(c: Pt, rx: number, ry: number, fromDeg: number, sweep: 1 | -1): PathNode[] {
  return Array.from({ length: PATH_SEGMENTS + 1 }, (_, i) => {
    const a = ((fromDeg + sweep * 90 * i) * Math.PI) / 180;
    const p: Pt = { x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) };
    const h: Pt = {
      x: -rx * Math.sin(a) * sweep * ARC_K,
      y: ry * Math.cos(a) * sweep * ARC_K,
    };
    return { p, in: { x: p.x - h.x, y: p.y - h.y }, out: { x: p.x + h.x, y: p.y + h.y } };
  });
}

/** The three states, as [bar1, bar2] pairs. */
function menuIconPaths(): { idle: [string, string]; loop: [string, string]; cross: [string, string] } {
  const { box, barLength, barStagger, barY, loopRx, loopRy, crossReach } = MENU_ICON;
  const c = box / 2;
  const half = barLength / 2;

  const bar = (index: 0 | 1): string => {
    const xc = c + (index === 0 ? barStagger : -barStagger);
    const y = barY[index];
    return emitPath(lineNodes({ x: xc - half, y }, { x: xc + half, y }));
  };

  // Both lobes start at the centre. Bar 1 takes the left one and leaves heading
  // up; bar 2 takes the right and leaves heading down. That opposition is what
  // makes the strokes cross in the middle and read as one infinity symbol
  // rather than two circles sitting side by side.
  const loop: [string, string] = [
    emitPath(ellipseNodes({ x: c - loopRx, y: c }, loopRx, loopRy, 0, -1)),
    emitPath(ellipseNodes({ x: c + loopRx, y: c }, loopRx, loopRy, 180, -1)),
  ];

  const cross: [string, string] = [
    emitPath(
      lineNodes({ x: c - crossReach, y: c - crossReach }, { x: c + crossReach, y: c + crossReach }),
    ),
    emitPath(
      lineNodes({ x: c + crossReach, y: c - crossReach }, { x: c - crossReach, y: c + crossReach }),
    ),
  ];

  return { idle: [bar(0), bar(1)], loop, cross };
}

interface MenuIcon {
  setOpen(open: boolean): void;
}

function mountMenuButton(): MenuIcon | null {
  const btn = document.querySelector<HTMLButtonElement>('.menu-btn');
  const bar1 = document.querySelector<SVGPathElement>('[data-menu-bar="1"]');
  const bar2 = document.querySelector<SVGPathElement>('[data-menu-bar="2"]');
  if (!btn || !bar1 || !bar2) return null;

  const { idle, loop, cross } = menuIconPaths();

  // Write the generated idle state over the markup's fallback, so the morph's
  // starting point is bit-identical to what the generator produces. Hand-copied
  // path data in the HTML would drift the moment MENU_ICON is tuned.
  bar1.setAttribute('d', idle[0]);
  bar2.setAttribute('d', idle[1]);

  /* Two timelines, and they cannot conflict — not by careful sequencing, but
     because they write disjoint properties. Hover owns --menu-hover; open/close
     owns --menu-open and the path data. Neither writes a colour: home.css
     composes both scalars into every colour on the button. So hovering an
     already-open button, or opening an already-hovered one, simply moves the
     other axis. Nothing has to be reconciled. */

  const hover = gsap.timeline({ paused: true }).to(btn, {
    '--menu-hover': 1,
    duration: reducedMotion ? 0.001 : 0.36,
    ease: 'power2.out',
  });

  const toggle = gsap.timeline({ paused: true });

  if (reducedMotion) {
    // The loop is pure flourish, so it goes first. The state change itself must
    // still happen — the X is information, not decoration.
    toggle
      .to(bar1, { morphSVG: cross[0], duration: 0.001 }, 0)
      .to(bar2, { morphSVG: cross[1], duration: 0.001 }, 0)
      .to(btn, { '--menu-open': 1, duration: 0.001 }, 0);
  } else {
    const STAGE = 0.52;
    toggle
      // Line -> lobe. `power2.in` leaves the bars slowly and arrives fast, so
      // the loop snaps into being rather than easing into a mush.
      .to(bar1, { morphSVG: loop[0], duration: STAGE, ease: 'power2.in' }, 0)
      .to(bar2, { morphSVG: loop[1], duration: STAGE, ease: 'power2.in' }, 0)
      // Lobe -> diagonal. `power2.out` mirrors it, and the in/out seam at the
      // midpoint gives the infinity a beat of hang time before it collapses.
      .to(bar1, { morphSVG: cross[0], duration: STAGE, ease: 'power2.out' }, STAGE)
      .to(bar2, { morphSVG: cross[1], duration: STAGE, ease: 'power2.out' }, STAGE)
      // Colour spans the WHOLE morph at a linear rate, not one stage of it, so
      // the mark is exactly half-way between the two house colours at the same
      // instant it is a full infinity symbol. Running it as its own tween would
      // let the two drift apart under any easing change.
      .to(btn, { '--menu-open': 1, duration: STAGE * 2, ease: 'none' }, 0);
  }

  const setHover = (on: boolean) => {
    if (on) hover.play();
    else hover.reverse();
  };

  // Keyboard focus counts as hover. A control that only lights up for a mouse
  // is invisible to anyone tabbing the nav.
  btn.addEventListener('pointerenter', () => setHover(true));
  btn.addEventListener('pointerleave', () => setHover(false));
  btn.addEventListener('focus', () => setHover(true));
  btn.addEventListener('blur', () => setHover(false));

  return {
    setOpen(open: boolean) {
      // Reversing rather than re-tweening is why this is a paused timeline: a
      // click mid-morph turns around from wherever it actually is, instead of
      // jumping to the end and animating back.
      if (open) toggle.play();
      else toggle.reverse();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Menu
 * ------------------------------------------------------------------ */

const menu = document.querySelector<HTMLDivElement>('#menu');
const menuBtn = document.querySelector<HTMLButtonElement>('.menu-btn');
const menuIcon = mountMenuButton();
const menuLabel = document.querySelector<HTMLSpanElement>('[data-menu-label]');

if (menu && menuBtn) {
  const setOpen = (open: boolean) => {
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuIcon?.setOpen(open);
    // The icon is aria-hidden, so the accessible name is the only thing telling
    // a screen reader what the button will do next. It has to track the state.
    if (menuLabel) menuLabel.textContent = open ? 'Close menu' : 'Open menu';
    // Stop the page scrolling behind an overlay that covers it.
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) menu.querySelector<HTMLAnchorElement>('a')?.focus();
    else menuBtn.focus();
  };

  // `hidden` is `boolean | "until-found"` in the DOM lib, and "until-found" is
  // still hidden, so coerce rather than compare against true.
  menuBtn.addEventListener('click', () => setOpen(Boolean(menu.hidden)));

  // Escape must close it. An overlay with no keyboard exit is a trap.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) setOpen(false);
  });
}

/* ------------------------------------------------------------------ *
 * Hero WebGL scene
 * ------------------------------------------------------------------ */

const stage = document.querySelector<HTMLDivElement>('#stage');

if (stage) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  stage.appendChild(renderer.domElement);

  // Sized so the top of his head sits just under the monogram, which is where
  // the reference puts its subject: measured on the running reference at
  // 1908x926, its monogram ends at y=79 and the hair starts at ~y=110. The
  // portrait is bottom-anchored, so scale is what drives the top edge up.
  const head = new HeadScene(renderer, { subjectScale: 0.88 });

  const resize = () => {
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    head.resize();
  };
  window.addEventListener('resize', resize);

  // "Tap to lock" freezes the reveal where it is, so the composition can be
  // read without the cursor dragging it around.
  let locked = false;
  const lockBtn = document.querySelector<HTMLButtonElement>('#lock-btn');
  lockBtn?.addEventListener('click', () => {
    locked = !locked;
    lockBtn.setAttribute('aria-pressed', String(locked));
  });

  window.addEventListener(
    'pointermove',
    (e) => {
      if (locked) return;
      // -1..1, y flipped: screen y grows downward, the shader assumes y up.
      head.setPointer(
        (e.clientX / window.innerWidth) * 2 - 1,
        -((e.clientY / window.innerHeight) * 2 - 1),
      );
    },
    { passive: true },
  );

  // Live handle on the scene, the way the reference exposes window.landoGL.
  // Tuning the helmet's fit by eye and re-editing source each time is slow and
  // error-prone; being able to read and set values from the console makes it
  // measurable. Costs nothing, and doubles as the modding surface.
  (window as unknown as Record<string, unknown>).hamiltonGL = { head, renderer };

  const frame = () => {
    requestAnimationFrame(frame);
    head.update();
    renderer.render(head.scene, head.camera);
  };

  head
    .load()
    .then(() => {
      resize();
      frame();
      // The scene has painted, so the furniture can settle in around it.
      markReady();
      // Helmet is ~11 MB, so it loads after the hero is already interactive
      // and never blocks it. If it fails the scene is still complete enough to
      // ship — log it, don't take the page down with it.
      return head.loadHelmet().catch((err: unknown) => {
        console.error('[hero] helmet failed to load', err);
      });
    })
    .catch((err: unknown) => {
      // The page is fully readable without the canvas, so fail quietly for the
      // visitor and loudly for us.
      console.error('[hero] scene failed to load', err);
      stage.remove();
    });
}
