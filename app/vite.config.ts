import { defineConfig, type Plugin } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { bandCopy, bandsSpoken, isHeroBand } from './src/content/home';

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
import { roundPhoto } from './src/content/calendar-media';
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

/* Every round's picture, checked to be there. roundPhoto() only formats a path
   from a round's season and number, and the Calendar page sets it as an image
   source at runtime, so nothing noticed a file that was not there: the day
   fetch-stats rolls the calendar into a new season, or a round is added, the
   card shows a dark empty frame and the build still passes. Checked here with
   the rest of the data layer, so it stops the build and the dev server
   instead. */
const missingPhotos = calendar.map(roundPhoto).filter((photo) => !existsSync(path.join(here, 'public', photo)));
if (missingPhotos.length > 0) {
  throw new Error(
    `[calendar] ${missingPhotos.length} of ${calendar.length} rounds have no picture in public: ` +
      `${missingPhotos.join(', ')}. Make them with: python tools/gen-calendar-placeholders.py`,
  );
}

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
 * a sentence are spelled, as the pages spell them. The Calendar's hidden
 * schedule heading reads `season` too, so its outline names the year before
 * any script runs, and so does the footer's copyright line (partials/
 * footer.html), which would otherwise be a year typed by hand.
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
 * the includes so a partial can carry one too, as the footer does.
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

/** The share card, as a path under public/ and so as a URL on the site. Made by
    tools/gen-brand-images.py. */
const SHARE_CARD = '/assets/brand/share-card.png';
const SHARE_CARD_ALT = 'The LH monogram above the name Lewis Hamilton, on Rosso Corsa red.';

/** The tab icon's two PNG copies, drawn by the same tool from the icon itself,
    brand/lh-monogram.svg. */
const ICON_PNG = '/assets/brand/favicon-32.png';
const TOUCH_ICON = '/assets/brand/apple-touch-icon.png';

/**
 * The origin the site is served from, such as https://example.com, read from
 * the SITE_ORIGIN environment variable.
 *
 * It is needed for one thing, the share image's address. A scraper does not
 * resolve og:image against the page it found it on, so the address has to be
 * absolute, and nothing in this repository records where the site will live.
 * It is not guessed here. Unset, the address stays root-relative and the build
 * says so (headTags, below).
 */
function siteOrigin(): string | undefined {
  const value = process.env.SITE_ORIGIN?.trim();
  if (value === undefined || value === '') return undefined;
  const expected = `SITE_ORIGIN is "${value}"; expected an origin with nothing after it, such as https://example.com`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(expected);
  }
  const web = url.protocol === 'https:' || url.protocol === 'http:';
  if (!web || url.pathname !== '/' || url.search !== '' || url.hash !== '') throw new Error(expected);
  return url.origin;
}

/** The pixel size of a PNG under public/, from its header. A missing file or
    one that is not a PNG stops the build, naming the tool that makes it. */
