# Software Factory

A browser incremental game about systems thinking in software delivery.
You run a delivery system that burns down a backlog. Alter the system with
people, agents, and process; survive random challenges; scale points/day.

## Run

    npm install
    npm run dev

## Test

    npm run test

To jump to a boundary without playing a full run, open the browser
DevTools console on the running game and type `sf.help()`. `sf.budget(n)`
and `sf.points(n)` (optionally park points in `"inProgress"` or `"done"`)
write through the work ledger and save.

## Deploy

`npm run build` produces a fully static, self-contained bundle in `dist/`
(content is compiled into the JS at build time, no runtime fetches, relative
asset paths via `base: "./"` in `vite.config.ts`), so it can be dropped into
any subdirectory of any static host with no code changes.

The live copy is served at
[annemarkisgraham.com/software-factory-game](https://www.annemarkisgraham.com/software-factory-game/),
embedded as a subdirectory of the `annemarkisgraham.com` static site (a
Lightsail instance running nginx). That repo's `Makefile` has the automation:

    cd ~/Code/annemarkisgraham
    make deploy-game   # builds this repo, copies dist/ into public/software-factory-game/, deploys

`make deploy-game` expects this repo to be a sibling checkout at
`~/Code/software-factory-the-game` (override with `GAME_DIR` in that repo's
`.makerc` if it lives elsewhere). See that repo's `README.md` for the full
setup notes (SSH key, server details, SSL).

## Layout

- `src/engine/` - all game rules. Framework-free TypeScript, no DOM access
  (enforced by `purity.test.ts`). Deterministic via seeded RNG; saves resume
  the exact RNG sequence. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- `src/ui/` - thin plain-DOM rendering and input layer, plus localStorage
  persistence (autosave every 10 game days, reset button). No game rules.
- `content/` - human-editable JSON: `start.json` (era-agnostic constants),
  `eras.json` (scale-era index), and per-era **deltas** under
  `content/eras/<eraId>/` (decisions, challenges, projects). The loader
  inherits prior rungs so later folders do not copy Studio. Validated with
  strict schemas at load; edits need no code changes and typos fail loudly
  with file and entry names. Eras are a one-way scale ladder, not parallel
  tracks; see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
  [`docs/CONTENT-AUTHORING.md`](docs/CONTENT-AUTHORING.md) and
  [`docs/CONTEXT.md`](docs/CONTEXT.md).
- `docs/superpowers/specs/` - design document, including alternatives
  considered (web worker engine, thin client + server) as future refactors.
- `docs/superpowers/plans/` - the implementation plan this v1 was built from.

## Editing content

Decisions, challenges, and projects are all hand-editable JSON, validated by
strict schemas at load (typos and unknown keys fail loudly, naming the file
and entry), and checked by simulation-based balance probes in the test
suite. See [`docs/CONTENT-AUTHORING.md`](docs/CONTENT-AUTHORING.md) for the
full field-by-field guide (eras, stock-linked fields, effect vocabulary)
and [`docs/CONTEXT.md`](docs/CONTEXT.md) for the glossary. Worked examples
of adding a decision and a challenge live in the authoring guide.

### Content graph viewer

Run `make graph` to open the local authoring graph at
`http://127.0.0.1:5174/`. It parses the shipped era bundles through the same
engine loader and Zod schemas as the game, then shows **native** decisions
per era (inherited cards stay in the earlier column), plus requirements,
count gates, synergies, costs, and era-entry paths. The viewer is local tooling
only and is not included in the player build.

## Design notes

- One tick = one second = one game day.
- The pipeline is stocks and flows: speeding one stage moves the bottleneck.
- Tech debt regenerates backlog per shipped point and scales incident risk.
- Starting concurrent projects applies a context-switch tax (0.85^(n-1)).
- If the pipeline is empty and nothing is affordable, the factory stalls.
- Balance constants were retuned in release 6; the simulation tests double as balance probes (greedy bot must complete a contract and stay solvent).

## License

Copyright Anne Graham. This project is licensed under the
[PolyForm Noncommercial License 1.0.0](./LICENSE)
(`PolyForm-Noncommercial-1.0.0`).

**Allowed (noncommercial):** read, run, fork, modify, and republish, as long as
you keep the license text and the `Required Notice` line that cites this
GitHub repo as the original.

**Not allowed without a separate deal:** any commercial use (making money from
this software or distributing it for a commercial purpose).

**Commercial licensing:** open a GitHub issue on this repo and tag it
`licensing`.

**Contributions:** by opening a pull request, you license your contribution to
Anne Graham under the same PolyForm Noncommercial terms (inbound = outbound).

See [ADR 0007](./docs/adr/0007-polyform-noncommercial.md) for why this license
was chosen over MIT/Apache.
