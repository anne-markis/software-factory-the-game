import type { GameContent, GameState } from "./types";

function ownedCount(state: Pick<GameState, "decisions">, defId: string): number {
  return state.decisions.filter((d) => d.defId === defId).length;
}

/**
 * In Progress seats. Parallel to effectiveRate, but a different number:
 * speed is finish; this is how much can be in progress at once.
 *
 * Terms, in order:
 * 1. `state.baseCapacity` (founder seats from start.json)
 * 2. each owned instance's `DecisionDef.capacity` (hires are +1; agents omit it)
 * 3. `capacityFromOwned` on an owned def, once per def id (future: +1 per agent)
 * 4. `modifyCapacity` modifiers, add then mul, not sickness-scaled
 *
 * Does not name `agent` or `human`. A later card adds seats by setting
 * `capacity` / `capacityFromOwned` / `modifyCapacity` in content.
 */
export function effectiveCapacity(state: GameState, content: GameContent): number {
  let value = state.baseCapacity;
  const seenFromOwned = new Set<string>();
  for (const inst of state.decisions) {
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    value += def.capacity ?? 0;
    if (def.capacityFromOwned && !seenFromOwned.has(def.id)) {
      seenFromOwned.add(def.id);
      for (const grant of def.capacityFromOwned) {
        value += ownedCount(state, grant.id) * grant.per;
      }
    }
  }
  for (const m of state.modifiers) {
    if (m.target === "capacity" && m.op === "add") value += m.value;
  }
  for (const m of state.modifiers) {
    if (m.target === "capacity" && m.op === "mul") value *= m.value;
  }
  return Math.max(0, value);
}

/**
 * Finish at `finishRate` from the Ready+In Progress pool into In Review,
 * then split what remains so In Progress is `min(capacity, leftover)` and
 * Ready holds the rest. Speed decides how much moves; a point is in one
 * stage. Empty seats fill from Ready the same tick; extra above capacity
 * spills back to Ready.
 */
export function applySeatCapacity(
  state: Pick<GameState, "stocks">,
  capacity: number,
  finishRate: number,
): { finishFlow: number; pullFlow: number } {
  const readyBefore = state.stocks.backlog;
  const pool = state.stocks.backlog + state.stocks.inProgress;
  if (capacity <= 0) {
    state.stocks.backlog = pool;
    state.stocks.inProgress = 0;
    return { finishFlow: 0, pullFlow: 0 };
  }
  const finishFlow = Math.min(Math.max(0, finishRate), pool);
  const leftover = pool - finishFlow;
  state.stocks.inReview += finishFlow;
  state.stocks.inProgress = Math.min(capacity, leftover);
  state.stocks.backlog = leftover - state.stocks.inProgress;
  const pullFlow = Math.max(0, readyBefore - state.stocks.backlog);
  return { finishFlow, pullFlow };
}
