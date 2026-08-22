# Content Authoring Guide

Add cards by editing JSON. The Zod schemas in `src/engine/content.ts` are
the source of truth; if this guide disagrees with the loader, the code
wins. Glossary: [`CONTEXT.md`](CONTEXT.md). Architecture:
[`ARCHITECTURE.md`](ARCHITECTURE.md). Locked decisions: [ADRs
0001–0009](adr/README.md). Shipped cards and floor numbers live in
`content/`.

## Where content lives

```
content/start.json                 era-agnostic constants, seed stocks, first project
content/eras.json                  ordered era ids, startingEraId, entryAnyOf
content/eras/<eraId>/decisions.json
content/eras/<eraId>/challenges.json
content/eras/<eraId>/projects.json
content/eras/<eraId>/meta.json     optional; the game loader ignores it
```

Later era folders are **deltas** (ADR 0008). The loader concatenates prior
rungs, then this folder. Redeclaring an inherited id fails at load. Put
new Company cards in `content/eras/company/`; do not copy Studio JSON
forward. Empty later files are valid. A later-era card may `requires` an
inherited id.

`eras.json` `entryAnyOf` is an OR of AND-paths (`minBudget`,
`minReputation`, `minCompletedProjects`, `minUsers`). The tick evaluates
the **next** rung only, at end of day. The starting era must not declare
`entryAnyOf`. Omit `silentEntry` (or set it true) for a quiet heading
change; `"silentEntry": false` announces the crossing. Floor numbers live
in `content/eras.json`, not here.

Schemas are `.strict()`: unknown keys fail the file, naming the era path
and entry id. `npm run test` loads every bundle. `make graph` opens the
local DAG (ADR 0003). Bump `SAVE_VERSION` in `src/engine/save.ts` when you
retire ids a previous save might still own (ADR 0004).

## Decisions

Shape: `decisionSchema` in `src/engine/content.ts`. `id` must be unique
across the **resolved** catalog. `category` is a closed enum (`DecisionCategory`
in `src/engine/types.ts`). It is required authored metadata; the player shop
is a flat single-column list and does not group by category. There are no
decision `tags`. `human: true` is headcount for challenge predicates, not
a track label.

Cost may be `{}`. `incomePerDay` / `incomeFromStock` / `burstFromStock`
credit in the same income step **before** payroll that tick. Burst rolls
from the shared RNG; a hit is not a post-insolvency windfall.
`stockFlowMods` add to a matching `start.stockFlows` entry (omit until a
card should change organic acquire/churn). Monetization-only cards still
need `"effects": []`.

`requires` is AND of owned ids. `requiresCounts` is `{ id, count }`
(count >= 1) and composes with `requires`. A count above 1 on a `unique`
id is rejected. `unique: true` hides the card from the shop while owned.
`removable: false` hides the Remove button; payroll still deletes a
`cost.perDay` instance when budget cannot cover that day's charge.
Repeatable non-unique purchases stay in Owned after a temporary effect
expires; instances do not self-prune.

Gamble tables roll **once at purchase** from the shared RNG. Probabilities
must sum to 1 (tolerance `1e-9`). Base `effects` still apply alongside the
drawn outcome.

### Synergies replace, they do not add

The first `synergies` entry whose `ifOwned` id is currently owned wins.
Its `effects` / `gamble`, if present, **replace** the base field; omitted
fields fall back. Write the whole table, not a delta. Ownership is checked
only at purchase; later add/remove of the provider does not rewrite
existing instances (`appliedSynergyIfOwned` on the instance records the
match).

## Effects

All eight types are one discriminated union (`effectSchema`). Extra keys
fail. `add` modifiers on a rate sum first, then `mul`, then context-switch
tax (`src/engine/modifiers.ts`).

| type | Notes that are easy to get wrong |
| --- | --- |
| `modifyRate` | `target` is `pull` / `finish` / `deploy` / `all`. Omit `durationDays` for permanent. |
| `modifyDebtMultiplier` | Same `op` / `value` / optional `durationDays`; no `target`. |
| `addToStock` | Any stock in the enum; result clamped at 0. Pipeline writes (`backlog` / `inProgress` / `done`) attach to in-flight `remaining` (ADR 0009). |
| `scaleStock` | Immediate multiply, `factor >= 0` (`0` wipes). No duration, no Progress-panel modifier. |
| `sickness` | Challenge-only: needs `perHumanDev: true` so an `instanceId` exists. Schema-legal on a shop decision, but `applyDecision` never threads an instance, so it no-ops. |
| `removeHuman` | Challenge-only roster loss; purchase-time application does not pass `content`, so it no-ops on shop cards. Choice options with this effect require `condition.minHumanDevs >= 1`. |
| `rampRate` | `target` cannot be `"all"` — one effect per rate. Grows an add-op modifier up to `cap` while owned; removal drops the bonus immediately. |
| `continuousDeploy` | Marker, not a numeric effect. Presence on an owned def's **base** `effects` (not a synergy swap) ships the entire `done` stock each tick. |

