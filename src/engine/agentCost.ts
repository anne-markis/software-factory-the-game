import type { DecisionDef, GameState } from "./types";
import { humanHeadcount } from "./modifiers";

/**
 * Humans who each need their own coding agent. The founder counts as one
 * seat; pending hires do not, matching the rest of the roster.
 */
export function agentSeatCount(state: Pick<GameState, "decisions" | "day">): number {
  return 1 + humanHeadcount(state);
}

/** Authored oneTime / perDay. Coding agents (`agent: true`) bill once per seat. */
export function scaledDecisionCost(
  def: Pick<DecisionDef, "agent" | "cost">,
  seats: number,
  field: "oneTime" | "perDay",
): number {
  const base = def.cost[field] ?? 0;
  if (!def.agent || base === 0) return base;
  return base * seats;
}
