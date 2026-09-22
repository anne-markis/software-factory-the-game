# Mock: rolled-up Income / Expenses titles

Open [`index.html`](index.html).

**Proposal:** the always-visible `<summary>` on each collapsible side panel
shows today's total, so a collapsed rail still answers "how much is coming
in / going out?"

- Income title uses latest-day `recurring + burst`
- Expenses title uses latest-day `human + agents + ktlo`
- Sparkline + per-bucket `/day` legend stay inside the open body
- Events and Owned titles stay as they are

Format on the mock: `Income: $534` / `Expenses: $491` (Budget-style `$`,
no `/day` on the heading). Variants are labeled on the page.
