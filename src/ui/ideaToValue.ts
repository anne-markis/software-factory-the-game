import type { GameState } from "../engine/types";
import { unshippedWork } from "../engine/work";

// Derived lead time for committed work: each Plan item at full size (not
// fill progress) plus unshipped pipeline work, divided by current
// Points/Day. Idle Ideas are a wallet, not scheduled points, so discover
// and shop grants do not stretch this clock. Informational only — no
// engine rule change. Matches project ETA voice (~Nd).

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Committed points still upstream of Shipped: Plan item sizes + Ready through Done. */
export function ideaToValuePoints(state: Pick<GameState, "stocks" | "plan">): number {
  const planned = state.plan.reduce((sum, item) => sum + item.size, 0);
  return planned + unshippedWork(state);
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
export function formatIdeaToValue(state: Pick<GameState, "stocks" | "plan" | "pointsPerDay">): string {
  const days = ideaToValueDays(ideaToValuePoints(state), state.pointsPerDay);
  if (days === null) return "—";
  return `~${fmt(days)}d`;
}
