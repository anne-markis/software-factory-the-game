# Software Factory — authoring context

Living glossary for content authors and maintainers. Product direction lives
in `docs/VISION.md`; how the layers fit lives in `docs/ARCHITECTURE.md`;
schema gotchas live in `docs/CONTENT-AUTHORING.md` (field types are in
`src/engine/content.ts`; shipped cards are in `content/`). Locked
architecture decisions are ADRs 0001–0009 under `docs/adr/`. If this glossary
and the loader disagree, the code in `src/engine/` wins. GitHub tickets are
not authoring context; describe the current system here, not old issues.

## Scale eras (not tracks)

**Eras** are a one-way **scale ladder**: Studio → Company → Megacorp → …
They mark how big the factory is (what it can afford, what problems that
scale invites), not which capability fantasy the player picked.

- **Studio** — short tutorial-scale opening (~$10k start). Hires *and* early
  agents belong here; do not gate “AI” as its own era.
- **Company** — where most playtime will live: same loop, higher cost of
  play, homing in on the dark factory (deeper agentic investment,
  Paperclips autonomy: the fleet staffs itself). Crossing is silent by
  default (heading changes; no Events line; not a next-goal). Floors live
  in `content/eras.json`. Catalog inherits Studio ids (ADR 0008).
  Exponential accelerators (viral acquire, compounding agents, paid-tier
  flow mods) are the next content wave so these gates play as takeoff, not
  a linear sit. Direction in
  [`docs/superpowers/specs/2026-08-14-company-era-brainstorm.md`](superpowers/specs/2026-08-14-company-era-brainstorm.md).
- **Megacorp** — institutional scale. Floors live in `content/eras.json`.
  Intentionally a long-horizon gate until Company accelerators land.

Capability mix (hire-heavy, agent-heavy, process-heavy) **meanders inside**
an era. Crossing an era is irreversible once entry criteria fire. The tick
evaluates the next era’s `entryAnyOf` (OR of AND-floors) and reloads
that era’s bundle; it does not hardcode era names (ADR 0001).

## Retired: tracks, tags, `hasTag`

First-class **tracks** (solo / startup / megacorp / darkfactory as peer
endgames) and the **tag curriculum** (`DecisionDef.tags`,
`ChallengeDef.condition.hasTag`) are retired (ADR 0002). Do not teach
authors to label cards with track affinity. `category` is required authored
metadata; the player shop is a flat list and does not group by it.
Challenge eligibility uses stocks, human headcount, and live decision
ownership.

Historical design docs that still talk about tracks are snapshots, not
authoring instructions.

## Stocks

Every named quantity the engine writes is a **stock** (`Stocks` in
`src/engine/types.ts`). Pipeline stocks: `backlog`, `inProgress`, `done`,
`shipped`. Resource / identity stocks: `budget`, `techDebt`, `reputation`,
`users`, `ideas`, `plan`. All clamp at a minimum of 0. Budget at `$0` freezes `pull` /
`finish` / `deploy` for that tick (in-flight remaining does not burn
down). Day, income netting, and payroll failure still run; delivery
resumes on the next tick after budget is positive again. This is
separate from **stall** (pipeline empty and nothing affordable).

**Users** is the product-growth stock (Studio spine). It stays 0 until the
Launch beta project completes (`completionStockGrants`), then grows via
always-on **stock flows** and can slow delivery via **stock drag**.
Monetization decisions *read* users; they do not invent a second population.

**Ideas** is the idea-to-value pile. It seeds at 100 and fills from day 0
at the `discover` rate (`start.baseRates.discover`, 0.5/day). Discover is
not a pipeline stage, is not frozen at `$0`, and does not scale with
reputation, users, or shipped points. Shop cards raise it with
`modifyRate` `add` targeting `discover` (`all` still means pull/finish/deploy).
Studio: **Hack day** is a repeatable day-0 spend ($500 once): `+50` Ideas
immediately and delivery `x0.3` for one felt day. **User interviews** is a
repeatable day-0 spend ($1000 once) that grants `+200` Ideas and does not
touch delivery, discover, or plan.

