import './styles/main.css';
import * as THREE from 'three';
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
    // translate, not top/left: this runs every frame and must stay off the
    // layout path.
    ring.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };
  requestAnimationFrame(followCursor);
}

/* ------------------------------------------------------------------ *
 * Menu
 * ------------------------------------------------------------------ */

const menu = document.querySelector<HTMLDivElement>('#menu');
const menuBtn = document.querySelector<HTMLButtonElement>('.menu-btn');

if (menu && menuBtn) {
  const setOpen = (open: boolean) => {
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
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
