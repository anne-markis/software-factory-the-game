# ADR 0003: Local content-graph viewer

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Per-era JSON (ADR 0001) is hard to review as raw files. Authors need to see
requires / count gates, synergies, costs, and era-entry paths without
shipping a graph editor inside the player game.

## Decision

A separate tiny static tool under `tools/content-graph/`, started with
`make graph` (localhost only). It parses era bundles through the same Zod
loader as the game (`loadShippedContent`) and renders a layered DAG.

Not wired into the player shell. Not part of `npm run build` / deploy.

## Consequences

Authoring docs point at `make graph`. Viewer interaction polish can land
in follow-ups; the contract is “same parse path, local only.”
