import type { GameState } from "../engine/types";
import { unshippedWork } from "../engine/work";

// Derived lead time for the idea→value pile: everything not yet shipped
// (Ideas + Plan + Ready/In Progress/In Review/Done) ÷ current Points/Day.
// Informational only — no engine rule change. Matches project ETA voice (~Nd).

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Points still upstream of Shipped, including the Ideas and Plan piles. */
export function ideaToValuePoints(state: Pick<GameState, "stocks">): number {
  return state.stocks.ideas + state.stocks.plan + unshippedWork(state);
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
export function formatIdeaToValue(state: Pick<GameState, "stocks" | "pointsPerDay">): string {
  const days = ideaToValueDays(ideaToValuePoints(state), state.pointsPerDay);
  if (days === null) return "—";
  return `~${fmt(days)}d`;
}
