# ADR 0001: Per-era JSON layout

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

P0.2 treats progression as a one-way **scale** ladder (Studio → Company →
Megacorp), not parallel capability campaigns. Authors need a layout that
makes each era’s shop / challenge / project graph visible, and the engine
must not hardcode era names or story beats in the tick.

## Decision

One content bundle per era; a small index lists order and entry criteria:

```
content/
  start.json                 # global constants, seed stocks (era-agnostic)
  eras.json                  # ordered era ids + startingEraId + entryAnyOf
  eras/<eraId>/
    meta.json                # optional id, name, blurb
    decisions.json
    challenges.json
    projects.json
```

**Load merge rule:** active content = `start` + the **resolved** catalog
for the current era (every prior rung, then this era’s files as a delta;
ADR 0008). The engine holds `state.eraId` from content. After each tick it
evaluates the **next** era’s `entryAnyOf` (one rung; no skip) and reloads
that bundle via a loader. Tick does not hardcode era names. Fixtures that
omit a loader stay on their bundle.

**Entry criteria** are an OR of paths (`entryAnyOf`). Each path is an AND
of optional floors: `minBudget`, `minReputation`, `minCompletedProjects`,
`minUsers`. The starting era must not declare `entryAnyOf`.

Do not split eras by capability (delivery vs automation). Agents belong in
Studio when costs fit that scale.

## Rejected

- A single monolithic `decisions.json` with an `era` field on every card.
- TypeScript era enums or per-era special cases in the tick.
- Player-facing “pick your era” modes.

## Consequences

Studio ships filled. Later era folders are **deltas**: the loader inherits
every prior rung so owned instances keep paying after the shop swaps
(ADR 0008). Do not copy Studio JSON into Company or Megacorp. New later-era
cards go under that era’s folder, not by tagging Studio cards. Entry floors
live in `content/eras.json` only. Crossing an era is silent by default
(heading changes; no Events line; not a next-goal); set `"silentEntry": false`
to announce. The graph viewer (ADR 0003) reads the same resolved bundles and
plots native cards per era.
