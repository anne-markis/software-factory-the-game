# Architecture

How Software Factory is put together, and how to extend it. Product
direction lives in [`VISION.md`](VISION.md). Locked decisions are
[`adr/`](adr/README.md) (0001–0009). Schema gotchas are
[`CONTENT-AUTHORING.md`](CONTENT-AUTHORING.md). The glossary is
[`CONTEXT.md`](CONTEXT.md). If a doc and `src/engine/` disagree, the
code wins.

## Shape

The shipped game is a **static browser app**. There is no backend,
database, or runtime network I/O. Vite bundles `content/*.json` at
build time. Saves are `localStorage` only.

That does **not** mean the DOM is allowed to own the rules. Three
layers:

| Layer | Lives in | Owns |
| --- | --- | --- |
| **Content** | `content/` | Numbers, copy, graph, era floors. Human-editable JSON. |
| **Domain (engine)** | `src/engine/` | Tick, stocks/flows, effects, shop legality, era advancement, save schema. |
| **View (UI)** | `src/ui/` | Render engine state, dispatch player intents, persistence glue, clock speed. |

`tools/` is local authoring (the content graph). It is not the player
build (ADR 0003).

## Domain purity

`src/engine/` is the domain. Keep it pure:

- No `document`, `window`, `localStorage`, or imports from `src/ui/`.
  `purity.test.ts` enforces this.
- Deterministic: one seeded RNG, one tick = one game day. Tests replay.
- Story-dumb: the tick does not hardcode era names, card ids, or
  product fiction. Content points generic fields at stocks (ADR 0005 /
  0006).
- Framework-free TypeScript. The engine API is message-shaped
  (`tick`, `applyDecision`, `getState`, …) so it could move to a worker
  or server later without rewriting the rules.

If a change needs the DOM to decide affordability, income, era
crossing, or effect resolution, it is in the wrong layer.

## One work ledger

Pipeline stocks and `ActiveProject.remaining` are two views of the same
work (ADR 0009). Stage stocks say where unshipped points sit; remaining
says which contract they belong to. Extra inflow (debt refill, scope
creep, any `addToStock` / `scaleStock` on `backlog` / `inProgress` /
`done`) must attach to one remaining when a project is in flight
(engine-picked arbitrarily if several are live; not split, not player-
chosen). The
cockpit Backlog hero metric is unshipped work (`backlog + inProgress +
done`), not the Ready-stage stock. The Delivery diagram labels that
first stage Ready.

Do not seed `start.json` `stocks.backlog` independently of
`initialProject.sizePoints` — the loader rejects a mismatch.

## Keep business logic out of the view

`src/ui/` is a thin client of the engine, not a second rules engine.

**UI may:** paint stocks, diagrams, and shop copy; send clicks
(`applyDecision`, pause, speed); hold clock speed and `localStorage`
keys; format numbers for display; hang a DevTools cheat API (`sf` in
`devConsole.ts`) that writes budget/points through the work ledger.

**UI may not:** invent tick math, duplicate eligibility checks “for
convenience,” special-case card ids, or advance eras. Speed is a view
preference (`tickDriver.ts`), never a field on `GameState`.

A good smell test: an engine unit test can prove the behavior without
jsdom. UI tests cover wiring and DOM stability, not the economy.

## Do not repeat era catalogs

Eras are a one-way **scale ladder** (Studio → Company → Megacorp).
Identity, order, and entry floors live in **`content/eras.json` only**.
Do not copy those floors into TypeScript, `meta.json`, or later era
JSON. `meta.json` is optional human blurb; the loader does not parse it.

Each `content/eras/<eraId>/` folder is the **delta for that rung**.
The loader **inherits** every prior rung so owned cards keep paying
after the shop swaps (ADR 0008):

```
resolved(studio)   = studio files
resolved(company)  = resolved(studio) + company files
resolved(megacorp) = resolved(company) + megacorp files
```

- Put a new Company card in `content/eras/company/`, not in Studio.
- Do not paste Studio cards into Company or Megacorp. Redeclaring an
  inherited id fails at load.
- Empty later files are fine: inherit is the carry.
- A later card may `requires` an inherited id; refs are the resolved
  catalog.
- Do not retune an inherited id’s cost in a later file (owned upkeep
  would change silently). Shop hide/retire is a future flag, not
  omission.

`start.json` is era-agnostic (seed stocks, always-on flows and drags).
Those keep running when the era heading changes.

Entry floors live only in `content/eras.json`. Do not copy them into ADRs
or glossaries. Crossings are silent by default.

## Content owns the numbers

Tunable values belong in JSON, validated by strict Zod schemas. Typos
fail at load with file and entry names. Do not sprinkle balance
constants in the engine or UI.

Progression edges (`requires`, challenge predicates, `entryAnyOf`) are
content. Capability mix meanders inside an era; there are no tracks or
decision tags (ADR 0002).

## What to reach for

| Goal | Where |
| --- | --- |
| Change a cost, rate, or floor | `content/` |
| Change how a tick or effect works | `src/engine/` + engine tests |
| Change what the player sees | `src/ui/` |
| Lock a structural choice | a new ADR |
| Author the decision graph | `make graph` (same loader as the game) |

## Code is the context

Comments, tests, and this guide describe the current system. Do not cite
GitHub ticket numbers or ticket URLs as explanation or provenance.
Old tickets are not part of the working context. If a rationale still
matters, write it in the code or an ADR. Historical design snapshots
under `docs/superpowers/` may still name tickets; they are not
instructions for changing the code.

## Out of bounds

- Backend, accounts, or runtime fetches for content.
- Era `switch` / `if (eraId === "company")` in the tick.
- Copy-pasted catalogs or duplicated `eras.json` floors.
- Business rules in the view, or DOM access in the engine.
