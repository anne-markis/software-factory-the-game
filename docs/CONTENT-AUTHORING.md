# Content Authoring Guide

Add cards by editing JSON. The Zod schemas in `src/engine/content.ts` are
the source of truth; if this guide disagrees with the loader, the code
wins. Glossary: [`CONTEXT.md`](CONTEXT.md). Architecture:
[`ARCHITECTURE.md`](ARCHITECTURE.md). Locked decisions: [ADRs
0001–0009](adr/README.md). Shipped cards and floor numbers live in
`content/`. Do not cite GitHub issues in JSON, comments, or this guide;
the files here are complete without ticket history.

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
`entryAnyOf`. `parallelCopies` is how many copies of a `parallel` project
may be in plan and in flight at once (Studio 1, Company 2, Megacorp 3).
Omit means 1. Omit `silentEntry` (or set it true) for a quiet heading
change; `"silentEntry": false` announces the crossing. Floor numbers live
in `content/eras.json`, not here.

Schemas are `.strict()`: unknown keys fail the file, naming the era path
and entry id. `npm run test` loads every bundle. `make graph` opens the
local content studio (decision tree, type chips, challenges). Bump
`SAVE_VERSION` in `src/engine/save.ts` when you
retire ids a previous save might still own (ADR 0004).

## Decisions

Shape: `decisionSchema` in `src/engine/content.ts`. `id` must be unique
across the **resolved** catalog. `category` is a closed enum (`DecisionCategory`
in `src/engine/types.ts`). It is required authored metadata; the player shop
is a flat single-column list and does not group by category. There are no
decision `tags`.

Shop order is that resolved catalog's array order — Studio file order,
then Company delta, then Megacorp delta (ADR 0008). There is no
`shopOrder` field and no second sort by category, chain, name, cost, or
affordability. Hidden cards (owned unique, unmet `requires` /
`requiresCounts`) leave a hole: later entries are not pulled forward, and
the list is not regrouped. When a later-era file is non-empty, its cards
appear after the inherited prior-rung array, in the order they sit in
that file. To change player order, move the object in the JSON array.

`human: true` is roster headcount (challenges, `scaleFromHumansPer`,
morale quit). `agent: true` is the matching flag for coding-agent copies
(agent:human overload). Those copies do not share a seat: authored
`oneTime` and `perDay` are multiplied by active humans plus the founder.
The multiplier is live, so a hire starting later raises existing agent
payroll, and a departure lowers it. Pending hires do not count until they
start. Harness / orchestration / agent CI review omit `agent` and stay one
shared bill. `delayDays`
(integer >= 1) defers effects, capacity, payroll, and headcount until
`day + delayDays`; the one-time cost and gamble still resolve at
purchase. Pending instances count as owned for `unique` / `requires`.
Studio's basic developer is `$2,000` + 14 days + `$438/day` after they
start.

Cost may be `{}`. `incomePerDay` / `incomeFromStock` / `burstFromStock`
credit in the same income step **before** payroll that tick. Burst rolls
from the shared RNG: each point of stock independently rolls
`probabilityPerDay`, and each success credits `perUnit`. A sale is not a
post-insolvency windfall.
`stockFlowMods` add to a matching `start.stockFlows` entry (omit until a
card or completed project should change organic acquire/churn).
Monetization-only cards still need `"effects": []`.

`requires` is AND of owned ids. `requiresCounts` is `{ id, count }`
(count >= 1) and composes with `requires`. A count above 1 on a `unique`
id is rejected. `unique: true` hides the card from the shop while owned.
`removable: false` hides the Remove button; payroll still deletes a
`cost.perDay` instance when budget cannot cover that day's charge.
A tick that starts at `$0` also freezes `pull` / `finish` / `deploy`
(in-flight remaining does not burn down); income netting still runs.
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

`replacesGamble` is the same full-table replace, authored on the provider
instead of the buyer (so a later era can tighten an inherited hire without
redeclaring it). An active instance of the provider must be owned. The
buyer's own `synergies` entry wins when one of those providers is owned.
Pending copies do not replace the table.

## Effects

All eleven types are one discriminated union (`effectSchema`). Extra keys
fail. `add` modifiers on a rate sum first, then `mul`, then debt and stock
drags (`src/engine/modifiers.ts`). In-flight count does not multiply rates.

