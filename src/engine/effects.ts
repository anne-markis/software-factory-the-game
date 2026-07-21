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
  ramp?: { perDay: number; cap: number },
): void {
  state.modifiers.push({
    id: `mod-${state.nextModifierId++}`,
    source,
    target,
    op,
    value,
    expiresDay: durationDays !== undefined ? state.day + durationDays : undefined,
    rampPerDay: ramp?.perDay,
    rampCap: ramp?.cap,
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
      case "scaleStock":
        // Immediate, like addToStock: no modifier is created, so a scaled
        // stock does not show up as a Friction/Cycle-speed/Leak-size
        // contributor in the Progress loop panel -- only a paired
        // modifyRate effect in the same purchase (as refactoring-sprint and
        // redesign-rebuild both do) would surface there. factor 0 wipes the
        // stock entirely; factor > 1 (a future challenge doubling backlog,
        // say) is schema-legal too. Clamped at 0 like every other stock write.
        state.stocks[effect.stock] = Math.max(0, state.stocks[effect.stock] * effect.factor);
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
      case "rampRate":
        // Starts at 0 and grows by perDay each tick, capped, via tick.ts's
        // ramp-growth pass. It is otherwise an ordinary add-op modifier, so
        // removal-by-source (removeDecision, payroll failure) strips it free.
        // Note: add-op modifiers are scaled by their source instance's
        // sickFactor (modifiers.ts). Today no ramp source is sick-able
        // (self-learning agents are not human); a future sick-able ramp
        // source would have its ramped contribution scaled while sick.
        pushModifier(state, source, effect.target, "add", 0, undefined, { perDay: effect.perDay, cap: effect.cap });
        break;
      case "continuousDeploy":
        // Marker effect only: it carries no numeric parameters and creates
        // no modifier. tick.ts derives activation directly from ownership
        // via continuousDeployActive, so there is nothing to apply here.
        break;
    }
  }
}
