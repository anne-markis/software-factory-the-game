# ADR 0002: Retire tags and first-class tracks

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

v1 used free-form decision `tags` (solo, human, darkfactory, …) and
challenge `hasTag` to weight which problems found the player. That taught a
**track curriculum**: parallel endgames you assemble by tag affinity. The
settled P0.2 direction is one long scale-era game; capability mix meanders
inside an era.

## Decision

Remove `DecisionDef.tags` and `ChallengeDef.condition.hasTag` from schema
and runtime. Eligibility uses stocks, human headcount, and live decision
ownership already expressible in JSON:

- `requires` / `requiresCounts` on decisions
- `requiresAnyDecision`, `lacksDecision` on challenges
- `minHumanDevs` / `maxHumanDevs` (headcount, not a “human track”)
- `minTechDebt`, `minDay`, `minCompletedProjects`
- project `requiresCompleted` / `requiresReputation`

Shop layout used required `category`, not tags; the player shop is now a
flat list and does not group by it. `human: true` remains a headcount
flag for challenge predicates (redesign parked).

Do not invent a replacement track layer (no tag enums, no “you are on
track X” player copy).

## Consequences

Agent-line challenges gate on owned agent-ladder ids via
`requiresAnyDecision`. Hire-drama / org-calendar challenges that used
`hasTag: "human"` either use `minHumanDevs` or leave Studio. Authoring
docs must not instruct authors to use track tags (S-2).
The player shop no longer groups by `category`; do not invent a
replacement grouping layer. The field stays required on the schema.
