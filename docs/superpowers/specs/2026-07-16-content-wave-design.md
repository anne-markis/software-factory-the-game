# Software Factory: Content Wave Design (Release 8)

Date: 2026-07-16
Status: Draft for review
Extends: 2026-07-14-software-factory-design.md

## 1. Goals

Turn the five-item shop into a real decision space with track identities,
give the economy long-run income leverage, and demonstrate the pluggable
mechanics promise with two small engine capabilities. The player still
cannot buy everything; the new items compete for the same budget.

## 2. Design principles for this wave

- Engine additions are pure logic. Every tunable value (ramp increments,
  caps, cooldown lengths, costs, probabilities) lives in content JSON.
- Track speed is emergent. No track is fastest by design. Throughput
  ceilings come from interactions: synergies, debt feedback, challenge
  exposure, and upkeep economics. Some combinations of human-track
  purchases will outrun automation builds and vice versa. The game does
  not know or encode which is faster.
- Balance probes verify viability, not dominance: at least one
  human-heavy strategy and one automation-heavy strategy must each
  complete multiple projects and stay solvent over a 2000-day run.
  Neither outcome is pinned as strictly better.

## 3. Engine additions

### rampRate effect

A new effect type: while its source (decision instance) is owned, a rate
gains a per-day increment up to a cap.

Shape in content: { "type": "rampRate", "target": <rate>, "perDay": X,
"cap": Y }. Behavior: the contribution starts at 0 and grows by perDay
each tick, clamping at cap. Removing the source removes the contribution
entirely (no residue). Save/restore preserves current ramp progress.
Powers self-learning agents and any future compounding mechanic. The
In Progress panel shows the current ramped value like any other
contributor.

### Challenge cooldowns

A new optional challenge field: cooldownDays. After a challenge fires
(for choice challenges: after resolution or expiry), it cannot fire
again until that many days pass. Engine records last-fired day per
challenge id in game state. Applies to any challenge, not only choices,
so content can also throttle repeat incident storms. Closes the accepted
v1 gap where paying to keep a poached developer bought no immunity.

## 4. New decisions

Solo track (cheap, deterministic, low ceiling):

- Better tooling: $150 once, unique. +0.1 all rates.
- Copilot assistant: $20 once + $2/day, unique. finish x1.15, debt x1.05.

Human track (scaling, variance control):

- Senior developer: $15/day, requires basic-dev, human. Gamble: 40%
  +2.0, 30% +1.0, 20% +0.5, 10% -0.5 (all rates, add).
- Contractor: $12/day, deterministic +1 all rates, debt x1.1. Not
  human: immune to sickness and poaching, but messier code. Removable.
- Engineering manager: unique, $10/day, requires basic-dev. No direct
  rate effect. Basic and senior developers gain synergies: hired while
  a manager is owned, their gamble tables tighten (bad outcomes shrink;
  exact tables in content).
- Standup ritual: unique, $3/day. pull x1.15.

Dark factory track (expensive, high ceiling, debt-hungry):

- Agent swarm: $100 once + $20/day, requires agent-harness. finish
  x1.8, debt x1.5. Synergy: owned orchestrator changes debt to x1.2.
- Swarm orchestrator: unique, $250 once + $8/day, requires
  agent-harness.
- Self-learning agents: unique, $500 once + $10/day, requires
  agent-swarm. rampRate: finish +0.02/day up to +2.0.

Income lever:

- Support retainer: unique, no upfront cost, incomePerDay $8, all
  rates x0.95. First content use of the existing incomePerDay field;
  addresses thin long-run margins.

All numbers above are first guesses; the simulation probes are the
tuning instrument, and the values live in content/decisions.json.

## 5. New challenges

Tag-gated so the player's build determines which problems find them.

- Model deprecation (darkfactory tag): choice with cooldown. Pay a
  migration fee, or agent-class work slows 30% for 30 days.
- API price hike (darkfactory tag): timed budget hit.
- Runaway agent loop (darkfactory tag): overnight budget drain.
- Meeting creep (human tag): all rates x0.9 for 60 days. Cooldown so
  it cannot stack repeatedly.
- Team conflict (human tag): choice. Mediate for money or lose
  throughput for a period.
- Open-source windfall (no tag): +$400. Positive.
- Free cloud credits (darkfactory tag): +$250. Positive.

Probabilities, values, minDay gates, and cooldowns in
content/challenges.json.

## 6. New project

- Mobile app build: 9,000 points, $3,000 upfront, $19/pt, $4,000
  completion bonus, requires 1 completed project. Bridges Small CRM
  (5,000) and Legacy migration (20,000).

## 7. Testing

- Engine: rampRate unit tests (growth, cap, removal residue-free,
  save/restore of ramp progress); cooldown unit tests (choice
  resolution and expiry both start the cooldown; non-choice cooldowns
  throttle re-fire; save/restore preserves last-fired days).
- Content: schema updates stay strict; integrity checks extended
  (rampRate targets valid rates; cooldownDays positive).
- Simulation: two new strategy probes (human-heavy, automation-heavy)
  per section 2; existing idle and smart probes must keep passing.

## 8. Out of scope (next phase candidates)

Reputation stock and reputation-gated contracts, morale, compute,
valuation, track endgames, agents-spawning-agents, per-track challenge
pools beyond tag gating.

## 9. Risks

- Balance sprawl: ten new purchases multiply interaction space.
  Mitigation: probes assert viability floors, and all values are
  content-editable without code changes.
- Ramp and cooldown state are new save fields. Mitigation: deserialize
  defaults for missing fields, same pattern as the id-counter
  migration; tests pin legacy-save shapes.
- Synergy-tightened gamble tables replace, not modify, base tables
  (existing engine semantics). Content must restate full tables;
  integrity checks verify they sum to 1.
