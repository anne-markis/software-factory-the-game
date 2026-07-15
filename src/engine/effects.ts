import type { Effect, GameState, Modifier, ModifierTarget } from "./types";

export interface EffectContext {
  instanceId?: string;
}

// Expiry semantics: durationDays counts from the current day (expiresDay =
// state.day + durationDays), and pruneExpired runs after the day increments,
// keeping only expiresDay > day. So a modifier applied between ticks (buys)
// is active for durationDays - 1 subsequent ticks, while one applied mid-tick
// (challenges) is active for durationDays ticks including the current one.
// This asymmetry is accepted behavior; content numbers are tuned around it.
function pushModifier(
  state: GameState,
  source: string,
  target: ModifierTarget,
  op: Modifier["op"],
  value: number,
  durationDays?: number,
): void {
  state.modifiers.push({
    id: `mod-${state.nextModifierId++}`,
    source,
    target,
    op,
    value,
    expiresDay: durationDays !== undefined ? state.day + durationDays : undefined,
  });
}

export function applyEffects(state: GameState, effects: Effect[], source: string, ctx: EffectContext = {}): void {
  for (const effect of effects) {
    switch (effect.type) {
      case "modifyRate": {
        const target: ModifierTarget = effect.target === "all" ? "allRates" : effect.target;
        pushModifier(state, source, target, effect.op, effect.value, effect.durationDays);
        break;
      }
      case "modifyDebtMultiplier":
        pushModifier(state, source, "debtMultiplier", effect.op, effect.value, effect.durationDays);
        break;
      case "addToStock":
        state.stocks[effect.stock] = Math.max(0, state.stocks[effect.stock] + effect.value);
        break;
      case "sickness": {
        const inst = state.decisions.find((d) => d.instanceId === ctx.instanceId);
        // Silently no-ops when the instance is gone; the challenge roller only
        // targets instances that exist in the same tick, so this is defensive,
        // not a reachable path today.
        if (inst) {
          inst.sickUntilDay = state.day + effect.durationDays;
          inst.sickFactor = effect.factor;
        }
        break;
      }
    }
  }
}
