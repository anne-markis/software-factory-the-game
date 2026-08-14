# Reputation and Milestones (Release 17) Implementation Plan

> Spec: docs/superpowers/specs/2026-07-21-reputation-design.md. TDD throughout; engine stays DOM-free (purity test); strict schemas; values in content; plain annotations; player-facing names. Branch: release/17-reputation. Baseline: 174 tests.
>
> Challenge `hasTag` mentioned below is retired (ADR 0002); gate on stocks / ownership instead (`docs/CONTENT-AUTHORING.md`).

## Task 1: reputation stock, earning, gating, milestones (engine)

**Files:** src/engine/types.ts, engine.ts, tick.ts, projects.ts, save.ts, content.ts, src/engine/milestones.ts (new) + test; tests in reputation-focused specs.

- Stocks gains `reputation: number`. stocksSchema: `reputation: z.number().min(0)`. This ripples: audit every stocks iterator (stats render in Task 3, simulation invariants — reputation >= 0 holds). initialState copies start.stocks.reputation.
- StartConfig.initialProject and ProjectDef gain `reputationReward: number` (schema >= 0). ProjectDef gains `requiresReputation?: number` (schema optional >= 0). ActiveProject carries reputationReward through (initialState seeds it from start.initialProject).
- tick.ts attributeShipped completion branch: on completion, `state.stocks.reputation += p.reputationReward` alongside the completion bonus; log includes it.
- projects.ts projectAvailability: after the requiresCompleted check and before affordability, add: if `def.requiresReputation !== undefined && state.stocks.reputation < def.requiresReputation` return not-startable, reason `requires ${def.requiresReputation} reputation`. Live recompute means a reputation drop re-locks (no extra mechanism).
- StartConfig gains `milestones: { id, reputation, name, message }[]` (schema: reputation >= 0, ids unique, thresholds strictly ascending — integrity check in parseStartConfig). GameState gains `milestonesSeen: string[]` (initialState []).
- src/engine/milestones.ts: `detectMilestones(state, content, log)` — for each milestone not in milestonesSeen whose reputation <= state.stocks.reputation, log its message and record its id. Engine-pure, log passed in (avoid tick cycle). Called in tick beside archetype detection. Downward recross does not un-fire (ids are sticky).
- save.ts deserialize: default missing milestonesSeen to []. Engine constructor: backfill missing stocks.reputation from content.start.stocks.reputation (gameSeed/debtDrag pattern). save.test pins both.
- Tests: reputation earned on completion (tick-level: shrink initialProject to complete fast, assert reputation jumps by reward); gating (a fixture project with requiresReputation 5 is not startable at rep 0, startable at rep 5, re-locked after addToStock reputation -5); milestone once-only + no-refire-on-recross + sticky; save backfill (legacy save without reputation/milestonesSeen loads at baseline/[]).
- Commit "feat: reputation stock earned on completion, gating contracts, milestones".

## Task 2: content and balance

**Files:** content/start.json, projects.json, challenges.json; content.test.ts; simulation.test.ts.

- start.json: stocks.reputation 0; initialProject.reputationReward (guess 1); milestones array — 4 entries ascending, e.g. { trusted, 5, "Trusted vendor", "Milestone: trusted vendor. Bigger contracts are opening up." }, { established, 15, "Established shop", ... }, { leader, 35, "Industry leader", ... }, { titan, 70, "Industry titan", ... }. Tune in the balance sweep.
- projects.json: every project gains reputationReward (small-crm ~2, big-migration ~5, enterprise ~10, mobile-app ~4; first contract via start.json ~1); big-migration/enterprise/mobile gain requiresReputation (guess: big-migration 5, mobile 5, enterprise 15) ALONGSIDE their existing requiresCompleted. Tune so reputation, not just completion count, is the binding gate on the top tier.
- challenges.json: prod-incident gains `{ addToStock, stock: reputation, value: -2 }`; new security-breach challenge — condition `{ minTechDebt: 800 }` + hasTag darkfactory OR keep it debt-gated only (judgment; debt-gated is simpler and hits any high-debt build), probScaling on techDebt, effects budget -N and reputation -5, cooldownDays ~120, minDay grace. It is the spiral's teeth. Description names the reputation cost.
- Balance sweep (own the numbers): run all probes. Targets — both strategy builds EARN enough reputation from completing lower contracts to unlock the higher tiers they already reach (verify the reputation gate does not wall them off from contracts they used to complete; if it does, lower requiresReputation or raise rewards, report). The spiral must be real but survivable for a mitigated build. Idle/mechanism probes: reputation stays 0 (no completions) or rises only on the initial contract's completion — re-pin any affected observations. Greedy still degrades.
- Add a spiral probe: manufacture a high-rep state that has unlocked a tier, apply security-breach effects (or enough incident reputation loss), assert the tier re-locks (projectAvailability flips to not-startable with the reputation reason). Pins the downward spiral.
- content.test.ts: pins for reputationReward/requiresReputation/milestones/security-breach; schema rejections (negative reward, non-ascending milestones, duplicate milestone id).
- Commit "feat: reputation content, security breach, milestones tuned".

## Task 3: UI

**Files:** src/ui/render.ts (renderStats, renderProjects), index.html, render.test.ts.

- renderStats: add a Reputation stat span with its own fixed slot (.v-rep min-width sized like tech debt ~7ch, tabular-nums) so the R14 no-reflow guarantee holds. Place it logically (after Tech Debt, before Points/Day, or grouped with the money stats — judgment).
- renderProjects: the gating reason for a locked tier already renders def-derived reasons; ensure the reputation reason ("requires N reputation") shows. projectAvailability supplies it; confirm renderProjects surfaces whatever reason the availability entry carries (it does for completions/afford — reputation flows through the same path). Add/adjust a render test: a project needing reputation the player lacks shows the reputation requirement.
- Tests: renderStats emits the reputation slot; renderProjects shows the reputation gate reason.
- Browser checkpoint (controller does this): reputation rises on completion, milestone banner fires in the log, a top-tier contract shows its reputation gate and unlocks when reached.
- Commit "feat: reputation in the stats bar and contract gating reasons".

## Task 4: docs, review, checkpoint

- CONTENT-AUTHORING.md: reputation stock (earned via project reputationReward, spent by addToStock on reputation, gates via requiresReputation); milestones array in start.json; the reputation stock in the stocks list; security-breach as a spiral example.
- Full review (spec + quality) of the whole branch.
- Controller browser checkpoint per Task 3.
- HOLD at branch; do not merge until the user approves.

## Self-review notes

- Reputation-in-Stocks is the load-bearing decision: it reuses addToStock for damage and appears in stats for free, at the cost of touching stocksSchema and stats render. Audit those two plus simulation invariants; the loop diagram uses named stage keys and is unaffected.
- The spiral needs no un-start mechanism: projectAvailability recomputes live, so a reputation drop simply stops NEW higher-tier starts.
- Milestones and archetypes share the once-only sticky pattern; keep them separate modules for clarity.
