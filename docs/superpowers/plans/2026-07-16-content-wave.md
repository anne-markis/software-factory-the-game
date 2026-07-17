# Content Wave (Release 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Spec: docs/superpowers/specs/2026-07-16-content-wave-design.md. The codebase conventions are established; where this plan says "follow the X pattern", read that code first and match it exactly.

**Goal:** Ten new decisions, seven new challenges, one new project, and two content-configurable engine capabilities (rampRate effects, challenge cooldowns), with strategy probes proving human-heavy and automation-heavy builds are both viable.

**Branch:** release/8-content-wave off main. TDD throughout: red, green, commit per task. Current suite: 87 tests.

**Conventions:** engine stays DOM-free (purity test); every zod object schema `.strict()`; content errors via `fail(file, error)` naming file and entry; plain annotations over `as` casts; all tunable numbers in content JSON, never in engine code; player-facing strings use human names.

---

### Task 1: rampRate effect

**Files:** modify src/engine/types.ts, src/engine/content.ts, src/engine/effects.ts, src/engine/tick.ts; test src/engine/effects.test.ts.

Behavior: content effect `{ "type": "rampRate", "target": RateId, "perDay": number, "cap": number }` (schema: perDay positive, cap positive, target a real rate, `.strict()`). applyEffects pushes an add-op Modifier with `value: 0` plus new optional Modifier fields `rampPerDay` and `rampCap`. Each tick, immediately after pruneExpired, every modifier with rampPerDay grows: `value = Math.min(rampCap, value + rampPerDay)`. Removal semantics come free (removeDecision and payroll failure already strip modifiers by source). Saves already serialize modifiers, so ramp progress round-trips with no migration.

- [ ] Failing tests first: rampRate creates a 0-value add modifier; after N ticks the finish contribution is min(cap, N*perDay) via effectiveRate; cap holds beyond cap/perDay ticks; removeDecision leaves no residue; structuredClone save round-trip resumes ramp mid-growth (reuse the tick.test.ts round-trip pattern).
- [ ] Implement: types (Effect variant + Modifier fields), schema variant in effectSchema, effects.ts case, tick.ts growth pass (one loop, placed after pruneExpired and before challengePhase so challenge slowdowns see current values).
- [ ] Full suite green, tsc clean. Commit "feat: rampRate effect with content-configured growth and cap".

### Task 2: challenge cooldowns

**Files:** modify src/engine/types.ts (ChallengeDef.cooldownDays?, GameState.challengeLastFired: Record<string, number>), src/engine/content.ts (schema: positive int optional), src/engine/challenges.ts, src/engine/engine.ts (initialState: {}), src/engine/save.ts (deserialize defaults missing field to {}); test src/engine/challenges.test.ts, src/engine/save.test.ts.

Behavior: a challenge with cooldownDays cannot fire while `day < lastFired + cooldownDays`. The clock starts when effects land: at fire() for non-choice challenges; at resolveChoice and at expiry-default for choice challenges (queueing a pending choice does not start it). Record in state.challengeLastFired keyed by challenge id.

- [ ] Failing tests first (scripted rng, follow the existing challenges.test.ts style and its content-order guard): non-choice fires then is blocked until the cooldown elapses, fires again after; choice resolved starts the clock; choice expiry starts the clock; legacy save without challengeLastFired deserializes to {}.
- [ ] Implement. The cooldown check lives beside conditionMet in rollChallenges and must not consume rng draws when skipping (same rule the minDay gate follows).
- [ ] Full suite green, tsc clean. Commit "feat: challenge cooldowns with content-configured durations".

### Task 3: decisions content

**Files:** content/decisions.json; tests src/engine/content.test.ts (value assertions for a sample), src/engine/decisions.test.ts (manager synergy tightening).

Append exactly these entries (ids, order after existing five): better-tooling, copilot, senior-dev, contractor, eng-manager, standup, agent-swarm, swarm-orchestrator, self-learning-agents, support-retainer. Values per spec section 4:

- better-tooling: unique, oneTime 150, all rates add +0.1, tags [solo].
- copilot: unique, oneTime 20 perDay 2, finish mul 1.15, debt mul 1.05, tags [solo].
- senior-dev: perDay 15, human, requires [basic-dev], tags [human], gamble 0.4/+2.0, 0.3/+1.0, 0.2/+0.5, 0.1/-0.5 (all rates add). Synergy ifOwned eng-manager: gamble 0.5/+2.0, 0.35/+1.0, 0.13/+0.5, 0.02/-0.5.
- contractor: perDay 12, NOT human, all rates add +1.0 (deterministic, no gamble), debt mul 1.1, tags [human], removable.
- eng-manager: unique, perDay 10, requires [basic-dev], no effects, tags [human]. Also ADD a synergy to the existing basic-dev entry: ifOwned eng-manager -> gamble 0.55/+1.0, 0.30/+0.5, 0.13/-0.5, 0.02/-1.0.
- standup: unique, perDay 3, pull mul 1.15, tags [human, process].
- agent-swarm: oneTime 100 perDay 20, requires [agent-harness], finish mul 1.8, debt mul 1.5, tags [darkfactory]. Synergy ifOwned swarm-orchestrator: finish mul 1.8, debt mul 1.2.
- swarm-orchestrator: unique, oneTime 250 perDay 8, requires [agent-harness], no effects, tags [darkfactory].
- self-learning-agents: unique, oneTime 500 perDay 10, requires [agent-swarm], effects [{ rampRate, target finish, perDay 0.02, cap 2.0 }], tags [darkfactory].
- support-retainer: unique, no oneTime, perDay 0 (omit), incomePerDay 8, all rates mul 0.95, tags [process].

