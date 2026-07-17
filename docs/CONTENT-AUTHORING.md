# Content Authoring Guide

This guide is for adding decisions, challenges, and projects to Software
Factory by editing JSON. No TypeScript required. Every claim below is
checked against the loader (`src/engine/content.ts`), the effect engine
(`src/engine/effects.ts`), and the challenge roller (`src/engine/challenges.ts`),
so if something here ever disagrees with those files, the code wins.

## 1. Where content lives, and how it is checked

Human-editable content is three JSON files, plus one config file:

- `content/start.json` - starting stocks, base rates, the seed, the first project.
- `content/decisions.json` - things the player can buy to alter the loop.
- `content/challenges.json` - random events.
- `content/projects.json` - contracts the player can start.

Every file is parsed through a Zod schema in `src/engine/content.ts`
(`parseStartConfig`, `parseDecisions`, `parseChallenges`, `parseProjects`).
The schemas are declared `.strict()`, which means an unknown or misspelled
key is a hard error, not a silently-ignored typo. When something is wrong,
the loader throws with the file name and the offending entry's id, for
example:

```
Invalid content in content/decisions.json: gamble for "basic-dev" sums to 0.95, expected 1
```

You do not need to launch the game to check your edits. The test suite
loads all four content files as part of the simulation tests, so running

```
npm run test
```

parses everything and fails loudly on any schema violation, duplicate id,
or broken cross-reference, in a few seconds, without opening a browser.

## 2. Anatomy of a decision

A decision (`content/decisions.json`) is an object with these fields:

- `id` (string, required) - unique key. Duplicate ids across the file are
  rejected at load.
- `name` (string, required) - shown as the button label and in the "Owned"
  list.
- `description` (string, required) - shown under the buy button and echoed
  into the event log when the decision has no gamble table.
- `tags` (string array, required) - free-form labels (`"process"`,
  `"human"`, `"solo"`, `"darkfactory"` are the ones shipped today). Tags
  drive challenges' `hasTag` condition (section 4) - a tag only "counts"
  while at least one owned decision instance carries it.
- `human` (boolean, optional) - marks the decision as a human developer.
  This is what challenges' `minHumanDevs`/`maxHumanDevs`/`perHumanDev`
  count against (see `humanDevInstances` in `src/engine/challenges.ts`).
  Only `basic-dev` and `senior-dev` set this today.
- `cost` (object, required, may be `{}`) - `oneTime` (number >= 0,
  optional) charged once at purchase, and/or `perDay` (number >= 0,
  optional) charged every tick while owned. A decision with neither (like
  `support-retainer`) is free to acquire.
- `incomePerDay` (number >= 0, optional) - credited every tick while
  owned. All income across all owned decisions is credited before any
  payroll is charged that same tick, so a decision's own income can save
  it (or another decision) from payroll failure that tick.
- `effects` (array, required, may be `[]`) - the baseline effects applied
  once, immediately, at purchase. See section 3 for the effect
  vocabulary.
- `gamble` (array, optional) - a probability table rolled **once, at the
  moment of purchase**, not repeatedly. Each entry is
  `{ probability, label, effects }`. The probabilities across the table
  must sum to `1` (within `1e-9`); the loader rejects the file otherwise,
  naming the offending decision id. `effects` on the base object still
  apply in addition to whichever gamble outcome is drawn.
- `requires` (string array, optional) - decision ids that must already be
  owned before this one is purchasable. All listed ids must be owned (not
  just one). Every id must exist elsewhere in `decisions.json`, or the
  loader rejects the file.
- `removable` (boolean, required) - whether the player can manually remove
  an owned instance from the "Owned" panel. This only gates the manual
  Remove button; it does **not** protect a `perDay`-cost decision from
  being removed automatically when payroll fails (see below) - that
  removal path ignores `removable` entirely.
- `unique` (boolean, optional) - if true, once one instance is owned the
  decision disappears from the shop entirely (it is filtered out, not
  just disabled) until/unless it is removed.
- `synergies` (array, optional) - see below.

### Gamble timing

