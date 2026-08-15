# Software Factory — authoring context

Living glossary for content authors and maintainers. Product direction lives
in `docs/VISION.md`; field-by-field JSON rules live in
`docs/CONTENT-AUTHORING.md`. Locked architecture decisions are ADRs 0001–0006
under `docs/adr/`. If this glossary and the loader disagree, the code in
`src/engine/` wins.

## Scale eras (not tracks)

**Eras** are a one-way **scale ladder**: Studio → Company → Megacorp → …
They mark how big the factory is (what it can afford, what problems that
scale invites), not which capability fantasy the player picked.

- **Studio** — short tutorial-scale opening (~$10k start). Hires *and* early
  agents belong here; do not gate “AI” as its own era.
- **Company** — where most playtime will live: same loop, higher cost of
  play, homing in on the dark factory (deeper agentic investment,
  Paperclips autonomy: the fleet staffs itself). Empty
  `[]` shell in P0.2; direction in
  [`docs/superpowers/specs/2026-08-14-company-era-brainstorm.md`](superpowers/specs/2026-08-14-company-era-brainstorm.md).
- **Megacorp** — institutional scale. Empty shell in P0.2.

Capability mix (hire-heavy, agent-heavy, process-heavy) **meanders inside**
an era. Crossing an era is irreversible once entry criteria fire. P0.2
authors entry predicates in `content/eras.json` for the graph viewer and
later milestones; the tick does not advance `eraId` yet (ADR 0001).

## Retired: tracks, tags, `hasTag`

First-class **tracks** (solo / startup / megacorp / darkfactory as peer
endgames) and the **tag curriculum** (`DecisionDef.tags`,
`ChallengeDef.condition.hasTag`) are retired (ADR 0002). Do not teach
authors to label cards with track affinity. Shop grouping uses `category`.
Challenge eligibility uses stocks, human headcount, and live decision
ownership.

Historical design docs that still talk about tracks are snapshots, not
authoring instructions.

## Stocks

Every named quantity the engine writes is a **stock** (`Stocks` in
`src/engine/types.ts`). Pipeline stocks: `backlog`, `inProgress`, `done`,
`shipped`. Resource / identity stocks: `budget`, `techDebt`, `reputation`,
`users`. All clamp at a minimum of 0.

**Users** is the product-growth stock (Studio spine). It stays 0 until the
Launch beta project completes (`completionStockGrants`), then grows via
always-on **stock flows** and can slow delivery via **stock drag**.
Monetization decisions *read* users; they do not invent a second population.

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
- Projects: `requiresCompleted`, `requiresReputation`.
- Era entry (authored, not yet evaluated in tick): `entryAnyOf` OR of
  `{ minBudget, minReputation, minCompletedProjects, minUsers }` paths.

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

Active content = `start` + **one** era bundle. Company and Megacorp still
ship as empty `[]` shells; Company direction lives in the 2026-08-14
brainstorm spec, not in playable cards yet.

## Authoring tools

`make graph` serves a local DAG of decisions, requires / count gates,
synergies, costs, and era-entry paths. It is not part of the player UI
(ADR 0003).
