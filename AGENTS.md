# AGENTS.md

## Cursor Cloud specific instructions

Software Factory is a **100% client-side static web app** — there is no backend,
database, API, or runtime network I/O. All "services" are just local dev tooling
(Node 22 + npm). Node 22 and `npm install` (run by the startup update script)
are all that is needed before working.

Standard commands are documented in `README.md`; the notes below are the
non-obvious bits:

- **Dev server:** `npm run dev` (Vite) serves at `http://localhost:5173/`. It
  binds to localhost only; that is reachable from the in-VM browser, so no
  `--host` flag is needed for manual testing here.
- **Tests:** `npm run test` runs the full Vitest suite (unit + simulation/balance
  probes, jsdom for DOM-touching UI tests). This is the primary automated
  verification. `npm run test:watch` for watch mode.
- **Lint / type-check:** there is no separate lint command. Type-checking is done
  by `tsc` as the first half of `npm run build` (`tsc && vite build`), so run
  `npm run build` to type-check.
- **Content JSON** (`content/*.json`) is imported as ES modules and bundled at
  build time (no runtime fetches). Editing content requires no code changes but
  is only picked up on a dev-server reload / rebuild; strict Zod schemas fail
  loudly on typos.
- The game engine (`src/engine/`) is deterministic and DOM-free (enforced by
  `purity.test.ts`); saves persist to browser `localStorage` only.
