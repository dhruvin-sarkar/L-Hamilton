import './styles/main.css';
import * as THREE from 'three';
import { HeadScene } from './HeadScene';
import { age, careerTotals, driver, eras, seasonsRacing } from './content/hamilton';

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
 * Hero WebGL scene
 * ------------------------------------------------------------------ */

const stage = document.querySelector<HTMLDivElement>('#stage');

if (stage) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  stage.appendChild(renderer.domElement);

  const head = new HeadScene();

  const resize = () => {
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    head.resize();
  };
  window.addEventListener('resize', resize);

  const hint = document.querySelector<HTMLParagraphElement>('#hero-hint');
  window.addEventListener(
    'pointermove',
    (e) => {
      // -1..1, y flipped: screen y grows downward, the shader assumes y up.
      head.setPointer(
        (e.clientX / window.innerWidth) * 2 - 1,
        -((e.clientY / window.innerHeight) * 2 - 1),
      );
      if (hint) hint.hidden = true;
    },
    { passive: true },
  );

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
    })
    .catch((err: unknown) => {
      // The page is fully readable without the canvas, so fail quietly for the
      // visitor and loudly for us.
      console.error('[hero] scene failed to load', err);
      stage.remove();
    });
}