Descriptions: one player-facing sentence each stating cost and tradeoff, matching the register of existing entries. All gamble tables must sum to 1 (integrity check enforces).

- [ ] Tests first (a couple of value pins plus: buying basic-dev with eng-manager owned uses the tightened table — assert via the modifier value distribution across the four possible outcomes, or pin the seeded outcome and its label).
- [ ] Full suite green. Commit "feat: content wave decisions across solo, human, dark factory tracks".

### Task 4: challenges and project content

**Files:** content/challenges.json, content/projects.json; tests in content.test.ts.

Challenges appended (order preserved for existing six; the content-order guard test gains the new ids): model-deprecation (darkfactory hasTag, p 0.015, choice expires 4: pay-migration -$300 default vs degraded finish mul 0.7 for 30d; cooldownDays 90), api-price-hike (darkfactory, p 0.02, budget -200, cooldownDays 30), runaway-agent-loop (darkfactory, p 0.015, budget -350, cooldownDays 45), meeting-creep (human hasTag, p 0.02, all mul 0.9 for 60d, cooldownDays 90), team-conflict (human, p 0.015, choice expires 3: mediate -$120 default vs all mul 0.85 for 15d, cooldownDays 60), open-source-windfall (no condition, p 0.01, budget +400, cooldownDays 60), cloud-credits (darkfactory, p 0.015, budget +250, cooldownDays 60). Also add cooldownDays 60 to key-dev-poached.

Project appended: mobile-app (9000 pts, 3000 upfront, 19/pt, 4000 bonus, requiresCompleted 1).

- [ ] Tests first: parse assertions for a sample of new entries; the existing choice-with-effects and sickness guards still pass; update the content-order guard.
- [ ] Full suite green. Commit "feat: content wave challenges and mobile app project".

### Task 5: In Progress panel ramp display

**Files:** src/ui/inProgressPanel.ts, test.

Add-op modifiers with rampPerDay show their CURRENT value with a " (ramping)" suffix, e.g. "Self-learning agents: +0.4/day (ramping)".

- [ ] Test first (inject a ramp modifier mid-growth, assert label), implement, suite green. Commit "feat: ramping contributions labeled in the in-progress panel".

### Task 6: strategy probes and tuning

**Files:** src/engine/simulation.test.ts; content JSON values only if tuning demands.

Two new 2000-day probes (follow the smart-probe structure: priority shopping list, first-option choices, project continuation small-crm then mobile-app):

- Human-heavy: test-suite, ci-cd, better-tooling, basic-dev, eng-manager, senior-dev, standup, contractor. Assert completedProjects >= 2 and budget > 0 at day 2000.
- Automation-heavy: test-suite, ci-cd, agent, agent-harness, swarm-orchestrator, agent-swarm, self-learning-agents, support-retainer. Same assertions.

Neither probe asserts superiority over the other (spec section 2). Existing idle and smart probes must keep passing untouched. If a probe fails, tune content values (report each change and why); do not weaken assertions below the viability floor without reporting.

- [ ] Probes written, tuned, suite green. Commit "feat: human-heavy and automation-heavy viability probes".

### Task 7: checkpoint and merge

- [ ] Full verification: vitest, tsc, vite build.
- [ ] Browser checkpoint (controller): fresh game, verify new shop entries appear with requires-gating, buy into one track, watch the panel show swarm/ramp contributors, confirm a cooldown challenge does not immediately re-fire, project offer list shows mobile-app gated.
- [ ] README: extend the effect vocabulary list with rampRate and mention cooldowns.
- [ ] Merge release/8-content-wave to main (no squash).

## Self-review notes

- rampRate growth placed before challengePhase: challenge multipliers stack on current ramp values, matching the panel display.
- Cooldown state is a new save field: deserialize default {} follows the nextModifierId pattern; test pins legacy shape.
- The manager synergy restates full gamble tables (engine replaces, never merges); integrity check enforces sums.
- Probe shopping lists respect requires edges (harness before swarm, basic-dev before senior/manager).
