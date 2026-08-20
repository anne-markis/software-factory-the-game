# Architecture decision records

Locked P0.2 decisions for the decision-graph / era cut. Consult these
before authoring content or extending the loader. The architecture guide
(`docs/ARCHITECTURE.md`), authoring guide (`docs/CONTENT-AUTHORING.md`),
and glossary (`docs/CONTEXT.md`) must agree with this set.

| ADR | Title |
| --- | --- |
| [0001](0001-per-era-json-layout.md) | Per-era JSON layout |
| [0002](0002-retire-tags-and-tracks.md) | Retire tags and first-class tracks |
| [0003](0003-local-content-graph-viewer.md) | Local content-graph viewer |
| [0004](0004-silent-save-break.md) | Silent save break on schema bump |
| [0005](0005-generic-stock-linked-fields.md) | Generic stock-linked fields (approach) |
| [0006](0006-stock-linked-content-schema.md) | Stock-linked content JSON schema |
| [0007](0007-polyform-noncommercial.md) | PolyForm Noncommercial license |
| [0008](0008-era-catalog-inheritance.md) | Era catalog inheritance |
| [0009](0009-single-work-ledger.md) | Single work ledger |

When an ADR and `src/engine/` disagree, the code wins; update the ADR
deliberately rather than letting docs drift.
