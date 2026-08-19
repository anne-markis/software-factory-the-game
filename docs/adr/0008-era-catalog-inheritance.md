# ADR 0008: Era catalog inheritance

- **Status:** Accepted
- **Date:** 2026-08-19
- **Issues:** follow-on to [#90](https://github.com/anne-markis/software-factory-the-game/issues/90) / ADR 0001

## Context

Owned decision instances look up live defs from the active catalog
(`content.decisions.find(id)`). If a later era omits a Studio id, that
instance stops paying and billing — a silent exploit, not a flavor beat.

ADR 0001’s first carry tactic was to **relist** every Studio id in
Company and Megacorp JSON. That kept billing honest without a new engine
flag, but it does not scale: Studio still needs more cards, and copying
the whole catalog into every later folder duplicates JSON and drifts.

P0.2 already wanted `start` + current era + carry, with prior defs still
resolvable even when they are not “new shop” in that folder.

## Decision

**Later era folders are deltas.** `loadActiveContent` resolves:

```
resolved(era) = resolved(previous era) + this era’s files
```

The starting era is the source of truth for its cards. Company JSON
lists only Company-native cards; Megacorp only Megacorp-native cards.
Empty later files are valid: the resolved catalog is still the inherited
one, so owned Studio instances keep paying after the shop swaps.

Redeclaring an inherited id in a later file is a load error. Do not copy
a card forward. Do not relist the same id at a new price (owned upkeep
would change underfoot).

A later-era card may `requires` an inherited id; refs are checked against
the **resolved** catalog, not the single file.

The graph viewer plots **native** cards per era column (the ids this
folder introduced). Inherited cards stay in the earlier column.

## Rejected

- Keep copy-pasting Studio JSON into every later era.
- Snapshot defs onto save instances (save-shape change).
- A `carry: true` field on each Studio card (extra schema for the same
  ladder merge).
- One monolithic `decisions.json` with an `era` field (ADR 0001 reject).
- Omitting an inherited id as a way to retire it from later shops (omit
  now means inherit). Retirement/hide is a future flag, not deletion.

## Consequences

Studio can grow without touching Company or Megacorp files. New later-era
cards go in that era’s folder. Tick still does not hardcode era names.
Authoring and architecture guides must not teach relisting.
