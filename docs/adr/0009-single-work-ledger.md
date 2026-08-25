# ADR 0009: Single work ledger

- **Status:** Accepted
- **Date:** 2026-08-20
- **Reported:** player-reported: Ready queue at 0, users still 0, work still finishing, Projects panel ~40 pts left

## Context

The factory has always had two independent counts for “how much work is left”:

1. **Pipeline stocks** (`backlog` → `inProgress` → `done` → `shipped`). The first stage was labeled “Backlog” in both the cockpit hero metric and the Delivery diagram.
2. **`ActiveProject.remaining`**, a FIFO ship-countdown decremented only when points leave `done`.

Starting a project wrote both. After that they diverged on purpose:

- Tech-debt refill and challenges (`addToStock` / `scaleStock` on a pipeline stock) mutated only the bag.
- `start.json` seeded `stocks.backlog` and `initialProject.sizePoints` as two copies of `300`.
- Any shipped point credited `remaining`, so extra bag-points *accelerated* the contract instead of delaying it.

The player-visible lie: pull empties the Ready queue while ~40 contract points still sit in In Progress / Done. Cockpit “Backlog” hit 0, users stayed 0 (completion grants them on remaining → 0), the Progress panel still finished work, and Projects still showed ~40 pts. Same work, three stories.

Bags have no identity. FIFO-attributing an anonymous pipeline at the far end cannot tell contract work from rework.

## Decision

**One ledger, two views.**

- `unshippedWork` = `backlog + inProgress + done`. That is the cockpit **Backlog** (the original design’s remaining-work pile).
- The Delivery diagram’s first box is **Ready** (`stocks.backlog`): work waiting to be pulled. Stage stocks say *where* unshipped work sits.
- `ActiveProject.remaining` says *which contract* that work is for. Injected pipeline work attaches to the oldest in-flight remaining. With no project in flight it is unattributed surplus and **ships first without credit**, so leftover rework cannot complete the next contract early.
- `content/start.json` must set `stocks.backlog === initialProject.sizePoints`.

Users still unlock when the Launch beta’s remaining hits ~0 (work has shipped, not merely left Ready). That is launch, not a bug.

## Consequences

- Scope creep and tech-debt refill delay the current contract (more remaining) instead of counting as free progress.
- Cockpit Backlog burns down when points **ship**, not when they are pulled into In Progress.
- Project ETA (`remaining ÷ points/day`) includes attached extra work.
- No save bump: remaining and stocks already existed; attribution and display change. In-flight saves that already diverged will play under the new rules from the next tick.
- Tests that would have caught this: `workLedgerIssues` / `surplusGrewWhileInFlight` on every simulation tick; UI `workSurfaces.test.ts` parsing cockpit Backlog, Delivery stage boxes, delivery stats, and Projects remaining and requiring they agree — especially at Ready-empty with WIP still in later stages.