The roll happens exactly once, when `applyDecision` runs, using the
shared seeded RNG stream. It is not re-rolled on later ticks, and it is
not re-rolled if the instance becomes sick. The chosen outcome's `label`
is stored on the instance and shown next to its name in the "Owned" list
(e.g. `Hire basic developer [Strong hire]`), and its `effects` are applied
alongside the decision's base `effects` at that same moment.

### Synergies replace, they do not add

```json
"synergies": [
  { "ifOwned": "eng-manager", "gamble": [ ... a full replacement table ... ] }
]
```

At purchase time, the engine looks for the **first** synergy entry (in
array order) whose `ifOwned` decision is currently owned. If one matches,
its `effects` field (if present) entirely replaces the base `effects` for
this purchase, and its `gamble` field (if present) entirely replaces the
base `gamble` table for this purchase - they do not merge with, or add
to, the base tables. If the matching synergy entry omits `effects` (or
`gamble`), that field falls back to the base decision's value. Concretely,
for `basic-dev` with `eng-manager` owned, the synergy supplies a full
four-outcome gamble table with better odds (0.55/0.30/0.13/0.02 vs. the
base 0.5/0.25/0.2/0.05) - **write out the whole table**, not just the
outcomes that changed. If you own more than one potential synergy
provider, only the first one listed in the `synergies` array is used; the
rest are ignored for that purchase.

Synergy ownership is checked once, at purchase. Removing the synergy
provider later does not revert instances already purchased under it, and
buying the synergy provider *after* the decision does not retroactively
apply the synergy to instances already owned.

### Unique, removable, and payroll failure

- `unique: true` decisions vanish from the shop list once one instance is
  owned (`already-owned` in `availability()`); they cannot be repurchased
  unless removed first.
- `removable: false` decisions never show a Remove button, and
  `removeDecision` throws if called on one anyway.
- Any decision with a `cost.perDay` is charged every tick in
  `chargeUpkeep()` (`src/engine/tick.ts`). If the player's budget cannot
  cover that day's `perDay` charge, the instance is deleted permanently
  (not just paused) and its modifiers are stripped - regardless of its
  `removable` flag. This is the game's only insolvency mechanism; budget
  itself is clamped at 0 rather than going negative.

## 3. The effect vocabulary

All five effect types live in one discriminated union
(`src/engine/effects.ts` + the `effectSchema` in `content.ts`). Every
effect object is `.strict()`, so extra or misspelled keys are rejected.

### `modifyRate`

```json
{ "type": "modifyRate", "target": "deploy", "op": "mul", "value": 1.1 }
```

`target` is one of `"pull"`, `"finish"`, `"deploy"`, or `"all"` (which
applies to all three rates at once, internally as a single shared
modifier). `op` is `"add"` (adds a flat amount to the rate) or `"mul"`
(multiplies the rate). `value` is any number. `durationDays` is optional;
omit it for a permanent effect (this is how `ci-cd`'s permanent deploy
speedup is written: `{ "target": "deploy", "op": "mul", "value": 1.1 }`,
no `durationDays`).

**Timing note (important, and easy to get wrong):** a modifier's
`expiresDay` is `state.day + durationDays`, and expired modifiers are
pruned at the *start* of the tick they expire on, before that tick's
flows run. A modifier applied at purchase time (between ticks) is
therefore live for `durationDays - 1` subsequent ticks, while one applied
mid-tick by a challenge is live for the full `durationDays` ticks
including the one it fires on. `test-suite`'s effect is
`{ "target": "all", "op": "mul", "value": 0.5, "durationDays": 6 }` and its
description says "Slows all work 50% for 5 days" - the shipped content
already accounts for the off-by-one, so **a purchase-time slowdown you
want felt for N days should be written with `durationDays: N + 1`**.
Challenge effects do not need the `+ 1`; `prod-incident`'s
`durationDays: 3` really is felt for 3 days because it applies mid-tick.

Per rate, all `add`-op modifiers are summed first, then all `mul`-op
modifiers are applied on top of that sum (`src/engine/modifiers.ts`,
`effectiveRate`), and the context-switch tax is applied last.

### `modifyDebtMultiplier`

```json
{ "type": "modifyDebtMultiplier", "op": "mul", "value": 0.5 }
```

