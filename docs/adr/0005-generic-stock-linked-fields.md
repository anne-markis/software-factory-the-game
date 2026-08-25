# ADR 0005: Generic stock-linked fields (approach)

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Studio needs subscription income from `users`, support drag above a user
band, one-time product bursts, and organic user acquisition. Those could be
hardcoded as named “subscription” / “support” engine special cases, which
would teach product fiction in TypeScript and block later stocks.

## Decision

Express these as **generic stock-linked fields**: content names a `stock`
and a numeric rule; the engine evaluates the rule for any stock. No tick
branch named after subscription, support load, or users.

`debtDrag` remains a dedicated tech-debt config for this cut (Limits to
Growth already ships that way). Do not introduce a free-form `stockLinks`
bag.

## Rejected

- Named subscription / support-drag effect types in the engine.
- Support-drag-as-a-decision (always-on start config instead).
- Migrating `debtDrag` into `stockDrags` in this cut.

## Consequences

Field names and placement (decision vs start vs project) are locked in
ADR 0006. New stocks can reuse the same shapes without a new handler per
fiction.
