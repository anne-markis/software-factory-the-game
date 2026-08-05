import type { GameContent, GameState } from "../engine/types";

// Days of runway at or below this threshold get a visual Budget warning.
// Issue #37 suggested ~10–14 days; pick the upper end so players see the
// telegraph with a little reaction time at 5x.
export const RUNWAY_WARN_DAYS = 14;

// Recurring cash drain only: base burn + owned per-day upkeep, minus owned
// incomePerDay. Shipping revenue and one-time costs are excluded — issue #37
// called out recurring burn as the cliff that blindsided the player.
export function netRecurringBurnPerDay(state: Readonly<GameState>, content: GameContent): number {
  let payroll = 0;
  let income = 0;
  for (const inst of state.decisions) {
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    payroll += def.cost.perDay ?? 0;
    income += def.incomePerDay ?? 0;
  }
  return state.baseBurnPerDay + payroll - income;
}

// Whole days until budget cannot cover another day of recurring burn.
// null when burn is not positive (no drain / net income) — callers must not
// show a low-runway warning in that case.
export function budgetRunwayDays(state: Readonly<GameState>, content: GameContent): number | null {
  const burn = netRecurringBurnPerDay(state, content);
  if (burn <= 0) return null;
  return Math.floor(state.stocks.budget / burn);
}