Same `op`/`value`/optional-`durationDays` shape as `modifyRate`, but there
is no `target` - it scales the multiplier that converts shipped points
into tech-debt (and backlog) regrowth. `test-suite` uses this permanently
(no `durationDays`) to halve future tech-debt accumulation, alongside its
temporary `modifyRate` slowdown in the same `effects` array.

### `addToStock`

```json
{ "type": "addToStock", "stock": "budget", "value": -100 }
```

`stock` is one of `backlog`, `inProgress`, `done`, `shipped`, `budget`,
`techDebt`. `value` can be negative (a cost, like `ddos`'s `-100` budget
hit) or positive (a windfall, like `scope-creep`'s `+75` backlog or
`cloud-credits`'s `+250` budget). The result is clamped at a minimum of 0
(`Math.max(0, ...)`), so you cannot drive a stock negative.

### `sickness`

```json
{ "type": "sickness", "factor": 0.7, "durationDays": 5 }
```

`factor` must be strictly between 0 and 1 (it multiplies the *add-op*
contribution of one decision instance to a rate while sick; `0.7` means
"30% less output"). `durationDays` is required (positive int/number).

This effect only ever does something when it is applied with an
`instanceId` naming a currently-owned decision instance in the same tick.
That path only exists for challenges with `perHumanDev: true`: the
challenge roller rolls independently per human-dev instance and, if it
fires, applies the effect targeted at that instance. **The loader
enforces this at parse time** - a challenge with a `sickness` effect but
`perHumanDev` not `true` is rejected outright. A `sickness` effect placed
in a *decision's* `effects` (or `gamble` outcome, or `synergy`) array is
schema-legal but functionally inert: `applyDecision` never passes an
`instanceId` through the effect context, so the lookup that would find
the target instance always comes up empty and the effect silently no-ops.
Don't put `sickness` on decisions; it does nothing there.

### `rampRate`

```json
{ "type": "rampRate", "target": "pull", "perDay": 0.02, "cap": 1.4 }
```

`target` is restricted to `"pull"`, `"finish"`, or `"deploy"` - **`"all"`
is not accepted here** (the schema literally excludes it: a ramp grows
one rate's own additive modifier, not a shared cross-rate one, so it
needs one effect object per rate you want to ramp, as `self-learning-agents`
does with three separate `rampRate` effects). The modifier starts at
`0` and grows by `perDay` every tick (after expired modifiers are pruned,
before challenges roll) up to `cap`, for as long as the owning decision
instance is owned. It behaves as an ordinary `add`-op modifier once
created, so removing the instance (manual remove or payroll failure)
strips the modifier by source id immediately - the accumulated bonus
drops to zero on removal, it does not decay gradually or persist.

## 4. Anatomy of a challenge

A challenge (`content/challenges.json`) is an object with:

- `id`, `name`, `description` - same role as on decisions.
- `probabilityPerDay` (0 to 1, required) - the base chance this challenge
  fires on a given eligible day.
- `condition` (optional object) - all provided sub-fields must hold for
  the challenge to even be rolled that day:
  - `minHumanDevs` / `maxHumanDevs` (int >= 0) - count of currently-owned
    decision instances whose def has `human: true`.
  - `hasTag` (string) - true if any currently-owned decision instance's
    def lists this tag (tags come from `decisions.json`, evaluated live
    against what's owned right now, not what was ever owned).
  - `minTechDebt` (number >= 0) - `state.stocks.techDebt` must be at
    least this.
  - `minDay` (int >= 0) - `state.day` must be at least this (used to keep
    early days quieter; most shipped challenges gate on `minDay: 15`).
- `probScaling` (optional) - `{ stat: "techDebt", per, add }` (only
  `"techDebt"` is supported today). Adds
  `floor(techDebt / per) * add` to `probabilityPerDay`, capped at 1
  overall. `prod-incident` uses `{ "per": 500, "add": 0.01 }`: every 500
  tech debt adds another 1% to its daily chance.
- `effects` (array, required) - applied when the challenge fires, unless
  it has a `choice` block (see below), in which case `effects` **must**
  be `[]` - the loader rejects a challenge that defines both, since the
  engine queues the choice and never applies the top-level effects, which
  would otherwise be silent content loss.
- `perHumanDev` (boolean, optional) - if true, the challenge is rolled
  independently once per owned human-dev instance (keyed by
  `challengeId:instanceId`) rather than once for the whole game. Required
  (and enforced) if any of its effects is `sickness`.
- `choice` (optional object) - `{ options, defaultOptionId, expiresInDays }`.
  `options` is a non-empty array of `{ id, label, effects }`.
  `defaultOptionId` must match one of the `options`' ids (checked at
  load). When the challenge fires, nothing is applied immediately; a
  pending choice is queued for `expiresInDays` days. If the player
  resolves it, that option's effects apply. If it expires unresolved, the
  `defaultOptionId` option's effects apply automatically - "doing
  nothing" always resolves to a concrete, authored outcome, never a
  silent no-op.
- `cooldownDays` (optional int > 0) - once fired, the challenge cannot
  fire again until this many days later. For a plain (non-choice)
  challenge, the cooldown clock starts the instant it fires. For a choice
  challenge, the cooldown clock does **not** start when the choice is
  queued - it starts when the choice is resolved (by the player) or
  defaulted (by expiry). A choice challenge sitting unresolved does not
  block itself from re-firing on its own (the roller does skip re-queuing
  a challenge that already has a pending choice, via a separate one-at-a-
  time check), but its cooldown window doesn't begin ticking until the
  pending choice is closed out one way or another.

### Rolls are deterministic and per-challenge

Each non-`perHumanDev` challenge rolls via
`hashRoll(state.gameSeed, state.day, def.id)` - a stateless hash keyed by
the game's seed, the current day, and the challenge's own id - rather
than drawing from the shared RNG stream. `perHumanDev` challenges add the
instance id to the hash key. Practically, this means **adding a new
challenge (or reordering existing ones) never changes which days any
other, already-shipped challenge fires on** - each challenge's roll only
depends on its own id, the seed, and the day. (Decision purchase gambles
are a separate mechanism and still draw from the shared RNG stream, so
adding a decision can shift later purchase-gamble outcomes if it's bought
before them in the same playthrough - but that's about play order, not
content-file order.)

## 5. Integrity rules the loader enforces

From `parseDecisions` (`content/decisions.json`):

- Schema is strict: unknown/misspelled keys fail the whole file.
- Duplicate `id` across entries is rejected.
- A `gamble` table's probabilities must sum to `1` (tolerance `1e-9`).
- Every `requires` id must name another decision id present in the file.
- Every `synergies[].ifOwned` id must name another decision id present in
  the file.

From `parseChallenges` (`content/challenges.json`):

- Schema is strict.
- Duplicate `id` across entries is rejected.
- If `choice` is present, `choice.defaultOptionId` must match one of
  `choice.options[].id`.
- A challenge cannot have both `choice` and non-empty top-level `effects`.
- Any `effects` entry of `type: "sickness"` requires `perHumanDev: true`
  on the same challenge.
- `rampRate` effects (wherever they appear, decisions or challenges)
  cannot target `"all"` - only `"pull"`, `"finish"`, `"deploy"` are
  accepted by the schema.

From `parseProjects` (`content/projects.json`):

- Schema is strict.
- Duplicate `id` across entries is rejected.
- (There is no id-based prerequisite here - see section 6, `requiresCompleted`
  is a plain count, not a reference to another project's id.)

`start.json` is a single strict object (`parseStartConfig`); there's no
duplicate-id or cross-reference concern there, just the field types and
minimums (e.g. `contextSwitchFactor` must be `> 0` and `<= 1`).

## 6. Adding a project

A project (`content/projects.json`) is:

```json
{
  "id": "small-crm",
  "name": "Small CRM build",
  "sizePoints": 5000,
  "upfrontCost": 2000,
  "payoutPerPoint": 21,
  "completionBonus": 1500,
  "requiresCompleted": 1
}
```

- `sizePoints` (> 0) - added to `backlog` when the project starts.
- `upfrontCost` (>= 0) - charged from budget when the project starts.
- `payoutPerPoint` (>= 0) - revenue per shipped point while this project
  is the oldest one in flight (projects are paid FIFO: shipped points are
  attributed to the longest-running project first, and its completion
  bonus and removal happen the instant its `remaining` hits ~0).
- `completionBonus` (>= 0) - paid once, in addition to per-point payout,
  when the project's `remaining` reaches (approximately) zero.
- `requiresCompleted` (optional int >= 0) - the number of *total*
  projects the player must have already completed (`state.completedProjects`,
  a running count) before this one is startable. It is **not** a
  reference to a specific project's id - two projects can both set
  `requiresCompleted: 1` and both become available as soon as any one
  project finishes (`big-migration` and `mobile-app` both do this
  today).

The shipped ladder increases `upfrontCost`, `payoutPerPoint`, and
`completionBonus` together as `requiresCompleted` rises (`small-crm` at
tier 0, `big-migration`/`mobile-app` at tier 1, `enterprise-replatform` at
tier 2), so later contracts pay noticeably better per point once the
player has proven they can finish one. Multiple projects can be in flight
at once; starting an additional one applies the context-switch tax
(`contextSwitchFactor ^ (n - 1)`) to all rates, so stacking projects
trades raw throughput for parallel income streams.

## 7. Worked example

The two examples below are for illustration only - **do not add them to
the actual `content/` files.** They are not part of the shipped game.

### Example decision: "Refactoring sprint"

Say you want a one-time-cost decision that temporarily slows all work
while paying down structure, then permanently reduces tech-debt growth -
the same shape as the shipped `test-suite`, at a smaller scale.

Write the description in terms of the *felt* duration (4 days), then
remember the purchase-time-timing note from section 3: a felt duration of
N days needs `durationDays: N + 1`.

```json
{
  "id": "refactoring-sprint",
  "name": "Refactoring sprint",
  "description": "Slows all work 40% for 4 days while the team pays down structure. Permanently cuts tech debt accumulation by 20%.",
  "tags": ["process"],
  "cost": { "oneTime": 350 },
  "effects": [
    { "type": "modifyRate", "target": "all", "op": "mul", "value": 0.6, "durationDays": 5 },
    { "type": "modifyDebtMultiplier", "op": "mul", "value": 0.8 }
  ],
  "removable": false,
  "unique": true
}
```

Walking through it:

- `durationDays: 5` on the `modifyRate` effect gives 4 felt ticks of
  slowdown (`5 - 1`), matching the "4 days" in the description.
- The `modifyDebtMultiplier` effect has no `durationDays`, so the 20% cut
  to debt accumulation is permanent, same pattern as `test-suite`.
- `unique: true` means once bought, it disappears from the shop.
  `removable: false` means it can't be sold back - matching the "permanent
  investment" framing of the description.
- No `requires`, so it's available to every build from day one; no
  `gamble` or `synergies`, since it's a flat, deterministic purchase.

To add it for real, you'd append this object to the array in
`content/decisions.json` (mind the comma with the preceding entry), then
run `npm run test`. `content.test.ts` and `simulation.test.ts` both load
the file through `parseDecisions`, so a typo'd field name or an id
collision fails immediately with the file and entry name. Because it has
no `gamble` and no `synergies`, there's no probability sum or
cross-reference to get wrong. In the running game, it would show up
immediately in the "Alter the loop" shop panel (`renderDecisions` in
`src/ui/render.ts`) with its cost and description under a Buy button, and
after purchase move to the "Owned" panel without a Remove button (since
`removable: false`).

### Example challenge: "Dependency vulnerability"

Say you want a tech-debt-scaled random event: a flat budget hit, more
likely the more debt the player is carrying, on a cooldown so it can't
spam.

```json
{
  "id": "dependency-vulnerability",
  "name": "Dependency vulnerability",
  "description": "A dependency turns out to have a known vulnerability. More likely the more tech debt you carry. Emergency patch costs $180.",
  "probabilityPerDay": 0.01,
  "probScaling": { "stat": "techDebt", "per": 400, "add": 0.01 },
  "condition": { "minDay": 15 },
  "cooldownDays": 45,
  "effects": [
    { "type": "addToStock", "stock": "budget", "value": -180 }
  ]
}
```

Walking through it:

- Base chance is 1%/day, gated to day 15 onward (`condition.minDay: 15`)
  so it doesn't hit a brand-new game, matching the pattern of most
  shipped budget-hit challenges.
- `probScaling` adds another 1% for every 400 tech debt carried
  (`floor(techDebt / 400) * 0.01`), so a debt-heavy build sees this more
  often - the same shape as `prod-incident`, at different constants.
- No `choice` block, so `effects` is allowed to be non-empty; it's a
  flat, unavoidable `-180` budget hit, same shape as `ddos` and
  `api-price-hike`.
- `cooldownDays: 45` starts counting from the moment it fires (this is a
  plain, non-choice challenge, so the clock starts at fire, not at some
  later resolution step).

To add it for real, you'd append it to `content/challenges.json` and run
`npm run test`; the loader checks the schema, the duplicate-id rule, and
(since there's no `choice` and no `sickness` effect here) neither of the
choice/sickness cross-checks apply. In the running game, it fires
silently into the event log (`renderLog`) with its name and description,
the same way `ddos` does today - there's no UI action needed for a
non-choice challenge, it just happens.

## 8. Balance guardrails

`npm run test` includes simulation probes in `src/engine/simulation.test.ts`
that play the full, real content files (`content/*.json`, not fixtures)
through the actual engine for up to 2000 simulated days under a few fixed
strategies, and assert on the outcome. These exist specifically to catch
content changes that break the game's viability floors, not just its
schema validity - a perfectly well-formed new challenge or decision can
still make the game unwinnable, and these tests are what catches that.

They currently check:

- **Idle-drain mechanism** (`idle mechanism: -$5/day glide...`) - pins
  the exact budget trajectory of a player who does nothing, with
  challenges stripped out, using hand-computed arithmetic. This one is
  sensitive to `start.json` constants and the first project's payout.
- **Idle with full content** (`idle with full content...`) - same idle
  player, challenges left in, with looser bounds (budget below a
  threshold at day 300, still positive at day 600, near-zero by day
  2000). Adding a new challenge that's very likely and very punishing
  for a player with zero decisions owned could break this.
- **Smart strategy (mid-tier observation)** - a modest test-suite +
  ci-cd + two-hires build. This one is documented as allowed to go
  broke under full challenge load by design; it only asserts that the
  first contract still gets completed.
- **Human-heavy and automation-heavy strategy probes** - these two *are*
  the viability bar: each must complete at least 2 projects and never
  hit the zero-budget clamp over 2000 days. If you add or rebalance a
  decision or challenge that these shopping lists would buy or be
  exposed to (check the `shoppingList` arrays in
  `simulation.test.ts` against your new content's tags and ids), rerun
  the tests and watch for `everBroke` flipping to `true` or
  `completedProjects` dropping below 2.
- **Greedy strategy** - buys everything affordable every day; only
  checks engine invariants (no negative or non-finite stocks), not
  solvency - it's explicitly documented as not meant to be viable.
- **Upgrades matter** and **stall reachability** - narrower mechanism
  checks (test-suite reduces tech debt vs. idle; an empty, zeroed-out
  content set can actually reach and stay in a stalled state).

If a probe fails after a content edit:

1. Read the comment block directly above the failing `it(...)` first -
   each one documents the specific mechanism or numbers it's pinning and
   why, including the exact arithmetic where it's mechanism-level (the
   idle-drain test) versus "observed value, asserted with headroom" where
   it's a broader viability probe (the strategy probes).
2. Decide whether the new content should really move that number. If a
   new punishing challenge is legitimately supposed to make the idle
   player's life harder, that may be an intentional, expected shift in a
   loose bound (e.g. "budget at day 300" in the idle-with-full-content
   test) - update the asserted threshold and the comment together.
3. If a viability-bar probe (human-heavy or automation-heavy) breaks,
   that's a stronger signal: either tune the new content's numbers
   (probability, cost, effect magnitude) so a sensible build can still
   absorb it, or, if the shopping list in the test doesn't reflect how a
   real player would react to the new content, that's worth flagging
   rather than silently loosening the assertion.
4. Re-run `npm run test` after any change to content or to the probes
   themselves, and keep the in-file comments in sync with whatever
   numbers you end up pinning - the next person editing content depends
   on those comments as much as you just did.
