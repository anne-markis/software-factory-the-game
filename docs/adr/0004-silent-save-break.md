# ADR 0004: Silent save break on schema bump

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

The Studio spine changes starting stocks, the first project, and always-on
stock flows / drags. Later shop/challenge cuts remove ids a previous save
may still own. Migrating those saves into a coherent factory is not worth
the code.

## Decision

Bump `SAVE_VERSION` when the content/schema contract is incompatible.
`deserialize` rejects mismatched versions; the UI’s `loadGame` swallows
that error and starts a fresh game. Old saves are wiped **silently** —
no migration, no warning banner.

Shipped value as of named Plan items, the Plan stock, and the plan rate is
`SAVE_VERSION = 6` (v5 was the Ideas stock and discover faucet; v4 was the
Studio project redo; v3 was the lean Studio shop; v2 was the users /
Launch beta spine).

## Consequences

Authors and engine changes that invalidate in-flight ids or start config
must bump the version together. Do not add save-migration tables for
retired Studio cards.