function pngSize(publicPath: string): { width: number; height: number } {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(here, 'public', publicPath));
  } catch {
    throw new Error(`[head] public${publicPath} is missing; run tools/gen-brand-images.py`);
  }
  // The 8-byte signature, then the IHDR chunk: its length, its name, and the
  // width and height as big-endian 32-bit integers.
  if (bytes.toString('latin1', 1, 4) !== 'PNG' || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error(`[head] public${publicPath} is not a PNG`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The one match of `pattern` in a page's head. None, or two, stops the build. */
function only(head: string, pattern: RegExp, what: string, filename: string): RegExpExecArray {
  const found = [...head.matchAll(pattern)];
  const [match] = found;
  if (match === undefined || found.length !== 1) {
    throw new Error(`${filename}: expected one ${what} in the head, found ${found.length}`);
  }
  return match;
}

/**
 * The tags a link preview is drawn from, written from each page's own <title>
 * and meta description.
 *
 * Paste a link into a message or a post and the card that appears is built
 * from the page's og: and twitter: tags, by a scraper that runs no script. The
 * pages had none, so a shared link was a bare address. They are derived here
 * rather than typed into four heads so each page has one title and one
 * description: change either and its card follows.
 *
 * Both are read as the page wrote them, entities included, which is already
 * the encoding an attribute value takes; only a double quote in a title needs
 * escaping. The title's tokens are filled by htmlPartials, so this has to run
 * after it: the order of the plugins below.
 *
 * The tab icon's PNG copies are named here as well, for the same reason: one
 * place rather than four heads. Each page's own <link rel="icon"> names the
 * SVG, which is the icon wherever SVG icons are drawn. Ahead of it go the 32px
 * PNG, with its size stated, for a browser that does not draw them, and the
 * touch icon a phone uses for a home-screen shortcut. Without those two such a
 * browser fell back to asking for /favicon.ico, which does not exist.
 *
 * Dev and build alike, so the head view-source shows in dev is the one that
 * ships.
 */
function headTags(): Plugin {
  const origin = siteOrigin();
  const card = pngSize(SHARE_CARD);
  const icon = pngSize(ICON_PNG);
  const touchIcon = pngSize(TOUCH_ICON);
  const image = (origin ?? '') + SHARE_CARD;
  const TITLE = /^([ \t]*)<title>([\s\S]*?)<\/title>/gim;
  const DESCRIPTION = /<meta\s+name="description"\s+content="([^"]*)"\s*\/?>/gi;

  return {
    name: 'head-tags',
    configResolved(config) {
      if (config.command === 'build' && origin === undefined) {
        config.logger.warn(
          `\n[head] SITE_ORIGIN is not set, so og:image and twitter:image are written as ${SHARE_CARD}.\n` +
            `       Link previews need an absolute address and will show no picture. Before publishing,\n` +
            `       build with the site's origin: SITE_ORIGIN=https://<host> npm run build\n`,
        );
      }
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const headEnd = html.indexOf('</head>');
        if (headEnd < 0) throw new Error(`${ctx.filename}: no </head>`);
        const head = html.slice(0, headEnd);

        const titleTag = only(head, TITLE, '<title>', ctx.filename);
        const indent = titleTag[1] ?? '';
        const title = (titleTag[2] ?? '').replace(/\s+/g, ' ').trim().replace(/"/g, '&quot;');
        const description = (only(head, DESCRIPTION, 'meta description', ctx.filename)[1] ?? '').trim();
        if (title === '' || description === '') {
          throw new Error(`${ctx.filename}: the title or the meta description is empty`);
        }
        if (title.includes('%%') || description.includes('%%')) {
          throw new Error(`${ctx.filename}: head-tags ran before the %% tokens were filled`);
        }

        const tags = [
          `<meta property="og:type" content="website" />`,
          `<meta property="og:title" content="${title}" />`,
          `<meta property="og:description" content="${description}" />`,
          `<meta property="og:image" content="${image}" />`,
          `<meta property="og:image:width" content="${card.width}" />`,
          `<meta property="og:image:height" content="${card.height}" />`,
          `<meta property="og:image:alt" content="${SHARE_CARD_ALT}" />`,
          `<meta name="twitter:card" content="summary_large_image" />`,
          `<meta name="twitter:title" content="${title}" />`,
          `<meta name="twitter:description" content="${description}" />`,
          `<meta name="twitter:image" content="${image}" />`,
          `<meta name="twitter:image:alt" content="${SHARE_CARD_ALT}" />`,
          `<link rel="icon" href="${ICON_PNG}" type="image/png" sizes="${icon.width}x${icon.height}" />`,
          `<link rel="apple-touch-icon" href="${TOUCH_ICON}" sizes="${touchIcon.width}x${touchIcon.height}" />`,
        ];
        const after = titleTag.index + titleTag[0].length;
        return html.slice(0, after) + tags.map((tag) => `\n${indent}${tag}`).join('') + html.slice(after);
      },
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

/**
 * The built pages' stylesheets first in their heads.
 *
 * Vite writes a page's stylesheet links at the end of the head, after the
 * module script, its modulepreloads and the font preloads the markup carries.
 * The browser asks for files in the order it finds them, and over HTTP/1.1
 * (which `vite preview` and many hosts serve) it keeps six connections to a
 * host: measured on a throttled phone, the three render-blocking stylesheets
 * waited 0.7-0.9s behind five fonts and scripts nothing paints with before
 * them. Moved above every other link, they are asked for first and the first
 * paint comes that much sooner. Nothing else changes: the same files, still
 * render-blocking, in the same order among themselves.
 */
function stylesFirst(): Plugin {
  const STYLESHEET = /[ \t]*<link rel="stylesheet"[^>]*>\n?/g;

  return {
    name: 'styles-first',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const head = html.slice(0, html.indexOf('</head>'));
        const links = head.match(STYLESHEET) ?? [];
        if (!links.length) return html;
        const firstLink = head.search(/<link\b/);
        if (firstLink < 0) throw new Error(`${ctx.filename}: no <link> in the head to put the stylesheets before`);
        let rest = html.slice(firstLink);
        for (const link of links) rest = rest.replace(link, '');
        const indent = head.slice(head.lastIndexOf('\n', firstLink) + 1, firstLink);
        return html.slice(0, firstLink) + links.map((link) => link.trim()).join(`\n${indent}`) + `\n${indent}` + rest;
      },
    },
  };
}

/**
 * The built pages without their authoring comments.
 *
 * The entries and the partials explain themselves at length in HTML comments,
 * and the build copied every one into the served document: 36-42% of each
 * page's bytes, and more than half of what a visitor downloads (Home's document
 * gzips to 26 kB with them and 10 kB without). The document is the first
 * render-blocking download. They are also working notes, naming the reference
 * site and this repository's briefs, which a published page should not carry.
 *
 * Build only. The sources keep their comments and the dev server still serves
 * them, so view-source in dev explains the page.
 *
 * A comment alone on its line or lines goes with them, so no blank line marks
 * where it was; one sharing a line with markup leaves the rest of that line as
 * it stood. An inline <script> or <style> block is matched first and returned
 * untouched, because `<!--` inside one is script or CSS text, not a comment.
 *
 * A comment that still opens with `<!--#` is an include or marquee directive
 * the passes above did not resolve (a misspelt name). Deleting it would drop
 * part of the page without a word, so it stops the build instead.
 */
function stripComments(): Plugin {
  /* Alternatives in the order they must win: a whole script or style block,
     then a comment with the indent before it and the line end after it, where
     it has them. The body is `(?:(?!-->)[\s\S])*` rather than a lazy
     `[\s\S]*?` so it cannot run past its own `-->`: a lazy match backtracks to
     find a line end, and would swallow the markup between two comments that
     share a line. */
  const TOKEN = /(<(script|style)\b[^>]*>[\s\S]*?<\/\2\s*>)|(^[ \t]*)?<!--((?:(?!-->)[\s\S])*)-->([ \t]*\r?\n)?/gim;

  return {
    name: 'strip-comments',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        return html.replace(
          TOKEN,
          (
            _match,
            block: string | undefined,
            _tag: string | undefined,
            indent: string | undefined,
            body: string,
            lineEnd: string | undefined,
          ) => {
            if (block !== undefined) return block;
            if (body.startsWith('#')) {
              throw new Error(`${ctx.filename}: unresolved directive <!--${body}--> left in the built page`);
            }
            const ownLines = indent !== undefined && lineEnd !== undefined;
            return ownLines ? '' : (indent ?? '') + (lineEnd ?? '');
          },
        );
      },
    },
  };
}

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [htmlPartials(), headTags(), heroMarquee(), stylesFirst(), stripComments()],
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
