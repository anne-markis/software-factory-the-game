# Software Factory

A browser incremental game about systems thinking in software delivery.
You run a delivery loop that burns down a backlog. Alter the loop with
people, agents, and process; survive random challenges; scale points/day.

## Run

    npm install
    npm run dev

## Test

    npm run test

## Layout

- `src/engine/` - all game rules. Framework-free TypeScript, no DOM access
  (enforced by `purity.test.ts`). Deterministic via seeded RNG; saves resume
  the exact RNG sequence.
- `src/ui/` - thin plain-DOM rendering and input layer, plus localStorage
  persistence (autosave every 10 game days, reset button).
- `content/` - human-editable JSON: `start.json` (constants), `decisions.json`
  (loop alterations), `challenges.json` (random events), `projects.json`
  (contracts). Validated with strict schemas at load; edits need no code
  changes and typos fail loudly with file and entry names.
- `docs/superpowers/specs/` - design document, including alternatives
  considered (web worker engine, thin client + server) as future refactors.
- `docs/superpowers/plans/` - the implementation plan this v1 was built from.

## Editing content

Add a decision, challenge, or project by appending to the matching JSON file.
Effects use a small typed vocabulary (`modifyRate`, `modifyDebtMultiplier`,
`addToStock`, `sickness`); schema errors are reported with file and entry
names. Gamble tables must sum to 1. Choice challenges must not carry
top-level effects, and sickness effects require `perHumanDev`.

Timing note for `durationDays`: effects applied at purchase time are live
for `durationDays - 1` ticks (expiry is pruned at the start of the tick the
duration lands on), while effects applied mid-tick by challenges run for the
full count. Content that wants a purchase slowdown felt for N days should
use `durationDays: N + 1`; the shipped decisions already do.

## Design notes

- One tick = one second = one game day.
- The pipeline is stocks and flows: speeding one stage moves the bottleneck.
- Tech debt regenerates backlog per shipped point and scales incident risk.
- Starting concurrent projects applies a context-switch tax (0.85^(n-1)).
- If the pipeline is empty and nothing is affordable, the factory stalls.
