import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/* The data layer, imported for two reasons. First its side effect: it
   validates career.json and the stable content against it the moment it loads,
   and throws on anything missing or malformed. Loaded only by the pages, that
   check ran in the browser — a record with a required field deleted built
   cleanly and failed at runtime. Loaded here too, it runs when this config
   does, so `vite build` stops and the dev server refuses to start (or restart,
   when the file changes) on a bad record. CLAUDE.md: validation that fails the
   build. Second, its values: the facts each page's <head> states are filled in
   from it below (see HEAD_TOKENS), because a title and a meta description are
   read by crawlers and link previews that never run the page's script. */
import { driver } from './src/content/hamilton';
import { calendar, career } from './src/content/live-stats';
import { spell } from './src/lib/schedule';

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

/* The season the site is about: the calendar's, which is how the Calendar and
   On Track pages read it. The data layer already refuses an empty calendar;
   this only narrows the type. */
const currentSeason = calendar[0]?.season;
if (currentSeason === undefined) throw new Error('[head] the season calendar is empty');

/**
 * `%%name%%` in any HTML entry: a fact from the data layer, written into the
 * served document.
 *
 * For the <head>. A title and a meta description state the season, his team,
 * his title count and how many seasons he has raced, and they are read by
 * crawlers and link previews that run no script — a data-bind there would reach
 * them empty, and a typed number goes stale on a championship Sunday. So they
 * are filled here, at build time and on every dev request, from the same
 * values the pages bind in their bodies (main.ts, on-track.ts). Figures inside
 * a sentence are spelled, as the pages spell them.
 *
 * Every token must be one of these; anything else stops the build.
 */
const HEAD_TOKENS: ReadonlyMap<string, string> = new Map([
  ['season', String(currentSeason)],
  ['team', driver.currentTeam],
  ['titles-word', spell(career.championships)],
  ['seasons-word', spell(career.seasonsContested)],
]);

function fillTokens(html: string, filename: string): string {
  const filled = html.replace(/%%(.*?)%%/g, (_match, name: string) => {
    const value = HEAD_TOKENS.get(name);
    if (value === undefined) throw new Error(`${filename}: unknown token %%${name}%%`);
    if (value.trim() === '') throw new Error(`${filename}: token %%${name}%% is empty`);
    return value;
  });
  if (filled.includes('%%')) throw new Error(`${filename}: an unclosed %% token is left in the page`);
  return filled;
}

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
 *
 * The same pass then fills the `%%name%%` tokens (HEAD_TOKENS above), after
 * the includes so a partial could carry one too.
 */
function htmlPartials(): Plugin {
  const DIRECTIVE = /<!--#include\s+"([^"]+)"\s*-->/g;

  return {
    name: 'html-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const included = html.replace(DIRECTIVE, (_match, relative: string) => {
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
        return fillTokens(included, ctx.filename);
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

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [htmlPartials()],
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
