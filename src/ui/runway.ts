import { agentSeatCount, scaledDecisionCost } from "../engine/agentCost";
import type { GameContent, GameState } from "../engine/types";
import { ktloBurnPerDay } from "../engine/ktlo";
import { instanceIsActive } from "../engine/roster";

// Days of runway at or below this threshold get a visual Budget warning.
// Suggested ~10–14 days; pick the upper end so players see the
// telegraph with a little reaction time at 5x.
export const RUNWAY_WARN_DAYS = 14;

// Recurring cash drain only: KTLO cash + owned per-day upkeep, minus owned
// incomePerDay. Shipping revenue and one-time costs are excluded —
// recurring burn is the cliff that blindsided the player.
export function netRecurringBurnPerDay(state: Readonly<GameState>, content: GameContent): number {
  let payroll = 0;
  let income = 0;
  for (const inst of state.decisions) {
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    payroll += instanceIsActive(inst, state.day)
      ? scaledDecisionCost(def, agentSeatCount(state), "perDay")
      : 0;
    income += def.incomePerDay ?? 0;
    // Studio monetization: steady per-day income scaled by a stock
    // (subscription reads users) counts as recurring income at the current
    // stock level, so runway reflects the user-driven subscription revenue.
    // burstFromStock is deliberately excluded here -- per-user sales are
    // noisy, not a guaranteed recurring line, matching how one-time costs
    // are excluded.
    if (def.incomeFromStock) {
      income += state.stocks[def.incomeFromStock.stock] * def.incomeFromStock.perUnit;
    }
  }
  return ktloBurnPerDay(state, content) + payroll - income;
}

// Whole days until budget cannot cover another day of recurring burn.
// null when burn is not positive (no drain / net income) — callers must not
// show a low-runway warning in that case.
export function budgetRunwayDays(state: Readonly<GameState>, content: GameContent): number | null {
  const burn = netRecurringBurnPerDay(state, content);
  if (burn <= 0) return null;
  return Math.floor(state.stocks.budget / burn);
}
