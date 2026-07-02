# ADR-0002: Build the service worker and inject helper via Vite

- **Status:** Accepted
- **Date:** 2026-07-03

## Context

The service worker and the page-injected helper previously shipped as untyped `public/*.js` files
copied verbatim into `dist/`. Because they weren't built, they couldn't import from `src/`, which is
why shared values were hand-copied into them (see [ADR-0001](0001-dedupe-within-repo.md)).

## Decision

Move both into `src/` and build each through its own Vite config so they can import `src/shared`:

- `vite.worker.config.mjs` — builds `src/background/service-worker.js` as a **single self-contained
  ES module** (the manifest declares `"type": "module"`), with `inlineDynamicImports` so no code is
  split into separate chunks the worker couldn't load.
- `vite.inject.config.mjs` — builds `src/inject/utils-inject.js` as a **self-executing IIFE**, since
  it is injected as a classic script into the page's MAIN world and cannot use runtime ESM.

`npm run build` runs three passes: panel, then worker, then inject (the latter two with
`emptyOutDir: false` so they append to `dist/`).

## Consequences

- The worker and helper now consume the typed `src/shared` seam; the four `public/*.js` copies are
  deleted.
- Kept scope to **structure + dedup**: the worker stays plain JS (bundled, not strictly type-checked)
  — a full strict-TS conversion was explicitly out of scope.
- The build is three commands instead of one; `npm run dev` still only serves the panel, so
  exercising the whole extension requires `npm run build` + reloading the unpacked `dist/`.