### modifyRate timing

A modifier's `expiresDay` is `state.day + durationDays`. Expired modifiers
are pruned at the **start** of that tick, before flows run. A
purchase-time effect (between ticks) is therefore live for
`durationDays - 1` subsequent ticks; a mid-tick challenge effect is live
for the full `durationDays` including the fire tick.

Want a purchase-time slowdown felt for N days? Write `durationDays: N + 1`.
Challenge mid-tick effects do not need the `+ 1`. The shop summary in
`src/ui/effectSummary.ts` uses the felt number so card copy and the
derived line stay aligned:

```json
{ "type": "modifyRate", "target": "all", "op": "mul", "value": 0.5, "durationDays": 6 }
```

That is a 5-day felt slowdown if applied at purchase.

## Challenges

Shape: `challengeSchema`. `condition` fields are AND. Eligibility uses
stocks, human headcount, and live ownership (`requiresAnyDecision`,
`lacksDecision`) — not tags. Unknown decision ids in those fields fail
`validateContentGraph` after the era catalog is assembled.

`probScaling` today is only `{ stat: "techDebt", per, add }`, added to
`probabilityPerDay` and capped at 1. Generic `minStock` / `maxStock` are
not in the schema; keep using `minTechDebt`.

If `choice` is present, top-level `effects` **must** be `[]` (otherwise
the engine queues the choice and the top-level array is silent loss).
`defaultOptionId` must name an option. Unresolved expiry applies that
default — never a silent no-op. Choice cooldown starts on resolve/expiry,
not on queue; a pending choice also blocks re-queue of the same id.

`perHumanDev: true` rolls once per human instance. Required (and
enforced) for any top-level `sickness` effect.

Rolls are `hashRoll(seed, day, challengeId)` (plus instance id when
per-human). Adding or reordering challenges does not shift other
challenges' fire days. Purchase gambles still share the RNG stream.

`challengeSpacingDays` lives in `start.json`, not per challenge. After
any fire (effects applied or choice queued), no challenge rolls until
that many days pass. At most one event per tick. `0` disables the gap
(tests use this to isolate per-challenge cooldowns). Expiry-default
during a gap is not a new roll.

## Projects

Shape: `projectSchema`. The starting contract is `start.json`
`initialProject`, not the era file. `stocks.backlog` **must** equal
`initialProject.sizePoints`.

- `sizePoints` — added to Ready and set as `remaining` on start.
- `upfrontCost` / `payoutPerPoint` / `completionBonus` — FIFO: shipped
  points hit the oldest in-flight project; bonus and removal fire when
  `remaining` hits ~0.
- `requiresCompleted` — count of any completed projects
  (`state.completedProjects`), not a specific id.
- `requiresCompletedId` — that specific id must be in
  `state.completedProjectIds` (`initialProject.id` or another catalog
  id, including inherited). Self-references and unknown ids fail
  `validateContentGraph`. Prefer this when optional gigs must not skip a
  sequence.
- `unique` — cannot start again after completion. Omit for repeatable
  gigs.
- `reputationReward` — required (>= 0; `0` is legal).
- `requiresReputation` — live floor, re-checked every call. A later
  reputation hit re-locks the contract.
- `completionStockGrants` — `{ stock, amount }` copied onto the in-flight
  project at start.

Availability order: in-flight → unique already-completed → count floor →
specific id → reputation → afford (`src/engine/projects.ts`). Extra
concurrent projects apply `contextSwitchFactor ^ (n - 1)` to all rates.

## `start.json` knobs

`parseStartConfig` is one strict object. Milestone ids must be unique and
`reputation` thresholds strictly ascending. Milestones are one-time log
lines (`state.milestonesSeen`); they never grant effects or gates.
`requiresReputation` on a project is the live gate.

`debtDrag` stays a dedicated tech-debt block (not `stockDrags`, ADR 0005):
`freeDebt`, `dragPerPoint`, `maxDrag` in `(0, 1)`. `stockDrags` are the
generic same-shape slowdown keyed on any stock and a rate target.
`stockFlows` are per-tick acquire/churn after shipping; optional
`condition.minCompletedProjects`. Owned `stockFlowMods` add to a matching
flow. Omit either array for `[]`.

Numbers for these knobs live in `content/start.json`. Archetype log lines
(`src/engine/archetypes.ts`) are engine-side; new cards are classified
from their effects automatically.

## Checking your work

`npm run test` parses every era bundle and runs the balance probes in
`src/engine/simulation.test.ts`. Tune JSON against those probes.
`npm run build` type-checks. `make graph` is the
visual check for requires / counts / synergies / era-entry paths.
