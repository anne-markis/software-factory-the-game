# Software Factory: Cockpit Layout Design (Release 22)

Date: 2026-07-22
Status: Draft for review
Part of: 2026-07-22-ux-arc.md, increment 2

## 1. Goal

Stop the shop from pushing the machine off screen. Today the page is 2.4
screens tall, the "Alter the loop" panel is 56 percent of it, and the
player scrolls away from the loops to spend and back to watch. Turn the
page into a cockpit: a fixed top region that always shows the
instruments and the machine, and a scrolling body below it where the
shop, projects, owned list, and events live behind tabs so only one is
open at a time.

Chosen model (agreed): sticky top, scrolling tabs. Lowest risk, keeps
the current render structure.

## 2. Structure

`#app` becomes a full-height flex column:

- Header (fixed, does not scroll): stats bar, time controls, a
  pending-choice banner when one is active, and both loop diagrams.
- Body (flex-fills the rest, scrolls internally): a tab bar and the one
  active tab's panel.

Implemented as flex, not CSS `position: sticky`: `html, body { height:
100% }`, `#app { display: flex; flex-direction: column; height: 100vh
}`, header `flex: 0 0 auto`, body `flex: 1 1 auto; overflow-y: auto`.
This avoids the sticky-overlap problem (no content scrolls behind the
header, so the header needs no opaque background hack against the
project's currently-implicit page background) and gives the body its own
scroll region.

## 3. Header height budget

Stats plus time controls plus both loop diagrams can approach 730px,
which would starve the body on a laptop viewport. The loops are capped:
their container gets `max-height` around 42vh with `overflow-y: auto`,
so on a tall screen everything shows and on a short one the loops scroll
within their own bounded region rather than eating the whole viewport.
Stats, time controls, and the choice banner are compact and always fully
shown.

## 4. The scroll-reset bug (must fix)

The app rebuilds `#app.innerHTML` every tick. With an internally
scrolling body, a naive rebuild resets the body's `scrollTop` to 0 on
every render, i.e. five times a second at 5x: the player is yanked to
the top of the shop constantly.

Fix: capture the scrolling body's `scrollTop` before writing innerHTML
and restore it after. The structure is recreated identically each
render, so a numeric restore is correct. Guard for the element being
absent on first render. This is not optional polish; the layout is
unusable without it.

(A fuller fix is incremental rendering rather than full innerHTML
replacement, which would also cut render cost. Out of scope here and
worth its own release; the scrollTop restore is the correct minimal fix
for this increment.)

## 5. Tabs

Body tabs, one active at a time: Build (the "Alter the loop" tech tree),
Projects, Owned, Events (the log). The tab bar sits at the top of the
scrolling body. The active tab is a UI preference stored under its own
localStorage key (the speed-preference pattern), restored on load,
defaulting to Build. Tab buttons carry `data-tab` and route through the
existing `#app` click delegation. The active tab button is marked with
the established dimming/weight vocabulary, no new color, fixed-width so
the bar never reflows.

The current right sidebar (`.cols` / `.side` holding choices and log)
is retired: the log becomes the Events tab; pending choices move to the
header banner (section 6).

## 6. Pending-choice banner (folded from increment 3)

A timed choice must never hide behind an unselected tab. When
`state.pendingChoices` is non-empty, the header renders the existing
choice UI as a prominent banner (reuse `renderChoices`), below the loops
and above the body. When there is no pending choice the banner is
absent and costs no space. This is the minimum event-prominence needed
to make tabs safe; the fuller goal and event work is still increment 3.

## 7. What is kept

Stats no-reflow stability (Release 14), the loop diagrams, the tech
tree, speed controls, the monospace restraint. Nothing in the engine
changes; this is all `src/ui` and `index.html`, and the purity test
stays green.

## 8. Testing

- Rendering: the header renders stats, time controls, and both loops;
  the body renders the tab bar and only the active tab's panel (assert
  the non-active panels are absent from the markup). The active tab
  marker follows a tab change. The choice banner appears in the header
  only when a choice is pending.
- Tab preference: round-trips through storage; missing or invalid falls
  back to Build (extract and unit-test the pure validation helper, as
  speed did, since localStorage is absent in the node test env).
- The scroll-restore is DOM behaviour and browser-verified rather than
  unit-tested (jsdom has no layout); the verification step must confirm
  the body holds its scroll position across several ticks at 5x.
- Existing tests updated for the retired sidebar and the tabbed body;
  engine and purity untouched.

## 9. Risks

- Only the active tab is in the DOM, so a change in a hidden tab (a
  contract completing under Projects while Build is open) is unseen
  until the player switches. The choice banner covers the urgent case;
  the next-goal and completion signals in increment 3 cover the rest.
  Accepted for this increment, with increment 3 sequenced next.
- Header height on very short viewports: mitigated by the loops'
  max-height scroll. If it still feels cramped in playtesting, a
  collapse-the-loops toggle is the cheap follow-up, deliberately not
  built now to keep the increment small.
- Full innerHTML rebuild each tick remains; the scrollTop restore makes
  it usable but does not make it cheap. Incremental rendering is the
  real answer and is left for its own release.
