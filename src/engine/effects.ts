import type { Effect, GameState, ModifierTarget } from "./types";

let modifierCounter = 0;

export interface EffectContext {
  instanceId?: string;
}

export function applyEffects(state: GameState, effects: Effect[], source: string, ctx: EffectContext = {}): void {
  for (const effect of effects) {
    switch (effect.type) {
      case "modifyRate": {
        const target: ModifierTarget = effect.target === "all" ? "allRates" : effect.target;
        state.modifiers.push({
          id: `mod-${++modifierCounter}`,
          source,
          target,
          op: effect.op,
          value: effect.value,
          expiresDay: effect.durationDays !== undefined ? state.day + effect.durationDays : undefined,
        });
        break;
      }
      case "modifyDebtMultiplier":
        state.modifiers.push({
          id: `mod-${++modifierCounter}`,
          source,
          target: "debtMultiplier",
          op: effect.op,
          value: effect.value,
          expiresDay: effect.durationDays !== undefined ? state.day + effect.durationDays : undefined,
        });
        break;
      case "addToStock":
        state.stocks[effect.stock] = Math.max(0, state.stocks[effect.stock] + effect.value);
        break;
      case "sickness": {
        const inst = state.decisions.find((d) => d.instanceId === ctx.instanceId);
        if (inst) {
          inst.sickUntilDay = state.day + effect.durationDays;
          inst.sickFactor = effect.factor;
        }
        break;
      }
    }
  }
}
