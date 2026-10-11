# lewishamilton-web

A Lewis Hamilton site in four pages: Home, On Track, Off Track and Calendar. It is a remake of
landonorris.com with a different driver in it. The structure, the sections and the scroll mechanics
are the reference's; the driver, the colours (Ferrari red in place of McLaren lime) and the career
data are Hamilton's.

This repository tracks the site only, in `app/`. The offline copy of the reference it is checked
against and the specs it is built from stay in the working directory and are not published here
(see `.gitignore`).

## The site

Vite, TypeScript, Three.js, GSAP ScrollTrigger and Lenis.

```bash
cd app
npm install
npm run dev          # dev server, http://localhost:5173
npm run build        # production build into app/dist
npm run preview      # serves app/dist, http://localhost:4173
npm run typecheck    # tsc --noEmit
npm run fetch-stats  # refetches src/content/generated/career.json from Jolpica
```

Every figure on the pages comes from the data layer in `app/src/content`. It is validated when
`vite.config.ts` loads, so a missing or malformed record stops the build and the dev server.

Set `SITE_ORIGIN` to the origin the site is served from when building for publication:

```bash
SITE_ORIGIN=https://<host> npm run build
```

Link previews need an absolute address for the share image. Without the variable the build warns
and writes a root-relative one.

## The reference

In a working directory that has it, the reference site runs from the repository root:

```bash
npm start            # http://localhost:8080
```

## The specs

In `docs/` in the working directory, read in this order: `SITEMAP.md`, `CONTENT-DATA.md`,
`DESIGN-SYSTEM.md`, `ANIMATIONS-SPEC.md`, `TECH-STACK.md`, `COMPONENTS.md`. `CLAUDE.md` at the
root is the project brief.
