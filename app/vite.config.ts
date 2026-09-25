import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [htmlPartials()],
  server: { port: 5173, open: false },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: path.resolve(here, 'index.html'),
        'on-track': path.resolve(here, 'on-track.html'),
        'off-track': path.resolve(here, 'off-track.html'),
      },
    },
  },
});
