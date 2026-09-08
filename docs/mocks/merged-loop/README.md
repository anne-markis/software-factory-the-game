# Mock: merge Delivery with the Progress zoom

Static HTML sketches of folding the Progress inner-loop zoom into the
idea-to-value (Delivery) spine. Open [`index.html`](index.html) in a
browser (the game CSS is inlined; nothing here is wired to the engine).

These are scoping pictures, not a committed layout. The live cockpit is
unchanged.

## The duplication

The Delivery diagram already paints Ideas → Plan → Ready → **In Progress**
→ Done → Shipped. The Progress panel then retells In Progress as its own
loop: cycle speed, friction, an ellipse, an exit rate, and a rework leak
that refills Ready. Finish flow, the debt/rework leak, and In Progress
itself therefore appear twice. On a fresh game the zoom is almost empty;
mid-game it earns its keep, but as a sibling rather than a zoom.

## Three directions (same mid-game numbers)

| | A · Inline | B · Callout | C · Strip |
| --- | --- | --- | --- |
| In Progress | The ellipse *is* the stage | Box stays; zoom hangs under it | Box stays; no ellipse |
| Nested-systems read | One diagram | Strongest “this box is that loop” | Contributors only |
| Vertical space | One panel + User full-width | Similar to today, one figure | Smallest |
| Duplicate leak / finish | Collapsed onto the spine | Outer leak kept; inner leak in the zoom | Collapsed onto the spine |

Open the HTML for the pictures and the keep/drop/risk notes.
