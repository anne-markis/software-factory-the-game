# Software Factory: Speed Controls Design (Release 19)

Date: 2026-07-22
Status: Draft for review
Part of: 2026-07-22-ux-arc.md, increment 1

## 1. Goal

Let the player run the simulation faster than one day per second. Today
a day takes a real second, so the first contract completes around day
660 under a reasonable build: eleven real minutes of watching before the
reinforcing loop pays off. Every idle game solves this. It is the
smallest change with the largest effect on whether the game is fun.

Non-goal: changing any game rule. Speed alters how often the engine is
ticked, never what a tick does.

## 2. Speeds offered

Pause, 1x, 2x, 5x. Three running speeds keep the control compact and
cover the real use cases: 1x to watch a decision land, 2x for ordinary
play, 5x to cross a long stretch. A higher tier (10x or more) is
deliberately omitted for now: past roughly 5x the loop diagrams stop
reading as animation and the value of watching disappears, which is the
opposite of this game's point. Revisit if playtesting says otherwise.

Pause joins the speed buttons as one time-control group rather than
sitting apart, so all time manipulation is in one place.

## 3. Where speed lives (engine boundary)

Speed is a wall-clock presentation concern, not a game rule. It must
NOT enter the engine:

- Not in `GameState`. The engine's only time unit is `day`; it has no
  concept of how fast days arrive.
- Not in `content/start.json`. `StartConfig` is the engine's model, and
  putting a UI-only field there would pollute it. This is a deliberate
  exception to the values-in-content convention, which exists for game
  balance values, not presentation.

Speed options therefore live as a constant in the UI layer. The engine
purity test continues to guard the boundary.

Consequence worth stating: because the engine is untouched, the
simulation stays deterministic. N ticks produce identical state
regardless of the wall-clock rate at which they were issued, so a game
played at 5x is the same game as one played at 1x.

## 4. Tick driver

Replace the fixed `setInterval(tick, 1000)` with a fixed-timestep
accumulator, so render cadence is decoupled from tick cadence:

- A driver interval fires every 100ms.
- Each frame accumulates `elapsedMs * speed`; while the accumulator
  holds at least 1000ms, run one tick and subtract 1000.
- Render once per frame, only if at least one tick ran (or the UI is
  otherwise dirty from a click).

This keeps rendering at most ten times a second at any speed, rather
than rebuilding the DOM every 200ms at 5x, and it generalises cleanly if
a faster tier is ever added.

The accumulator arithmetic is extracted as a pure function so it can be
unit-tested without a DOM, following the codebase's existing pattern of
pure UI modules (techTree.ts, loopDiagram.ts):

`advance(accumulatorMs, elapsedMs, speed) -> { ticks, accumulatorMs }`

## 5. Background tabs: no offline progress

Browsers throttle timers in background tabs, so returning after minutes
away would otherwise produce a burst of hundreds of catch-up ticks.

Decision: the game does not simulate time spent away. If a frame's
elapsed time exceeds a threshold (2000ms), the driver treats it as a
gap, discards the excess, and resumes from the current moment. A
per-frame tick cap (20) is a second guard against a freeze.

Rationale: offline progress is a real idle-game feature but a design
decision in its own right (it interacts with payroll, challenge rolls
and the debt drag, none of which were tuned for unattended runs). Adding
it silently as a side effect of speed controls would be the wrong way to
introduce it. Recorded as a candidate in OPEN-DECISIONS if wanted later.

## 6. Persistence

Speed is a UI preference, not game state, so it is stored under its own
localStorage key rather than inside the game save. It restores on load.
An invalid or missing stored value falls back to 1x.

Pause remains where it is today: engine state, inside the save, since a
paused game is a property of the game rather than of the viewer.

## 7. Autosave interaction

Autosave currently fires when `day % 10 === 0`, checked once per
interval. With several ticks per frame that check must move inside the
per-tick loop, or a multiple of ten could be stepped over and a save
skipped. Event-driven saves (on purchase, pause, and so on) are
unaffected.

## 8. UI

A time-control group replacing the current bare Pause button:

`[Pause|Resume] [1x] [2x] [5x]`

The active speed is visually marked (the established dimming and
weight vocabulary; no color needed). Buttons are fixed-width so the
group never changes size, preserving the Release 14 no-reflow
guarantee. Clicks route through the existing `#app` delegation with
`data-speed` attributes, matching `data-buy` / `data-project`.

Keyboard: spacebar toggles pause. Cheap, standard, and useful when
watching a run. Ignored while focus is in a form control (there are none
today, but the guard keeps it safe).

## 9. Testing

- Pure accumulator: whole ticks at 1x; multiple ticks per frame at 5x;
  fractional remainders carried across frames rather than lost; the
  large-gap threshold discards rather than bursts; the per-frame cap
  holds.
- Speed preference: round-trips through storage; invalid and missing
  values fall back to 1x.
- Rendering: the time-control group renders all speeds with the active
  one marked; the marker follows a speed change.
- Engine untouched: existing engine tests must pass unchanged, and the
  purity test must stay green (no speed concept enters src/engine).

## 10. Risks

- Render cost at 5x: mitigated by the decoupled cadence (ten renders a
  second maximum, versus the current one). If profiling shows the
  full-innerHTML rebuild is too heavy at that rate, the fix is
  incremental rendering, which is out of scope here and worth doing on
  its own terms.
- Speed makes challenge pacing feel different (a 50-day spacing gap
  passes in ten seconds at 5x rather than fifty). This is expected and
  is part of why 5x is the ceiling; if events feel like a blur in
  playtesting, that is a pacing signal for content, not a bug in the
  driver.
