# ADR 0001: Per-era JSON layout

- **Status:** Accepted
- **Date:** 2026-08-12
- **Issues:** [#90](https://github.com/anne-markis/software-factory-the-game/issues/90), plan §2.1

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

**Load merge rule:** active content = `start` + the **current** era’s
decisions / challenges / projects. The engine may hold `state.eraId` read
from content. P0.2 does **not** evaluate `entryAnyOf` in tick and does not
advance the player out of Studio.

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

Studio ships filled; Company and Megacorp ship as empty `[]` shells in
P0.2. Authors add later-era cards under that era’s folder, not by tagging
Studio cards. The graph viewer (ADR 0003) reads the same bundles.
