# Mock: unit captions on the Delivery loop

Open [`index.html`](index.html) in a browser. Static proposal only — not
wired to the engine.

**Ask:** In Progress and In Review use the same big-number box, but the
numbers mean different things. In Progress is seats (capped). In Review
is an unbounded waiting pile. That makes a healthy seat fill look like
calm, and a normal PR queue look like the line is broken.

This folder is **one mock** of a UI-only read: name the unit on each
pipeline box, and stop saying `capacity-bound` on a queue.

## What stays the same

- Engine: In Review is still a Done-shaped rate, not seats.
- Arrows still show realized flow (`n/day`).
- Ideas / Plan still paint count + rate on the box.
- In Progress still has the cycle glyph.
- Zoom drawers are unchanged (this mock does not restyle them).

## What changes on the collapsed spine

| Box | Hero number | Caption |
| --- | --- | --- |
| Ideas / Plan | stock | `/day` capacity (already shipped) |
| Ready | stock | `waiting` |
| In Progress | occupied / capacity | `seats` |
| In Review | stock | `waiting` |
| Done | stock | `waiting` |
| Shipped | stock | (cumulative; no unit) |

Queue bottleneck cue: **backed up** (replaces `capacity-bound` on In
Review and Done). In Progress still never cues.

## Scenes in the HTML

1. **Same jam, today vs proposed** — coding 3.3/day, review 1.0/day,
   47 pts in In Review. Today the `1` and the `47` look like the same
   kind of number. Proposed: `1 / 1 seats` next to `47 waiting`.
2. **Founder, healthy** — finish ≈ review. IP `1 / 1 seats`, In Review
   `1 waiting`, no cue.
3. **After a hire** — IP `2 / 2 seats` (capacity grew; not a queue).
   In Review still waiting.
4. **CI/CD** — Done dropped; In Review still `waiting` + `backed up`.

Delivery strip under the spine uses the same units so the two surfaces
do not disagree.

## Not in this mock

- Review seats / overflow split (still a later engine cut).
- Retuning hire or agent rates.
- Changing zoom copy beyond what already says “waiting on PRs.”
