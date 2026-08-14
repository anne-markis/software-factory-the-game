# Content Authoring Guide

This guide is for adding decisions, challenges, and projects to Software
Factory by editing JSON. No TypeScript required. Every claim below is
checked against the loader (`src/engine/content.ts`), the effect engine
(`src/engine/effects.ts`), and the challenge roller (`src/engine/challenges.ts`),
so if something here ever disagrees with those files, the code wins.

## 1. Where content lives, and how it is checked

Human-editable content follows the per-era layout (ADR §2.1 / issue #90):

- `content/start.json` — era-agnostic starting stocks, base rates, seed, first project.
- `content/eras.json` — ordered era ids, starting era, and one-way entry criteria
  (entry predicates are authored for later milestones / the content-graph viewer;
  P0.2 does not advance the player out of Studio).
- `content/eras/<eraId>/decisions.json` — shop cards for that era.
- `content/eras/<eraId>/challenges.json` — random events for that era.
- `content/eras/<eraId>/projects.json` — contracts for that era.
- `content/eras/<eraId>/meta.json` — optional id/name/blurb for authoring tools.

P0.2 ships Studio filled and empty Company / Megacorp shells. The loader
(`loadShippedContent` / `loadActiveContent`) merges `start` + the **active**
era only; tick stays graph-dumb and never hardcodes era names or advances
eras this milestone.

Run `make graph` from the repository root to open the local authoring viewer
under `tools/content-graph/`. It shows the parsed era, decision, prerequisite,
synergy, cost, and entry-path graph without adding anything to the player UI.

Every file is parsed through a Zod schema in `src/engine/content.ts`
(`parseStartConfig`, `parseErasConfig`, `parseDecisions`, `parseChallenges`,
`parseProjects`).
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
- `category` (string, required) - one of five fixed values (`DecisionCategory`
  in `src/engine/types.ts`). This is a closed enum, not free-form, and the
  loader rejects an unknown value or a missing field outright. It controls
  which section of the "Alter the loop" shop
  (`renderDecisions` in `src/ui/render.ts`) the decision renders under, so
  players can find levers for the stock they care about instead of reading
  every entry in one flat list. The five values, in shop display order,
  and their player-facing meaning:
  - `"ship-faster"` ("Ship faster (points/day)") - speeds up `pull`,
    `finish`, or `deploy` (hires, tooling, agents, process tweaks).
  - `"earn-income"` ("Earn income (budget)") - adds `incomePerDay` or
    otherwise grows budget directly (`subscription`, `one-time-product`).
  - `"tame-debt"` ("Tame tech debt (debt and incident risk)") - reduces
    `modifyDebtMultiplier` or otherwise manages tech-debt growth
    (`test-suite`, `agent-harness`, `agent-orchestration`).
  - `"prevent-trouble"` ("Prevent trouble (events and gambles)") - improves
    gamble odds or closes off a challenge's `condition` (`eng-manager`,
    `ddos-protection`).
  - `"change-structure"` ("Change the loop (structure)") - alters the
    pipeline's stage structure itself, not just a rate (`ci-cd`'s
    `continuousDeploy` marker effect).
  A section only renders when at least one of its decisions is currently
  visible in the shop (owned-unique and missing-`requires` entries are
  filtered out first, same as before categorization); an empty category
  produces no header. Pick the category by what the decision *does*, not
  by which build it seems to belong to; challenge eligibility is authored
  separately through live ownership conditions.
- Free-form decision `tags` have been removed from the schema. The strict
  loader rejects that legacy field; use `category` for shop layout and
  challenge `requiresAnyDecision` for ownership-based eligibility.
- `human` (boolean, optional) - marks the decision as a human developer.
  This is what challenges' `minHumanDevs`/`maxHumanDevs`/`perHumanDev`
  count against (see `humanDevInstances` in `src/engine/challenges.ts`).
  Only `basic-dev` sets this today.
