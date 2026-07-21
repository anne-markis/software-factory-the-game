# Software Factory: Reputation and Milestones Design (Release 17)

Date: 2026-07-21
Status: Draft for review
Extends: 2026-07-14-software-factory-design.md, 2026-07-16-content-wave-design.md

## 1. Goal

Add reputation as a second reinforcing loop (Success to the Successful):
completing projects builds reputation, reputation unlocks bigger and
better contracts, whose completion builds more reputation. The loop
couples to the existing tech-debt / incident machinery, so a reckless
scale can spiral downward while a well-tended factory compounds upward.
No hard win: the game stays endless, with milestone banners marking
reputation thresholds.

Three approved design decisions:
- Endless with milestones (no victory screen).
- Reputation gates contracts IN ADDITION to the existing completed-count
  floor (a contract may require both N completions and R reputation).
- Real downward spiral: reputation can fall far enough to re-lock
  contract tiers the player had unlocked, forcing recovery.

## 2. Reputation as a stock

Reputation is added to the Stocks type (`reputation: number`), so it:
- appears in the always-visible stats bar,
- clamps at 0 like other non-budget stocks,
- is damageable by the existing `addToStock` effect (challenges spend
  `{ addToStock, stock: reputation, value: -N }`) with no new effect
  type,
- is asserted non-negative and finite by the existing simulation
  invariants.

It starts at a small baseline (content, `start.json` stocks.reputation,
initial guess 0). It is not a pipeline stage, so the loop diagram (which
iterates named pipeline stages) is unaffected.

## 3. Earning reputation

Projects grant reputation on completion. `ProjectDef` gains
`reputationReward: number`; `start.json` initialProject gains the same
field. The reward is paid in `tick.ts` at the same point as the
completion bonus (FIFO attribution completion branch). Larger contracts
reward more, so the loop's payoff scales with the risk taken.

## 4. Losing reputation (the downward spiral)

Incident-class challenges damage reputation via `addToStock`:
- prod-incident gains a reputation hit alongside its budget hit.
- A new challenge, security-breach (gated on scale: `minTechDebt` and a
  darkfactory or headcount tag), delivers a larger reputation hit and a
  budget hit. Its probability scales with tech debt, so the reinforcing
  loop's governor is the debt drag already in play: the harder you push,
  the more debt, the more breaches, the more reputation bleeds.

Because contract availability is recomputed live, a reputation drop
below a tier's `requiresReputation` immediately re-locks that tier's new
contracts (in-flight projects continue; only starting new ones is
gated). This is the spiral: an incident can cost you access to the
income you needed to recover.

## 5. Gating contracts

`ProjectDef` gains `requiresReputation?: number`. `projectAvailability`
adds a check: startable requires `completedProjects >= requiresCompleted`
AND `reputation >= requiresReputation` (when set) AND affordability AND
not-in-flight, in that reason order (reputation reported after
completions, before affordability). The existing `requiresCompleted`
floor stays on every tiered contract.

## 6. Milestones

Named reputation thresholds, content-defined in `start.json` (or a
sibling), each `{ id, reputation, name, message }`. When reputation
first crosses a threshold, a one-time event-log entry fires (the
`archetypesSeen` once-only pattern, new state field `milestonesSeen:
string[]`, deserialize backfill `[]`). Milestones are purely narrative
recognition ("Trusted vendor", "Industry leader", "Household name") and
never end the game. The top milestone reads as a capstone without
stopping play. Crossing downward does not un-fire a milestone (they mark
having-reached, not current standing).

Detection runs in the tick beside archetype detection, engine-pure,
thresholds from content.

## 7. Content changes

- `content/projects.json`: every project gains `reputationReward`; the
  bigger tiers (big-migration, enterprise-replatform, mobile-app) gain
  `requiresReputation`. Values tuned in the balance pass.
- `content/start.json`: `stocks.reputation`, initialProject
  `reputationReward`, and a `milestones` array.
- `content/challenges.json`: prod-incident gains a reputation hit;
  security-breach added.

## 8. UI

- Stats bar: reputation appears as a stat with its own fixed slot
  (tabular-nums, sized like tech debt), keeping the R14 no-reflow
  guarantee.
- Projects panel: a locked tier shows its reputation requirement in the
  gating reason ("requires 8 reputation") the same way it shows
  completion and affordability reasons.
- No new panel. Reputation's loop is legible through the stat plus the
  contract gates plus milestone log entries.

## 9. Testing

- Engine: reputation earned on completion (unit + tick-level); incident
  reputation loss clamps at 0; projectAvailability gating on reputation
  (locked below threshold, unlocks at threshold, re-locks after a loss);
  milestone once-only firing and no-refire-on-recross; save backfill of
  milestonesSeen and reputation (legacy saves default reputation to the
  start baseline, milestonesSeen to []).
- Content: schema for reputationReward (>= 0), requiresReputation
  (optional >= 0), milestones (thresholds ascending, ids unique);
  shipped-file pins.
- Simulation: probes retuned. Both strategy builds must reach the
  higher contract tiers (they earn reputation by completing lower
  ones), so the reinforcing loop is exercised. A new probe: a
  breach-heavy scripted state drives reputation down and asserts a
  previously-available tier re-locks (the spiral, pinned).

## 10. Save compatibility

Two new persisted fields. `reputation` lives in `stocks`; a legacy save
lacking it deserializes to the start baseline (Engine constructor
backfill from content, gameSeed pattern). `milestonesSeen` defaults to
`[]` in deserialize. No version bump.

## 11. Out of scope (next-phase candidates)

- Track-flavored endings (dark-factory zero-human ending, acquisition,
  solo lifestyle) building on build detection.
- Valuation, morale, compute stocks.
- Reputation affecting hiring gambles or challenge pools beyond gating.
- Delays as first-class citizens (hire ramp-up lag).

## 12. Risks

- Balance: five interacting loops now (money, reputation, debt drag,
  incident risk, context-switch). Mitigation: probes assert the
  reinforcing loop is reachable and the spiral is real; all values in
  content.
- Punishing spiral: a real downward spiral can trap an unlucky player.
  This is the approved, systems-honest choice; the milestone floor
  effect is deliberately absent. Balance keeps incident reputation costs
  survivable for a mitigated build, brutal only for a reckless one.
- Reputation-in-Stocks ripple: adding a Stocks field touches the stats
  render and the stocks schema. Mitigation: audit every Object.keys /
  Object.entries over stocks (stats render, simulation invariants) and
  the loop diagram's stage-key list (unaffected).
