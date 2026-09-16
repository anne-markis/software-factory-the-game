# AGENTS.md

## Decision protocol

Do not implement, auto-fix, or expand scope until Anne has approved the
decision. Propose first. Wait for a yes, a chosen option, or an explicit
bypass in the **current** message.

**Bypass:** skip this gate only when Anne explicitly asks you to in that
message (for example "just do it", "bypass", "don't wait", "implement
without asking"). A GitHub issue, failing test, linter warning, review
comment, or "while I'm here" cleanup is not a bypass.

### What needs approval

- How to solve the request (approach, files, architecture, content/balance)
- Any fix Anne did not ask for (unrelated test failures, type errors, lint,
  refactors, extra polish, drive-by cleanup)
- Scope changes (new files, extra features, content edits beyond the ask)

### What does not need approval

- Read-only exploration (reading files, searching, running existing tests)
- Carrying out a plan Anne already approved in this thread
- Tiny mechanical follow-through of that approved plan (a typo in the same
  edit, matching a pattern she already chose)

### Side effects

Every proposed decision includes a very basic **Side effects** list. Keep
it short (a few bullets). Cover:

- What else will change (files, UI, engine, content, saves, tests)
- What could break or surprise a player or a later agent
- What you will **not** touch

Example:

> **Proposal:** Change hire to fill In Progress seats immediately.
> **Side effects:**
> - Engine tick and hire path both write the work ledger
> - Existing saves keep working; no schema bump
> - UI copy on the crew panel may need a one-line update
> - Will not change challenge tables or era JSON

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
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Later era
  folders are deltas (ADR 0008); do not copy Studio JSON forward.
- Code is the context: do not cite GitHub issues in comments, tests, or
  docs. Use the current working tree; old tickets are not part of context.