| type | Notes that are easy to get wrong |
| --- | --- |
| `modifyRate` | `target` is `pull` / `finish` / `review` / `deploy` / `discover` / `plan` / `ktlo` / `all`. `all` is the delivery line (pull/finish/review/deploy), not discover, plan, or ktlo. Discover cards do not raise plan. Omit `durationDays` for permanent. Optional `scaleFromHumansPer` (add-op only) multiplies the addend by `1 + per ×` owned `human: true` instances, live — hire later still buffs existing modifiers; payroll loss drops it. Studio agents use `0.1`. Pull no longer fills In Progress; finish speed moves the Ready+In Progress pool into In Review. The In Review zoom Next lever offers any shop card whose authored `modifyRate` (base effects or gamble) targets **`review` exactly** — not `"all"`. Do not special-case card ids in UI. |
| `modifyDebtMultiplier` | Same `op` / `value` / optional `durationDays`; no `target`. |
| `addToStock` | Any stock in the enum; result clamped at 0 and at `start.stockMax` when that stock is capped (Studio: morale 100). Pipeline writes (`backlog` / `inProgress` / `inReview` / `done`) attach to one in-flight `remaining` (engine-picked when several are live; ADR 0009). Extra In Progress above seats spills to Ready on the next tick, and immediately when a shop buy or remove changes capacity. |
| `scaleStock` | Immediate multiply, `factor >= 0` (`0` wipes). No duration, no Progress-panel modifier. |
| `sickness` | Challenge-only: needs `perHumanDev: true` so an `instanceId` exists. Schema-legal on a shop decision, but `applyDecision` never threads an instance, so it no-ops. A sick hire still occupies In Progress capacity. |
| `removeHuman` | Challenge-only roster loss; purchase-time application does not pass `content`, so it no-ops on shop cards. Choice options with this effect require `condition.minHumanDevs >= 1`. |
| `rampRate` | `target` cannot be `"all"` — one effect per rate. Grows an add-op modifier up to `cap` while owned; removal drops the bonus immediately. |
| `continuousDeploy` | Marker, not a numeric effect. Presence on an owned def's **base** `effects` (not a synergy swap) ships the entire `done` stock each tick. |
| `modifyCapacity` | Add or mul In Progress seats. Not sickness-scaled. Prefer `DecisionDef.capacity` for a hire's own seat. |
| `scaleDecisionGrant` | While this instance is active, a purchase of `targetDecision` multiplies its `addToStock` of `stock` by `factor` (below 1 shrinks it). Several active owners: the purchase uses the highest factor. Recorded when effects land, so a delayed hire does not scale grants until they start. `targetDecision` must be a known decision id in this era or an earlier one. |
| `keepProject` | Marker on a decision's **base** `effects`. While an instance is active, the named contract is started whenever it is not already in flight or in plan, including after it finishes. Pending hires do not schedule. A pursue project is skipped. The project id must exist in the resolved catalog. |

`start.json` `baseCapacity` is founder seats (Studio: 1). `DecisionDef.capacity` adds seats while owned (hire: 1). `capacityFromOwned` (`{ id, per }`) adds `per` per owned instance of `id` while this card is owned — Studio ships none; do not hardcode `agent` in the engine.

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

- `sizePoints` — added to Ready and set as `remaining` on Start. **Pursue**
  spends this many Ideas and queues a named Plan item at 0/`sizePoints`
  instead; Plan fills at 1/day (split across items) and auto-enters Ready
  with the same ledger write when progress hits size.
- `upfrontCost` / `payoutPerPoint` / `completionBonus` — shipped credit
  splits equally across in-flight remainings; bonus and removal fire when
  that contract's `remaining` hits ~0. Factory Points/Day is conserved.
  Money `upfrontCost` comes off on Start, or on Pursue at the same moment.
- `requiresCompleted` — count of any completed projects
  (`state.completedProjects`), not a specific id.
- `requiresCompletedId` — that specific id must be in
  `state.completedProjectIds` (`initialProject.id` or another catalog
  id, including inherited). Self-references and unknown ids fail
  `validateContentGraph`. Prefer this when optional gigs must not skip a
  sequence.
- `unique` — cannot start again after completion. Omit for repeatable
  gigs.
- `parallel` — optional boolean. `true` means plan and in-flight copies
  together may reach the active era's `parallelCopies`. The offer stays
  one row. Omit means one copy. Ship next feature is the shipped case.
- `pursue` — optional boolean, same style as `unique`. `true` is
  **Pursue** (spend Ideas = `sizePoints`, enter Plan). Omit or `false`
  is **Start** (no Ideas spend, write Ready immediately). Default Start
  so inherited gigs do not silently Pursue.