- `cost` (object, required, may be `{}`) - `oneTime` (number >= 0,
  optional) charged once at purchase, and/or `perDay` (number >= 0,
  optional) charged every tick while owned. A decision with neither is
  free to acquire; no shipped Studio card is, but the shape is supported.
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
- `requiresCounts` (array, optional) - the same kind of gate as `requires`,
  but counting instances instead of just presence: each entry is
  `{ id, count }` (count an int >= 1) and demands at least `count` owned
  instances of `id`. Composes with `requires` - both must hold - and the
  shop's lock reason spells the count out ("requires 2x Add coding agent"),
  since "requires Add coding agent" would read as already satisfied to a
  player who owns one. Only useful against a stackable (non-`unique`) def:
  a count above 1 on a `unique` id can never be satisfied, so the loader
  rejects it, as it does an id that names no decision in the file.
  `agent-orchestration` uses it today (`{ "id": "agent", "count": 2 }`) -
  a planner needs at least two agents to have anything to coordinate.
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
apply the synergy to instances already owned. Which provider (if any) a
purchase matched is recorded on the instance as `appliedSynergyIfOwned`,
which is how the `shifting-the-burden` archetype tells a synergy that
really lowered an instance's debt from a provider that merely happens to
be owned now (see `src/engine/archetypes.ts`).

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
- A repeatable, `unique: false` (or `unique` omitted) "action" purchase -
  one whose effects are a temporary slowdown plus an immediate stock
  change, like `refactoring-sprint` and `redesign-rebuild` (Release 16) -
  keeps every instance in the "Owned" list forever, even after its
  temporary `modifyRate` effect expires and it has nothing left to show in
  the Progress loop panel. There is no mechanism today for an instance to
  remove itself once its temporary effect lapses; a finished instance just
  reads as history ("you did this, twice") rather than being pruned. This
  is accepted behavior, not a bug to work around when authoring similar
  content.

## 3. The effect vocabulary

