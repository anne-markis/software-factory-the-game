// Pure fixed-timestep tick accumulator (see docs/superpowers/specs/2026-07-22-speed-controls-design.md
// section 4). Decouples render cadence (driven by a 100ms wall-clock
// interval in main.ts) from tick cadence (driven by `speed`), so the engine
// itself never has to know how fast wall-clock time is passing. No DOM, no
// timers -- follows the codebase's existing pure-UI-module pattern
// (techTree.ts, loopDiagram.ts) so this can be unit-tested without a browser.

// Speed lives here, in the UI layer, deliberately: see design doc section 3.
// It must never leak into src/engine (GameState, StartConfig); the purity
// test (src/engine/purity.test.ts) guards that boundary.
export const SPEED_OPTIONS = [1, 2, 5] as const;
export type Speed = (typeof SPEED_OPTIONS)[number];
export const DEFAULT_SPEED: Speed = 1;

export const MS_PER_TICK = 1000;

// Background-tab guard (design doc section 5): a frame whose elapsed
// wall-clock time exceeds this is treated as a gap (tab was backgrounded,
// timers throttled) rather than real elapsed time to simulate. Zero ticks
// are emitted and the accumulator resets -- no offline progress, no burst.
export const LARGE_GAP_THRESHOLD_MS = 2000;

// Second guard against a runaway loop (e.g. a debugger pause, a slow frame):
// never emit more than this many ticks from a single call, regardless of
// how large the (non-gap) accumulator has grown. Any accumulator beyond the
// cap is dropped, not carried, so it cannot compound into future frames.
export const MAX_TICKS_PER_FRAME = 20;

export interface AdvanceResult {
  ticks: number;
  accumulatorMs: number;
}

export function advance(accumulatorMs: number, elapsedMs: number, speed: number): AdvanceResult {
  if (elapsedMs > LARGE_GAP_THRESHOLD_MS) {
    return { ticks: 0, accumulatorMs: 0 };
  }

  let acc = accumulatorMs + elapsedMs * speed;
  let ticks = 0;
  while (acc >= MS_PER_TICK && ticks < MAX_TICKS_PER_FRAME) {
    acc -= MS_PER_TICK;
    ticks++;
  }
  // Hit the cap with more still owed: drop the excess so it cannot
  // compound into the next frame's tick count.
  if (ticks === MAX_TICKS_PER_FRAME && acc >= MS_PER_TICK) {
    acc = 0;
  }

  return { ticks, accumulatorMs: acc };
}