- `permanent: true` — always-on overhead, not a contract. Fields are
  `id`, `name`, `basePerDay` (the `ktlo` rate, taken out of finish
  before contract work), and `perDay` (cash drain, shown on Expenses as
  KTLO). It does not take an In Progress seat. No size or payout. It
  is not offered and cannot be abandoned. It appears when its era’s
  catalog is active and is inherited after that. Studio ships Keep the
  lights on; `start.baseRates.ktlo` is the seed (0) and `syncKtloBase`
  copies `basePerDay` on load. Cards change the rate with `modifyRate`
  target `ktlo` (`add` or `mul`). `"all"` does not include it.
- `retire-projects.json` — optional array of project ids in an era
  folder. Those offers disappear from that rung onward. The def stays
  inherited, so a sprint already in flight still finishes or can be
  abandoned. Do not redeclare the id in `projects.json`.
- `reputationReward` — required (>= 0; `0` is legal).
- `requiresReputation` — live floor, re-checked every call. A later
  reputation hit re-locks the contract.
- `completionStockGrants` — `{ stock, amount }` copied onto the in-flight
  project at start.
- `stockFlowMods` — same shape as on decisions (`{ stock, acquirePerDayDelta?,
  churnRateDelta? }`). Applied every tick **once per
  `completedProjectIds` entry**, not while in-flight. A unique ship records
  one entry. A repeatable ship records every completion, so the nudge
  stacks. Ship v1 and Ship next feature raise organic user acquire this
  way so each ship opens ceiling headroom instead of filling the
  reputation-driven churn cap in one lump.
- Abandon — player can drop any in-flight contract, including the starter.
  Already-credited `payoutPerPoint` and `stocks.shipped` stay. Remaining is
  discarded and pulled from Ready, then In Progress, then In Review, then Done. No bonus,
  reputation, or grants. Uniques that were not completed can start again.
- Cancel — drops a **Plan** item. That item's Plan progress is discarded,
  not refunded to Ideas. Other Plan items and in-flight remaining are
  untouched. Different from Abandon.

Availability order: in-flight → already in plan → unique already-completed
→ count floor → specific id → reputation → afford
(`src/engine/projects.ts`). Afford is money `upfrontCost`, and for Pursue
also Ideas < `sizePoints` (same `cannot afford` reason; the row stays
visible). Unmet project prereqs are still returned for next-goal; the
offers list omits those rows the same way the shop omits unmet
`requires`. Extra
in-flight contracts split ship credit equally (`1/n`); they do not slow
factory rates. Project ETAs use that slice, so adding a contract lengthens
the clock and finishing or abandoning one shortens it. The Projects header
says WIP; offer copy has no efficiency formula. `contextSwitchFactor` in
`start.json` is unused.

## `start.json` knobs

`parseStartConfig` is one strict object. Milestone ids must be unique and
`reputation` thresholds strictly ascending. Milestones are one-time log
lines (`state.milestonesSeen`); they never grant effects or gates.
`requiresReputation` on a project is the live gate.

`debtDrag` stays a dedicated tech-debt block (not `stockDrags`, ADR 0005):
`freeDebt`, `dragPerPoint`, `maxDrag` in `(0, 1)`. `stockDrags` are the
generic same-shape slowdown keyed on any stock and a rate target.
`stockFlows` are per-tick acquire/churn after shipping; optional
`condition.minCompletedProjects`. Owned decision `stockFlowMods` and
completed-project `stockFlowMods` add to a matching flow. Omit either
array for `[]`. `stockMax` is an optional per-stock ceiling (Studio:
morale 100, oversight 100). `oversight` is the agent-loop coverage ratio
(`perHuman`, `perAgent`, policy and morale bands, `approachPerDay`).
Decision `oversightMods` multiply the watch or leak weights (harness,
orchestration). `headcountRatioDrags` still drain a stock when a
flagged-instance ratio exceeds `freeBand`; Studio morale does not use it.
`instanceChurn` is a per-active-instance quit roll when a stock is below
`safeBand` (Studio: morale → humans). Pending `delayDays` instances do not
count for either.

Numbers for these knobs live in `content/start.json`. Archetype log lines
(`src/engine/archetypes.ts`) are engine-side; new cards are classified
from their effects automatically.

## Checking your work

`npm run test` parses every era bundle and runs the balance probes in
`src/engine/simulation.test.ts`. Tune JSON against those probes.
`npm run build` type-checks. `make graph` is the
visual check for the decision tree, type flags, challenges, requires /
counts / synergies, and era-entry paths.
