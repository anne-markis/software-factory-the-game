# Mock: capacity slack on the delivery line

Open [`index.html`](index.html) in a browser. Static proposal only — not
wired to the engine.

**Ask:** adding or removing capacity looks free when the line is still
shipping the same amount. The arrows print realized flow, so unused
review capacity does not move a number that reads as output.

**KTLO:** Keep the lights on does not take a seat. Its finish drag
(−0.5/day) is in the open In Progress panel, with cycle speed and leak,
not on the arrow.

This folder is **one mock**. The steppers redraw the same snapshot two
ways: **Today** and **Slack visible**. They open with review at 4.0/day
so the unused capacity is on screen immediately. Drop review back to
2.1 and the two drawings agree again.

## What is on screen

The four boxes match the continuous-deploy line in the screenshot:
Ready 1,249, In Progress, In Review, Shipped 30,643.3. Ideas and Plan
are omitted; they already print their capacity on the box. Debt drag
still tints the flow arrows amber. The dashed return is still
`debt +0.3/pt`.

Above the diagrams, Keep the lights on is an always-open project row.
It is On, and it does not take a seat. The −0.5/day drag is not drawn
on the arrow.

**Today** shows the open-seat stock and realized flow. A matched line
reads 2.1/day on every arrow.

**Slack visible** keeps that realized number and adds the unused part:

- An arrow whose capacity is above what it realized reads
  `2.1/day of 4.0`, and the shaft is amber only for the used share.
  The rest of the shaft is dim. A matched arrow stays a single rate
  and a solid shaft.
- The Ready → In Progress arrow has no capacity of its own. It stays
  the realized pull.
- In Progress stays a seat count. Adding a seat changes that count.
  It does not change the KTLO drag.

In Review still gets the capacity-bound cue when finish is at least
1.5× review. The stock on that box is a sketch of three days of review
outflow so the cue has a pile to sit on. It is not a ticked save.

## What the steppers are showing

| Move | Shipped | Today | Slack visible |
| --- | --- | --- | --- |
| Add review above finish | stays | ship arrow unchanged | `2.1/day of …` on that arrow |
| Add an open seat | stays | In Progress stock +1 | same stock change; drag stays −0.5/day |
| Raise finish above review | finish arrow rises | both drawings show the faster finish arrow and, once the pile qualifies, capacity-bound | same, plus slack only where a rate is unused |
| Remove the last open seat | finish stops | finish arrow `0.0/day` | `0.0/day of <finish>` |

Illustrative numbers, not a balance pass. Nothing here changes review
slack, debt, or what a hire actually does. Keep the lights on drags
finish and does not take a seat.
