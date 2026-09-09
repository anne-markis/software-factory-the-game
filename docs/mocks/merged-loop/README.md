# Mock: merge Delivery with the Progress zoom

Open [`index.html`](index.html) in a browser. These mocks are the design
history. The live cockpit ships **A3 + T3**: boxed cycle on In Progress,
caret-only full-width drawer, User loop on its own row, no sibling
Progress panel.

## Round 1 — three directions

A (inline) was the pick. B and C are parked in git history.

## Round 2 — inline variants

A3 (boxed cycle) was the pick: In Progress stays a rectangle; a small
cycle lives inside; contributors hang as a strip. Extensible to other
stages.

## Round 3 — A3 click-to-zoom

**T3 (caret only)** was the pick: the stage box is for watching; only ▾
opens a full-width drawer. Collapsed by default. One drawer at a time.
In Progress and Done both zoom so Ready/Shipped can reuse the pattern.

| | T1 · Hang | T2 · Drawer | T3 · Caret only | T4 · Peek chip |
| --- | --- | --- | --- | --- |
| Hit target | Whole stage box | Whole stage box | The ▾ only | The chip under the box |
| Open panel | Centered under that stage | Full-width under the spine | Full-width under the spine | Full-width under the spine |
| Discoverability | Caret on the box | Caret on the box | Caret is the only cue | Chip names what you will get |
