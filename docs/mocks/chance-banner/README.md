# Mock: a quick banner for chance events

Open [`index.html`](index.html) in a browser. Static proposal only — not
wired to the engine.

**Ask:** an event the player did not start, and that a roll decided,
should show a quick banner. A click whose result is still a roll (Raise
a round, a hire) already has the hire reveal. That reveal stays. It
does not get a second banner.

The page is three treatments of the same moment: Day 86, speed 5×,
Production incident just fired. The Events log still gets the line in
every treatment.

1. **Same strip as the hire reveal.** One amber line, sticky, gone
   after 5 seconds. The clock keeps running.
2. **Hit or gift bar.** Same timing. A hit reuses the Insolvent wash.
   A gift reuses the users-chip wash. The second frame on that mock is
   Cloud credit, so the two tones sit next to each other.
3. **Soft pause.** Same bar as 2. The clock stops until Resume.

Recommendation is 1. It is the chrome the cockpit already uses for a
roll, pointed at the lines that today only reach the log.

## Side effects if 1 is the one we build

- The view paints the existing reveal slot when a qualifying line is
  logged. The engine stays free of DOM.
- A reload does not replay a banner. The log line is still there. No
  save-schema bump.
- One new line replaces the previous one. A quit and a challenge on
  the same day share the slot.
- Will not change challenge odds, gamble tables, the choice interrupt,
  or the Insolvent strip.
