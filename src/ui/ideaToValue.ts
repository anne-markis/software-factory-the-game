import type { GameState } from "../engine/types";
import { unshippedWork } from "../engine/work";

// Derived lead time from Plan onward: named Plan item sizes plus everything
// not yet shipped, ÷ current Points/Day. Idle Ideas do not count — they
// have not been scheduled. Informational only. Matches project ETA voice (~Nd).

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function planItemSizes(state: Partial<Pick<GameState, "plan">>): number {
  return (state.plan ?? []).reduce((sum, item) => sum + item.size, 0);
}

/** Points in Plan (full item sizes) plus unshipped pipeline work. */
export function ideaToValuePoints(state: Pick<GameState, "stocks"> & Partial<Pick<GameState, "plan">>): number {
  return planItemSizes(state) + unshippedWork(state);
}

/** Whole days left at the current ship rate, or null when rate is ~0 / non-finite. */
export function ideaToValueDays(points: number, pointsPerDay: number): number | null {
  if (!(pointsPerDay > 0) || !Number.isFinite(pointsPerDay) || !Number.isFinite(points)) {
    return null;
  }
  if (points <= 0) return 0;
  return Math.ceil(points / pointsPerDay);
}

/** Player-facing cockpit fragment: "~Nd" or "—". */
export function formatIdeaToValue(
  state: Pick<GameState, "stocks" | "pointsPerDay"> & Partial<Pick<GameState, "plan">>,
): string {
  const days = ideaToValueDays(ideaToValuePoints(state), state.pointsPerDay);
  if (days === null) return "—";
  return `~${fmt(days)}d`;
}
