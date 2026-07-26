# Software Factory: Decision Card Legibility Design (Release 20)

Date: 2026-07-22
Status: Draft for review
Related: 2026-07-22-ux-arc.md (supports increment 2's "easier to
understand" goal, taken early because the defect is live)

## 1. The defect

Every decision card currently answers "what does this cost?" twice and
"what does this do for me?" never. Observed in the shipped build:

| Card | Cost line | Description rendered | Benefit shown |
| --- | --- | --- | --- |
| Add test suite | $500 once | "Slows all work 50% for 5 days..." | no |
| CI/CD pipeline | $750 once | "Slows all work 50% for 1 day to set up." | no |
| Add coding agent | $10 once + $4/day | "$10 setup, $4/day to run." | no |
| Agent harness | $250 once + $5/day | "$250 setup, $5/day." | no |
| Agent swarm | $100 once + $20/day | "Needs a harness." | no |
| Hire senior developer | $12/day | "Needs a basic developer on the team." | no |

Two causes compound. The tech tree truncates a description to its first
sentence, and the descriptions were authored for the previous list
layout, which showed them in full, so they open with cost or
prerequisites and bury the payoff in sentence two. The card then spends
its only line repeating what the cost line and the tree structure
already show.

## 2. Fix: benefit first, then the catch

Rewrite all 18 descriptions to a consistent shape:

> BENEFIT. CATCH.

Short enough to render in full, so truncation is removed rather than
worked around. Cost restatements and prerequisite restatements are
dropped entirely, because the cost line and the tree edges already carry
that information.

Examples of the target voice:

- test-suite: "Halves tech debt permanently and unlocks CI/CD. Work
  slows 50% for about a week while you write them."
- ci-cd: "Finished work ships continuously, removing the Done queue
  entirely. Costs a day of setup."
- agent-swarm: "Agents pick up and ship work themselves: all work 80%
  faster. Tech debt grows 50% faster unless an orchestrator tames it."

## 3. Fix: a derived effect line

Prose drifts from numbers every time balance is retuned; this codebase
has retuned balance in six separate releases. So beneath the authored
line each card also carries a terse summary generated from the
structured `effects` data, which cannot go stale:

- `modifyRate all mul 1.8` renders as "all rates x1.8"
- `modifyRate finish mul 1.2` renders as "finish x1.2"
- `modifyRate all add 0.1` renders as "all rates +0.1/day"
- `modifyDebtMultiplier mul 0.5` renders as "debt x0.5"
- `rampRate finish 0.02 cap 1.4` renders as "finish +0.02/day up to +1.4"
- `scaleStock techDebt 0.7` renders as "debt -30%"
- `continuousDeploy` renders as "removes the Done stage"
- `incomePerDay 8` renders as "+$8/day"

Temporary effects render their FELT duration, not the raw field:
`durationDays` counts from the current day, so a purchase-time effect
with `durationDays: 6` is active for 5 ticks. The card shows "for 5d"
so it agrees with the authored prose. This asymmetry is already
documented in CONTENT-AUTHORING and is the kind of detail that makes
hand-written prose drift, which is the argument for deriving it.

Gamble decisions carry their outcomes in the gamble table rather than in
`effects`, so their summary states the range and flags the risk, for
example "all rates +2.0 to -0.5 (gamble)". Synergy variants are omitted
from the summary: they are conditional and would double the line's
length for a case the authored prose already mentions.

The generator is a pure function in the UI layer, unit-tested against
the shipped content so a new effect type cannot silently render as
nothing.

## 4. Card anatomy after this change

    name                    [category tag]
    cost line
    authored: benefit, then catch
    derived: hard numbers
    [state: owned / requirement / Buy]

Order is deliberate: flavor before numbers, because the authored line
explains why a player would want the thing and the derived line confirms
exactly what it does.

## 5. Out of scope

- Layout changes to the tech tree (increment 2 owns those).
- Per-decision authored short copy separate from the full description:
  the rewritten descriptions are short enough to serve both.
- Showing synergy-conditional effects on cards.

## 6. Testing

- The derived generator: one case per effect type, the felt-duration
  conversion, the gamble range form, and a sweep asserting every shipped
  decision produces a non-empty summary (guards against an unhandled
  effect type rendering blank).
- Rendering: a card shows the authored benefit line and the derived line;
  truncation no longer applies.
- Content: descriptions no longer restate cost or prerequisites. Pinned
  loosely, by asserting a few specific rewritten strings rather than
  attempting to lint prose.

## 7. Risks

- Card height grows by one line across 18 nodes, adding vertical space
  to a panel already identified as too tall. Accepted: the panel is
  increment 2's problem, and an unreadable compact card is worse than a
  readable taller one.
- Derived summaries could read as noise beside good prose. Mitigated by
  ordering (prose first) and by keeping the summary terse and dimmed.
