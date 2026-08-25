# ADR 0006: Stock-linked content JSON schema

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

ADR 0005 locks the *approach* (generic stock-linked fields). This ADR locks
the *schema*: field names, where they live, and what the engine evaluates.

## Decision

### Owned (decision)

- `incomeFromStock?: { stock, perUnit }` — stacks with flat `incomePerDay`.
  Income that tick += `stocks[stock] * perUnit`.
- `burstFromStock?: { stock, probabilityPerDay, perUnit }` — each day rolls
  `probabilityPerDay`; on a hit, credit `stocks[stock] * perUnit` into the
  same income step as flat income (consumed by burn / payroll).
- `stockFlowMods?: [{ stock, acquirePerDayDelta?, churnRateDelta? }]` —
  additive nudges to a matching `start.stockFlows` entry. Studio may ship
  none; the field exists for forward-compat.

### Start (always-on)

- `stockDrags?: [{ stock, freeBand, dragPerPoint, maxDrag, target }]` —
  same bounds idea as `debtDrag` (`freeBand >= 0`, `dragPerPoint > 0`,
  `maxDrag` in `(0, 1)`). `target` is a rate or `"all"`. Excess above
  `freeBand` slows the target: `1 - min(maxDrag, excess * dragPerPoint)`.
- `stockFlows?: [{ stock, condition?, acquirePerDay?, acquirePerStock?, churnRatePerDay? }]` —
  per-tick acquire (flat plus `acquirePerStock.perUnit` of another stock)
  minus `stocks[stock] * churnRatePerDay`. `condition.minCompletedProjects`
  is the only flow gate in this cut. Base churn only — no debt/incident
  churn DSL.

### Projects

- `completionStockGrants?: [{ stock, amount }]` on `ProjectDef` and
  `start.initialProject`. Paid on completion alongside reputation / bonus.
  Copied onto the in-flight project at start so later content edits do not
  change an already-running grant.

### Challenges

Keep `minTechDebt` until a content rewrite needs generic floors. A nested
`minStock` / `maxStock` `{ stock, value }` shape was considered; it is
**not** in the shipped schema (inert fields were dropped rather than
left as a footgun). Use `minTechDebt` for debt floors.

### Studio spine values (not sacred forever)

Users stay 0 until Launch beta completes, then +30 users and +$800.
Organic flow after `minCompletedProjects: 1`: `1.5 + reputation × 0.1`
users/day, 1% churn. Support drag: free band 25, `dragPerPoint` 0.004,
`maxDrag` 0.35, target `"all"`. Subscription: `$0.75 / user / day`.
One-time product: `p = 0.08`, `$1.20 / user` on a hit.

## Rejected

Named subscription effects; support-drag-as-decision; free-form
`stockLinks` bag; migrating `debtDrag` this cut; shipping unused
`minStock` / `maxStock` keys.

## Consequences

Authoring docs describe these fields and the Studio examples. The engine
evaluates them generically (`src/engine/tick.ts`, `modifiers.ts`).
