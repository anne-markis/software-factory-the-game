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

Decisions, challenges, and projects are all hand-editable JSON, validated by
strict schemas at load (typos and unknown keys fail loudly, naming the file
and entry), and checked by simulation-based balance probes in the test
suite. See [`docs/CONTENT-AUTHORING.md`](docs/CONTENT-AUTHORING.md) for the
full field-by-field guide, the effect vocabulary, and a worked example of
adding a decision and a challenge.

## Design notes

- One tick = one second = one game day.
- The pipeline is stocks and flows: speeding one stage moves the bottleneck.
- Tech debt regenerates backlog per shipped point and scales incident risk.
- Starting concurrent projects applies a context-switch tax (0.85^(n-1)).
- If the pipeline is empty and nothing is affordable, the factory stalls.
- Balance constants were retuned in release 6; the simulation tests double as balance probes (greedy bot must complete a contract and stay solvent).
