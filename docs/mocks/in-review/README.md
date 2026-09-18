# Mock: In Review between In Progress and Done

Open [`index.html`](index.html) in a browser. Static proposal only — not
wired to the engine.

**Ask:** the factory is missing **In Review**. It sits between In Progress
and Done, and it stays on the line **whether CI/CD exists or not**. Later
we need PR-review backup (agents and humans) and a card offered on this
stage.

This folder is **one mock** (R1), not a comparison set.

## R1 — queue + `review` rate (Done-shaped)

In Review is a **waiting pile**, same shape as Done today: unbounded
stock, outflow is a rate. It is **not** capacity (that is still In
Progress seats). CI/CD still only collapses **Done**.

```
without CI/CD:
  Ready → In Progress → In Review → Done → Shipped
  pull        finish         review      deploy

with CI/CD (`continuousDeploy`):
  Ready → In Progress → In Review → Shipped
  pull        finish         review
  (Done box gone; review still required)
```

Tick sketch (same order as today: drain downstream first):

1. Ship from Done (`deploy`, or dump all of Done if CD).
2. `reviewFlow = min(inReview, reviewRate)` → Done (or straight to Shipped
   when CD is on, so a point reviewed today ships next tick — same lag
   finish has vs Done today).
3. `applySeatCapacity`: finish leaves the Ready + In Progress pool into
   **In Review**, not Done.

Founder `baseRates.review` starts at **1/day**, matching `finish` and
`deploy`. Studio hires keep boosting only pull + finish (Release 15).
Coding outruns review the same way it already outruns deploy, so In
Review piles as the team grows. That pile **is** PR backup before any
reviewer card exists.

`modifyRate` `all` stays the delivery line: pull / finish / **review** /
deploy. Discover and plan stay off that line.

### Zoom (T3 caret, already shipped for IP / Done)

Collapsed: watch the box. ▾ opens the full-width drawer:

- **Review speed** — base rate; later humans / agents land here.
- **Why bound** — finish in vs review out vs pts waiting (same cue math
  Done uses).
- **Next lever** — shop cards whose authored `modifyRate` target is
  exactly `review` (human reviewer, review agent). Hidden until
  `requires` is met; Buy uses the same `data-buy` path as Alter the
  system.

## Pros

- Smallest engine story that matches “always there, CD or not.” CD
  already means “remove Done”; it does not have to learn a second skip.
- Same jam grammar as Done: pile grows, binding cue, scaling unlock is a
  card — not a new capacity system on day one.
- Zoom already exists (T3). Offering a card is a drawer slot, not a new
  surface.
- Leaves room to add **review seats** later (humans vs agents) without
  relocating the stock. Seats would cap how much can be *in* review at
  once; overflow can stay a waiting sub-count in the same box, the way
  Ready holds work that does not have an In Progress seat.

## Cons

- Seven boxes without CI/CD (six today). The spine gets tighter; CD
  still drops one box, so the post-CI/CD line is the same *count* as
  today’s no-CD line (Ready / IP / In Review / Shipped).
- Founder “reviews 1 pt/day” is fictional until a reviewer card exists.
  Cheap, but it is a new implicit role next to founder coding seats.
- One more bottleneck before ship. Launch beta (300 pts) gains a second
  queue after coding. Needs a probe retune, same class as Release 15.
- `all` including review means test-suite / CI/CD setup slowdowns and
  meeting-creep also throttle review. That is consistent; it is also a
  silent balance change.

## Side effects

- **Engine:** new stock `inReview`; `PIPELINE_STOCKS` becomes Ready → IP
  → In Review → Done. New rate id `review`. `unshippedWork` / cockpit
  Backlog add `inReview`. `drainUnshippedWork` takes In Review after IP.
  `applySeatCapacity` writes finish into `inReview`. Tick grows a
  `reviewFlow`. Binding cue can pick `inReview`. SAVE_VERSION bump
  (silent wipe, same as other stock/rate adds).
- **UI:** Delivery spine + T3 zoom on In Review; Done zoom copy no
  longer says finish lands here. `sf.points` parking keys grow.
  Content-graph “continuous deploy (removes Done)” stays true.
- **Content:** `start.json` seeds `inReview: 0` and `baseRates.review`.
  Hire `modifyRate` targets stay pull+finish (not review, not deploy).
  No new shop card in the first engine cut — the mock only shows the
  empty offer slot.
- **Will not (this mock / first cut):** review seats, agent vs human
  reviewers, merge-conflict challenges, changing what CI/CD does to
  Done, Ideas/Plan grammar.
- **Player surprise:** games that scale coding without CI/CD already
  jam in Done; they will also jam in In Review. CI/CD will no longer
  make the post-code line disappear — only the last queue before
  users. Existing saves wipe.

## Not this mock

Parked, not drawn:

- **Skip-as-label:** paint “In Review” on today’s Done. Cheap, but CI/CD
  would delete the stage the brief says must remain.
- **Seats on day one:** second `effectiveCapacity` for reviewers.
  Right endgame for agents + humans; too much schema for the first
  insertion. R1’s queue is the stock those seats would later fill.