**Plan** is named work after Pursue and before Ready. `GameState.plan` holds
items (`id`, `name`, `progress`, `size`); `stocks.plan` is the sum of
progress (the future diagram pile). Plan fills at `start.baseRates.plan`
(1/day), split evenly across named items. Empty Plan still has that
capacity, unused. Shop cards raise it with `modifyRate` `add` targeting
`plan`. Discover cards do not raise plan. Plan is not a pipeline stage,
is not frozen at `$0`, and is not slowed by debt or users-support drag.
When an item’s progress hits size it **auto-enters Ready** (same ledger
write as Start: Ready stock + `ActiveProject.remaining` = size). **Pursue**
(`ProjectDef.pursue: true`) spends Ideas = `sizePoints` (and money
`upfrontCost` if any) and cannot fire when Ideas < size or budget < cost.
**Cancel** drops that Plan item; progress is not refunded to Ideas. Early
**Start** (flag omitted) still writes Ready immediately and does not spend
Ideas. Later-era new contracts are Pursue because they are late/big;
inherited Start gigs stay Start.

Pipeline stage stocks say *where* unshipped work sits. `backlog` is the
Ready queue (waiting to pull), not the cockpit hero metric. Cockpit
**Backlog** is `backlog + inProgress + done` (ADR 0009). In-flight
`ActiveProject.remaining` is the same work attributed to a contract;
injected pipeline work (debt, scope creep) attaches to remaining so it
delays delivery instead of counting as free progress. Users still grant
when remaining hits ~0 (the work has shipped).

## Stock-linked content (generic, not named after fiction)

The engine must not special-case “subscription”, “support load”, or
“users” in the tick. Content points generic fields at a `stock` name
(ADR 0005, schema in ADR 0006):

| Term | Where | Meaning |
| --- | --- | --- |
| **Stock drag** | `start.stockDrags` | Always-on rate slowdown once a stock exceeds a free band. Studio: users above 25 drag all rates (support load). |
| **Stock flow** | `start.stockFlows` | Always-on per-tick acquire / churn on a stock. Studio: organic users after the first project completes. |
| **Stock-flow mod** | `DecisionDef.stockFlowMods` | Owned decision nudges an existing stock flow (additive deltas). Studio ships none. |
| **Income from stock** | `DecisionDef.incomeFromStock` | Per-day income = `stocks[stock] * perUnit`. Studio: subscription reads users. |
| **Burst from stock** | `DecisionDef.burstFromStock` | Probabilistic daily burst = `stocks[stock] * perUnit`. Studio: one-time product reads users. |
| **Completion stock grant** | `ProjectDef.completionStockGrants` (and `start.initialProject`) | On project complete, add `amount` to `stock`. Studio: Launch beta grants +30 users. |

`debtDrag` stays a dedicated tech-debt config (not migrated into
`stockDrags` this cut). Challenge `minTechDebt` stays until a content
rewrite needs generic `minStock` / `maxStock` floors.

## Predicates (JSON-owned gates)

Progression edges live in content, not in TypeScript that knows story beats:

- Decision shop: `requires`, `requiresCounts`, `unique`, cost.
- Challenges: `minHumanDevs` / `maxHumanDevs`, `minTechDebt`, `minDay`,
  `minCompletedProjects`, `requiresAnyDecision`, `lacksDecision`.
- Projects: `requiresCompleted` (count), `requiresCompletedId` (specific
  catalog or start-project id), `unique`, `pursue` (omit = Start),
  `requiresReputation`.
- Era entry (evaluated each tick for the **next** rung only): `entryAnyOf`
  OR of `{ minBudget, minReputation, minCompletedProjects, minUsers }` paths.

`human: true` on a decision is headcount for challenge predicates, not a
track label.

## Content layout

```
content/
  start.json                 # era-agnostic constants, seed stocks, initial project
  eras.json                  # ordered era ids, startingEraId, entryAnyOf
  eras/<eraId>/
    meta.json                # optional id/name/blurb (authoring metadata)
    decisions.json
    challenges.json
    projects.json
```

Active content = `start` + the **resolved** catalog for the current era
(prior rungs inherited, this folder is the delta — ADR 0008). Put new
Company cards in `content/eras/company/`. Do not copy Studio files into
later eras. New Company cards are still directed by the 2026-08-14
brainstorm spec.

## Authoring tools

`make graph` serves a local DAG of decisions, requires / count gates,
synergies, costs, and era-entry paths. It is not part of the player UI
(ADR 0003).
