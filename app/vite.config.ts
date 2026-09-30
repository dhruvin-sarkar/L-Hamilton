import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { bandCopy, bandsSpoken, isHeroBand } from './src/content/home';

/* The data layer, imported for its side effect: it validates career.json and
   the stable content against it the moment it loads, and throws on anything
   missing or malformed. Loaded only by the pages, that check ran in the
   browser — a record with a required field deleted built cleanly and failed at
   runtime. Loaded here too, it runs when this config does, so `vite build`
   stops and the dev server refuses to start (or restart, when the file
   changes) on a bad record. CLAUDE.md: validation that fails the build. */
import './src/content/hamilton';

// `import.meta.url` rather than `__dirname`: this package is ESM ("type":
// "module"), where __dirname does not exist and would be undefined at runtime.
//
// There used to be a dev-only middleware here that fell back to the reference
// build's assets under ../public for any /assets/ request app/public did not
// answer. Every one of the 44 assets this app references now resolves locally,
// so it was catching nothing — and what it would have caught is upstream
// copyrighted material, silently served in dev and passing for ours. Gone, so
// a missing asset 404s loudly instead.
const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * `<!--#include "partials/nav.html"-->` in any HTML entry, resolved before Vite
 * parses the document.
 *
 * The nav, the menu overlay and the footer are identical on all four pages and
 * the reference serves them from one template. Copying them into each entry
 * would mean four copies drifting apart — and they are not inert markup: the
 * nav's SVG defs are referenced by `<use>` from the hero, and main.ts queries
 * both by class. One source, included at parse time, keeps the markup
 * hand-authored and commented while making drift impossible.
 *
 * Runs at `order: 'pre'` so the injected markup is indistinguishable from
 * literal document content to every later transform — asset URLs inside a
 * partial are rewritten and hashed exactly as if they had been typed inline.
 */
function htmlPartials(): Plugin {
  const DIRECTIVE = /<!--#include\s+"([^"]+)"\s*-->/g;

  return {
    name: 'html-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        return html.replace(DIRECTIVE, (_match, relative: string) => {
          const file = path.resolve(here, relative);
          // Confine includes to the project. A path escaping `here` is either a
          // mistake or a traversal, and both should stop the build.
          if (!file.startsWith(here)) {
            throw new Error(`include "${relative}" resolves outside the project root`);
          }
          try {
            return readFileSync(file, 'utf8').replace(/\s+$/, '');
          } catch {
            throw new Error(`${ctx.filename}: cannot read included partial "${relative}"`);
          }
        });
      },
    },
    /**
     * Editing a partial has to reload the pages that include it. Vite watches
     * modules, and a partial is not one — without this the dev server sits
     * there showing stale chrome.
     */
    handleHotUpdate({ file, server }) {
      if (file.startsWith(path.join(here, 'partials'))) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
      return undefined;
    },
  };
}

/** Text for an HTML text node. */
const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * `<!--#marquee "left"-->` and `<!--#marquee-spoken-->` in an HTML entry, set
 * from src/content/home.ts.
 *
 * The hero's bands are the largest text on Home's first screen, so they are its
 * LCP element. Built by main.ts they could not paint until the whole module
 * graph had downloaded and run -- 6.3s on a throttled phone, against a 2.5s
 * budget. Set here they are in the served document and paint with it; the page
 * script only adds the repeat copies the loop needs, which it has to measure.
 *
 * The copy stays in the content module rather than in the markup, so there is
 * one source for the bands and for what a screen reader is told they say. An
 * unknown band name stops the build.
 */
function heroMarquee(): Plugin {
  const BAND = /<!--#marquee\s+"([^"]+)"\s*-->/g;
  const SPOKEN = /<!--#marquee-spoken\s*-->/g;

  return {
    name: 'hero-marquee',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        return html
          .replace(BAND, (_match, band: string) => {
            if (!isHeroBand(band)) {
              throw new Error(`${ctx.filename}: no marquee band called "${band}" in src/content/home.ts`);
            }
            return `<span class="marquee__item">${escapeHtml(bandCopy(band))}</span>`;
          })
          .replace(SPOKEN, () => escapeHtml(bandsSpoken()));
      },
    },
  };
}

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [htmlPartials(), heroMarquee()],
  server: { port: 5173, open: false },
  /* The dependency cache lives beside this config, not in node_modules. Every
     worktree links app/node_modules to one shared install, so the default
     node_modules/.vite put every dev server on ONE cache directory: they
     clobbered each other's optimised deps (504 "Outdated Optimize Dep", mixed
     ?v= hashes, duplicate three) and Windows refused the rename a re-optimise
     needs while another server held the folder open (EPERM). app/.vite/ is
     already gitignored. */
  cacheDir: path.resolve(here, '.vite'),
  /* Pre-bundle three and every addon we import in ONE pass. Left to runtime
     discovery, the addons (first reached through HelmetModel's lazy import)
     were optimised in a later pass than three itself, each carrying its own
     copy of it — the dev console's "Multiple instances of Three.js" warning,
     and two WebGL state caches that do not know about each other. Dev-only:
     the production build resolves a single three through Rollup. */
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/loaders/DRACOLoader.js',
      'three/examples/jsm/environments/RoomEnvironment.js',
      'three/examples/jsm/utils/BufferGeometryUtils.js',
      'three/examples/jsm/controls/OrbitControls.js',
      'three/examples/jsm/postprocessing/EffectComposer.js',
      'three/examples/jsm/postprocessing/RenderPass.js',
      'three/examples/jsm/postprocessing/UnrealBloomPass.js',
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: path.resolve(here, 'index.html'),
        'on-track': path.resolve(here, 'on-track.html'),
        'off-track': path.resolve(here, 'off-track.html'),
        calendar: path.resolve(here, 'calendar.html'),
      },
    },
  },
});