All eight effect types live in one discriminated union
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
`techDebt`, `reputation`. `value` can be negative (a cost, like `ddos`'s
`-100` budget hit, or a reputation hit like `prod-incident`'s `-2` or
`security-breach`'s `-5`) or positive (a windfall, like `scope-creep`'s
`+75` backlog or `cloud-credits`'s `+250` budget). The result is clamped
at a minimum of 0 (`Math.max(0, ...)`), so you cannot drive a stock
negative - reputation floors at 0 exactly like every other stock, it does
not go negative under a bad enough run of incidents. See section 7 for
reputation specifically: how it's earned, spent, and used to gate
content.

### `scaleStock`

```json
{ "type": "scaleStock", "stock": "techDebt", "factor": 0.7 }
```

`stock` is the same closed enum as `addToStock`. `factor` is a
multiplier, not a delta: the stock becomes `stock * factor`, clamped at a
minimum of 0 (same `Math.max(0, ...)` as `addToStock`). It applies
**immediately, at purchase**, exactly like `addToStock` - there is no
`durationDays`, and it creates no `Modifier`, so it never shows up as a
Friction/Cycle-speed/Leak-size contributor in the Progress loop panel; only
a paired `modifyRate` or `modifyDebtMultiplier` effect in the same purchase
would surface there. `factor` must be `>= 0` (`.min(0)` in the schema):
`0` wipes the stock entirely; values above `1` are schema-legal too, for
future content that *grows* a stock proportionally (a challenge doubling
backlog, say), not just content that shrinks one.

The shipped example is `refactoring-sprint`:

```json
{ "type": "scaleStock", "stock": "techDebt", "factor": 0.7 }
```

paying down 30% of current tech debt in one shot, alongside a paired
temporary `modifyRate` slowdown in the same `effects` array (see the
worked example in section 8 for the full entry).

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

### `removeHuman`

```json
{ "type": "removeHuman" }
```

No parameters. Removes one owned decision instance whose def has
`human: true`, and strips every modifier whose `source` is that
instance id. Prefer `EffectContext.instanceId` when that instance is
still on the roster as a human; otherwise the first human in roster
order. Ignores `removable` (same as payroll failure). Requires
`EffectContext.content`; without content or without any human left,
the effect silently no-ops.

Used by challenge choice options (shipped: `key-dev-poached`'s
`let-them-go`). When a choice option carries `removeHuman`, the
challenge roller pins `PendingChoice.targetInstanceId` at queue time
(per-human roll target if `perHumanDev`, else the first human on
staff), and `resolveChoice` / expiry-default pass that id through.
The loader rejects a choice challenge with a `removeHuman` option
unless `condition.minHumanDevs` is at least 1.

Don't put `removeHuman` on shop decisions; purchase-time application
does not pass `content` in the effect context today, so it would no-op.

### `rampRate`

```json
{ "type": "rampRate", "target": "pull", "perDay": 0.02, "cap": 1.4 }
```

`target` is restricted to `"pull"`, `"finish"`, or `"deploy"` - **`"all"`
is not accepted here** (the schema literally excludes it: a ramp grows
one rate's own additive modifier, not a shared cross-rate one, so it
needs one effect object per rate you want to ramp: the retired
`self-learning-agents` card used three separate `rampRate` effects to grow
all three rates). The modifier starts at
`0` and grows by `perDay` every tick (after expired modifiers are pruned,
before challenges roll) up to `cap`, for as long as the owning decision
instance is owned. It behaves as an ordinary `add`-op modifier once
created, so removing the instance (manual remove or payroll failure)
strips the modifier by source id immediately - the accumulated bonus
drops to zero on removal, it does not decay gradually or persist.

### `continuousDeploy`

```json
{ "type": "continuousDeploy" }
```

No parameters - the schema variant is `.strict()` with only `type`, so any
extra key is rejected. This is a **marker effect**, not a numeric one:
`applyEffects` has a no-op case for it (see the comment there) and it
creates no `Modifier`. Instead, `src/engine/continuousDeploy.ts` exports a
pure `continuousDeployActive(state, content)` that returns true once any
owned decision instance's definition carries a `continuousDeploy` effect in
its base `effects` array (a synergy-selected effects array is deliberately
not consulted - this is meant to be a structural, definition-level
property, not something a purchase-time synergy swap can toggle).

This is a **stage-structure change**, not a rate or stock tweak: when
active, `tick.ts` ships the *entire* `done` stock every tick instead of
throttling it by the `deploy` rate, so nothing queues in Done once it's
live. The `deploy` rate itself still exists and is still computed (other
content could still target it with `modifyRate`), it is simply no longer
consulted for the ship step while continuous deploy is active. The
downstream-first ordering is unchanged: the ship step still runs before
the finish step refills `done`, so a point that finishes into `done` this
same tick ships on the *next* tick, not this one - a point still takes a
full tick to cross each remaining stage.

The shipped example is `ci-cd`: it keeps its temporary
`{ "target": "all", "op": "mul", "value": 0.5, "durationDays": 2 }` setup
slowdown, but its old permanent `{ "target": "deploy", "op": "mul", "value":
1.1 }` speedup is replaced outright by `{ "type": "continuousDeploy" }`.
Because `ci-cd` is `unique: true` and `removable: false`, activation is
permanent in practice once bought - but the engine still derives it from
ownership on every tick rather than caching a flag, so a future
`removable` continuous-deploy-granting decision would correctly toggle
the Done stage structure on removal.

## 4. Anatomy of a challenge

A challenge (`content/challenges.json`) is an object with:

- `id`, `name`, `description` - same role as on decisions.
- `probabilityPerDay` (0 to 1, required) - the base chance this challenge
  fires on a given eligible day.
- `condition` (optional object) - all provided sub-fields must hold for
  the challenge to even be rolled that day:
  - `minHumanDevs` / `maxHumanDevs` (int >= 0) - count of currently-owned
    decision instances whose def has `human: true`.
  - `minTechDebt` (number >= 0) - `state.stocks.techDebt` must be at
    least this.
  - `minDay` (int >= 0) - `state.day` must be at least this (used to keep
    early days quieter).
  - `minCompletedProjects` (int >= 0) - `state.completedProjects` must be at
    least this. The progress-shaped alternative to `minDay` for holding an
    event back through the opening stretch: `scope-creep` uses
    `minCompletedProjects: 1` so a client cannot "just remember" a few
    requirements before there is a shipped product to bolt them onto,
    however long that first project takes.
  - `requiresAnyDecision` (non-empty string array) - decision def ids. The
    condition is true while at least one currently-owned instance has any
    listed id. Ownership is evaluated live, so a later ladder card can keep
    the condition true after an earlier prerequisite is removed. Every id
    must exist in `decisions.json`, or `validateContentGraph` rejects the
    content.
  - `lacksDecision` (string) - a decision def id: the challenge only fires
    while no currently-owned instance has this def id (evaluated live).
    This is the counterpart to `requiresAnyDecision`/`minHumanDevs`, which
    gate on *owning* something - `lacksDecision` gates on *not* owning
    something, for content that lets the player buy their way out of a
    challenge entirely. No shipped challenge uses it today; the retired
    `ddos` event is the shape to copy:
    `"condition": { "minDay": 15, "lacksDecision": "ddos-protection" }`,
    paired with a `ddos-protection` decision with no direct rate or debt
    effects, whose only job is to make this condition false once owned,
    permanently removing `ddos` from the challenge pool for the rest of
    that game. The referenced id must name
    a real decision in `content/decisions.json`; this is checked by
    `validateContentGraph` (see section 5) rather than by `parseChallenges`
    itself, since challenge parsing alone has no access to the decisions
    file to cross-reference against.
- `probScaling` (optional) - `{ stat: "techDebt", per, add }` (only
  `"techDebt"` is supported today). Adds
  `floor(techDebt / per) * add` to `probabilityPerDay`, capped at 1
  overall. No shipped challenge scales today; the retired `prod-incident`
  used `{ "per": 500, "add": 0.01 }`, i.e. every 500 tech debt added
  another 1% to its daily chance.
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

### Global event spacing (`challengeSpacingDays`)

`challengeSpacingDays` (int >= 0, `content/start.json`, not
`challenges.json`) is a single global pacing knob, not a per-challenge
setting: once *any* challenge fires (effects applied, or a choice queued),
*no* challenge may fire again until `challengeSpacingDays` days have
passed, regardless of which challenge fired or which one would fire next.
The clock is `state.lastChallengeDay`, updated on every fire; the gap check
runs once per tick, before the roll loop, so a tick either rolls nothing
(gap active) or rolls challenges in array order until the first one fires
and then stops (`rollChallenges` in `src/engine/challenges.ts`) - at most
one event per day either way, and the shipped value of `50` spaces
distinct events out by roughly 50 days on average, not per day. An
expiry-default (a pending choice that times out unresolved) still applies
during the gap - it is not itself a new roll, so it does not extend or
reset the gap - and a fresh game's first ever fire is never blocked, since
`lastChallengeDay` starts undefined. Setting `challengeSpacingDays: 0`
disables the gap entirely and restores the pre-Release-9 behavior where
multiple challenges can fire on the same day, which is what the
per-challenge `cooldownDays` and roll-independence tests in
`src/engine/challenges.test.ts` use to isolate cooldown behavior from
spacing. Raising or lowering this one number is the fastest way to make
the whole game's event cadence gentler or busier without touching any
individual challenge's `probabilityPerDay`.

## 5. Integrity rules the loader enforces

From `parseDecisions` (`content/decisions.json`):

- Schema is strict: unknown/misspelled keys fail the whole file.
- `category` is required and must be one of the five `DecisionCategory`
  values (section 2) - missing it, or a typo'd value, fails the whole
  file, the same as any other strict-schema violation.
- Duplicate `id` across entries is rejected.
- A `gamble` table's probabilities must sum to `1` (tolerance `1e-9`).
- Every `requires` id must name another decision id present in the file.
- Every `requiresCounts[].id` must name another decision id present in the
  file, and its `count` must be an int >= 1 - and above 1 only for a
  non-`unique` id, since a unique def can never reach two instances.
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
- Every id in `condition.requiresAnyDecision`, and the id in
  `condition.lacksDecision`, is checked against the decisions file by
  `validateContentGraph`, a separate pass that runs after all four files
  are parsed (not inside `parseChallenges` itself, since challenge parsing
  alone has no access to `content/decisions.json`). An unknown id throws,
  naming both the offending challenge and `content/challenges.json`.

From `parseProjects` (`content/projects.json`):

- Schema is strict.
- Duplicate `id` across entries is rejected.
- (There is no id-based prerequisite here - see section 6, `requiresCompleted`
  is a plain count, not a reference to another project's id.)

`start.json` is a single strict object (`parseStartConfig`); there's no
duplicate-id or cross-reference concern there, just the field types and
minimums (e.g. `contextSwitchFactor` must be `> 0` and `<= 1`).

### The `debtDrag` config (tech-debt drag)

`start.json` carries a `debtDrag` block (Release 15) that makes the
tech-debt stock push back on throughput -- the "Limits to Growth" loop:
the faster you ship, the more debt you accumulate; the more debt you
carry, the slower you ship.

```json
"debtDrag": { "freeDebt": 400, "dragPerPoint": 0.00015, "maxDrag": 0.4 }
```

- `freeDebt` (>= 0) - a grace band. Tech debt at or below this value
  costs nothing; the drag multiplier is exactly `1`.
- `dragPerPoint` (> 0) - how much each point of debt *above* `freeDebt`
  slows every rate.
- `maxDrag` (in the open interval `(0, 1)`) - the hard cap on the
  slowdown, so the drag can never zero out (or reverse) throughput.

The multiplier (`debtDragMultiplier` in `src/engine/modifiers.ts`, a
pure function) is:

```
1 - min(maxDrag, max(0, techDebt - freeDebt) * dragPerPoint)
```

`effectiveRate` applies it to all three rates, multiplying alongside the
context-switch tax, so it is felt on `pull`, `finish`, and `deploy`
simultaneously (and therefore in the outer Delivery loop via those
rates). The felt curve with the shipped values: no drag until debt
passes 400; then a gentle linear slide -- at ~2000 debt the multiplier
is ~0.76 (24% of capacity cancelled); the slowdown never exceeds 40%
(`maxDrag`), reached around 3067 debt. Because `techDebt` only ever
grows in the current model (shipped points regenerate it, nothing pays
the stock down -- decisions like `test-suite` slow the *rate* of growth,
not the stock), the drag is a slow, one-way tightening that a
high-volume build eventually feels no matter what; debt mitigation buys
time and a gentler slope, not immunity.

The Progress loop panel (`src/ui/inProgressPanel.ts`) surfaces the drag
as a Friction node (`Tech debt drag x0.76`) once the multiplier drops
below 1, next to the context-switch tax, so the player can see the
pushback as it engages.

Tuning: raising `freeDebt` widens the no-drag window; lowering
`dragPerPoint` flattens the slope; lowering `maxDrag` caps the worst
case. The shipped values keep both viability-bar strategy probes
(human-heavy, automation-heavy) completing multiple projects and solvent
across 2000 days while making the debt-blind greedy build visibly
degrade -- see the probes in `src/engine/simulation.test.ts`.

### Archetype narration is engine-side, not content

The systems-thinking narration lines the game logs -- "Limits to
growth..." and "Shifting the burden..." (`src/engine/archetypes.ts`) --
are detected by the engine from state and the debtDrag config, not
authored in any content file. They fire at most once per game, their
thresholds derive from the same `debtDrag` numbers above (e.g. the
limits-to-growth line fires when the drag passes halfway to `maxDrag`),
and their decision classifications are derived from decision effects
(which decisions raise vs. lower the debt multiplier), so new content is
picked up automatically. There is no content hook to add or reword these
today; treat them as an engine feature. If a future release wants
content-authored archetype lines, that's a deliberate extension, not a
gap in this guide.

### `stocks.reputation` and the `milestones` array (Release 17)

`stocks.reputation` is the starting value of the reputation stock, same
shape as every other entry in `stocks` (`stocksSchema` in `content.ts`):
a plain number, `>= 0`. The shipped value is `0` - a new build starts
with no reputation and earns its way up via completed contracts (section
7 covers the full loop).

`milestones` is a sibling array (not nested under `stocks`) of named
reputation thresholds that produce one-time narrative log lines as the
player crosses them - nothing mechanical hangs off a milestone, only a
log entry. Each entry is:

```json
{ "id": "trusted", "reputation": 5, "name": "Trusted vendor", "message": "Milestone: Trusted vendor. Bigger contracts are opening up." }
```

- `id` (string, required) - unique key; `parseStartConfig` rejects a
  duplicate id across the array, the same set `detectMilestones` (section
  below) uses to track which milestones have already fired.
- `reputation` (number >= 0, required) - the threshold. `parseStartConfig`
  also rejects a non-strictly-ascending sequence: each entry's
  `reputation` must be strictly greater than the previous entry's, so
  `milestones` must be written in threshold order. The shipped four -
  `trusted` at 5, `established` at 15, `leader` at 35, `titan` at 70 -
  already are, and line up with the `requiresReputation` tiers on
  `big-migration`/`mobile-app` (5) and `enterprise-replatform` (15) in
  `content/projects.json`.
- `name` (string, required) - a short label for the milestone.
- `message` (string, required) - the full line written to the event log
  the first tick reputation reaches `reputation`.

Milestones are sticky, one-time banners: once reached, `detectMilestones`
(`src/engine/milestones.ts`) records the id in `state.milestonesSeen` and
never logs it again, even if reputation later drops back below the
threshold (from a `prod-incident` or `security-breach` hit, say) and
re-crosses it a second time going up. They mark "ever reached," not
"currently above" - unlike `ProjectDef.requiresReputation` (section 7),
which is a live, re-checked gate that re-locks on a downward recross,
milestones only ever fire once and then stay silent for the rest of that
game. They are purely narrative: a milestone never grants an effect,
never gates a purchase or a project, and never ends the game.

### Milestone narration is engine-side, not content

Like the archetype narration above, milestone detection itself is not
something you author beyond the thresholds and copy in `start.json`.
`detectMilestones` runs every tick, checking every not-yet-seen milestone
against `state.stocks.reputation` and logging + recording the first one
whose threshold is met; there is no separate "milestone" effect type in
the effect vocabulary (section 3), and no content hook to make a
milestone do anything beyond writing its `message` to the log. Adding a
new milestone is exactly one array entry in `start.json` - `id`,
`reputation`, `name`, `message` - with nothing to wire up in code.

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
  "reputationReward": 5
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
- `reputationReward` (required, >= 0) - reputation credited once, in
  addition to the completion bonus, when the project's `remaining` reaches
  (approximately) zero (`attributeShipped` in `src/engine/tick.ts`). Every
  project must set this - the schema has no default - though `0` is legal
  for a project that shouldn't move the reputation stock at all.
- `requiresReputation` (optional, >= 0) - a reputation floor gating this
  project's availability, on top of `requiresCompleted` when both are set
  (both must hold). Checked by `projectAvailability`
  (`src/engine/projects.ts`) right after the `requiresCompleted` check and
  before the affordability check. See section 7 for why this is
  live-recomputed on every call rather than a one-time unlock.

The shipped ladder increases `upfrontCost`, `payoutPerPoint`,
`completionBonus`, and `reputationReward` together as `requiresCompleted`
rises (`small-crm` at tier 0 with no reputation requirement;
`big-migration`/`mobile-app` at tier 1, both `requiresReputation: 5`;
`enterprise-replatform` at tier 2, `requiresReputation: 15`), so later
contracts pay noticeably better per point - and reward more reputation -
once the player has proven they can finish one and hasn't burned their
standing back down. Multiple projects can be in flight at once; starting
an additional one applies the context-switch tax
(`contextSwitchFactor ^ (n - 1)`) to all rates, so stacking projects
trades raw throughput for parallel income streams.

## 7. Reputation: a second reinforcing loop

Reputation (`stocks.reputation` in `start.json`, `Stocks.reputation` in
`src/engine/types.ts`) is a stock like any other in the `addToStock`/
`scaleStock` sense (section 3), but it isn't part of the backlog to
delivery pipeline - nothing in the loop diagram feeds it directly. Three
content-authored pieces make up its loop:

- Earned via `ProjectDef.reputationReward` (section 6, required on
  every project), paid once when a project completes, alongside the
  completion bonus: `state.stocks.reputation += p.reputationReward` in
  `attributeShipped` (`src/engine/tick.ts`). `start.json`'s
  `initialProject` (`first-contract`) also carries a `reputationReward`
  (`1` shipped) for the same reason - it is a project like any other for
  payout purposes.
- Spent the same way any stock is damaged: an `addToStock` effect with
  a negative `value` on the `reputation` stock. Two shipped challenges do
  this today - `prod-incident` (`-2`, alongside a budget hit and a 3-day
  rate slowdown) and `security-breach` (`-5`, alongside a `-300` budget
  hit, gated on `condition.minTechDebt: 800`). Like every stock, it's
  clamped at a minimum of 0, so a bad enough run of incidents flattens it
  rather than driving it negative.
- Gates contracts via `ProjectDef.requiresReputation` (section 6,
  optional): `projectAvailability` (`src/engine/projects.ts`) checks it
  alongside `requiresCompleted` - both conditions must hold when both are
  set - after the completed-projects check and before the affordability
  check. This check is live-recomputed on every call, not cached at the
  moment a tier first unlocks: if reputation later drops back below a
  project's `requiresReputation` threshold (from a `prod-incident` or
  `security-breach` hit), that project disappears from the startable list
  again immediately, with no extra mechanism required to re-lock it.

Put together, this is a reinforcing loop with a downward spiral built in:
completing projects raises reputation, which unlocks higher-paying,
higher-`reputationReward` contracts (section 6's ladder), whose
completion raises reputation further. But the same tech debt that
`debtDrag` (section 5) already uses to slow throughput also feeds this
loop's dark side: `prod-incident`'s `probScaling` makes it fire more often
as debt climbs, and `security-breach` doesn't even enter the challenge
pool until `techDebt` passes 800 (`condition.minTechDebt: 800`), scaling
up from there via its own `probScaling`. `security-breach` is the sharper
worked example of the spiral: a debt-heavy build is simultaneously the
one climbing fastest toward the reputation tiers that unlock the biggest
contracts, and the one most exposed to a hit that can knock it back below
`requiresReputation` and re-lock the very contract it was relying on -
the reputation loop mirrors the tech-debt "limits to growth"/"shifting
the burden" dynamic (section 5) one level up, on the contracts layer
instead of the raw-throughput layer.

## 8. Worked example

The two examples below are for illustration only - **do not add them to
the actual `content/` files.** They are not part of the shipped game.

### Example decision: "Structure cleanup"

Say you want a one-time-cost decision that temporarily slows all work
while paying down structure, then permanently reduces tech-debt growth -
the same shape as the shipped `test-suite`, at a smaller scale. (This is
distinct from the shipped `refactoring-sprint`/`redesign-rebuild`
decisions, section 3's `scaleStock` example - those pay down the
techDebt *stock* directly instead of touching the accumulation *rate*.
Either shape is legitimate; pick `modifyDebtMultiplier` for a permanent
change to how fast debt regrows, `scaleStock` for a one-shot paydown of
debt already on the books.)

Write the description in terms of the *felt* duration (4 days), then
remember the purchase-time-timing note from section 3: a felt duration of
N days needs `durationDays: N + 1`.

```json
{
  "id": "structure-cleanup",
  "name": "Structure cleanup",
  "description": "Slows all work 40% for 4 days while the team pays down structure. Permanently cuts tech debt accumulation by 20%.",
  "category": "tame-debt",
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
- `category: "tame-debt"` puts it in the "Tame tech debt" shop section
  alongside `test-suite`, `agent-harness`, `swarm-orchestrator`,
  `refactoring-sprint`, and `redesign-rebuild` - matching what it does
  (cuts debt accumulation).

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

## 9. Balance guardrails

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
  exposed to (check the `shoppingList` arrays and ownership conditions in
  `simulation.test.ts` against your new content's ids), rerun
  the tests and watch for `everBroke` flipping to `true` or
  `completedProjects` dropping below 2.
- **Greedy strategy** - buys everything affordable every day; only
  checks engine invariants (no negative or non-finite stocks), not
  solvency - it's explicitly documented as not meant to be viable.
- **Upgrades matter** and **stall reachability** - narrower mechanism
  checks (test-suite reduces tech debt vs. idle; an empty, zeroed-out
  content set can actually reach and stay in a stalled state).
- **Agent ladder payoff** (the two `agent ladder` probes) - these pin the
  reason `start.json`'s `baseRates` are asymmetric (`pull: 2` against
  `finish: 1`, `deploy: 1`). Throughput is the *minimum* across the three
  stages, so a card that only lifts `finish` buys nothing unless some
  other stage has headroom above it: with all three base rates equal, the
  whole finish-side agent ladder shipped exactly as many points as an idle
  factory while charging full upkeep. The pull surplus is what the ladder
  spends, and `test-suite` -> `ci-cd` (continuous deploy) is what clears
  the deploy wall behind it. Before touching `baseRates`, or before adding
  a card that lifts one stage in isolation, check which stage is binding
  first - the probes assert both halves of that story (bottleneck moves
  from finish to deploy without ci-cd; roughly double throughput with it).

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
