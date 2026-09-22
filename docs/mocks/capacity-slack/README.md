# Mock: capacity slack on the delivery line

Open [`index.html`](index.html) in a browser. Static proposal only — not
wired to the engine.

**Ask:** adding or removing capacity looks free when the line is still
shipping the same amount. The arrows print realized flow, so unused
review capacity and extra In Progress seats do not move a number that
reads as output.

This folder is **one mock**. The steppers redraw the same snapshot two
ways: **Today** and **Slack visible**. They open with review at 4.0/day
so the unused capacity is on screen immediately. Drop review back to
2.1 and the two drawings agree again.

## What is on screen

The four boxes match the continuous-deploy line in the screenshot:
Ready 1,249, In Progress, In Review, Shipped 30,643.3. Ideas and Plan
are omitted; they already print their capacity on the box. Debt drag
still tints the flow arrows amber. The dashed return is still
`debt +0.3/pt`. KTLO still reserves 0.5/day under the finish arrow and
still holds 1 seat.

**Today** is the live diagram. In Progress shows the open-seat stock.
The arrows show what flowed. A matched line reads 2.1/day on every arrow.

**Slack visible** keeps that realized number and adds the unused part:

- In Progress shows `open / all seats`, counting the KTLO seat in the
  total. The footnote spells the split (`1 open · 1 KTLO`). Full and
  matched, the fraction is the only change.
- An arrow whose capacity is above what it realized reads
  `2.1/day of 4.0`, and the shaft is amber only for the used share.
  The rest of the shaft is dim. A matched arrow stays a single rate
  and a solid shaft.
- The Ready → In Progress arrow has no capacity of its own. It stays
  the realized pull.

In Review still gets the capacity-bound cue when finish is at least
1.5× review. The stock on that box is a sketch of three days of review
outflow so the cue has a pile to sit on. It is not a ticked save.

## What the steppers are showing

| Move | Shipped | Today | Slack visible |
| --- | --- | --- | --- |
| Add review above finish | stays | ship arrow unchanged | `2.1/day of …` on that arrow |
| Add an open seat | stays | In Progress stock +1 | fraction denominator +1 |
| Raise finish above review | finish arrow rises | both drawings show the faster finish arrow and, once the pile qualifies, capacity-bound | same, plus slack only where a rate is unused |
| Remove the last open seat | finish stops | finish arrow `0.0/day` | `0.0/day of <finish>` |

Illustrative numbers, not a balance pass. Nothing here changes tick
math, saves, or what a hire actually does.
