import type { Effect, GameContent, GameState, Modifier, ModifierTarget } from "./types";
import { log } from "./tick";
import { attachInjectedWork, isPipelineStock } from "./work";

export interface EffectContext {
  instanceId?: string;
  // Required for effects that consult decision defs (removeHuman). Optional
  // elsewhere so existing call sites stay unchanged.
  content?: GameContent;
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

function humanDevInstances(state: GameState, content: GameContent) {
  return state.decisions.filter((inst) => {
    const def = content.decisions.find((d) => d.id === inst.defId);
    return def?.human === true;
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
      case "addToStock": {
        const before = state.stocks[effect.stock];
        state.stocks[effect.stock] = Math.max(0, before + effect.value);
        if (isPipelineStock(effect.stock)) attachInjectedWork(state, state.stocks[effect.stock] - before);
        break;
      }
      case "scaleStock": {
        // Immediate, like addToStock: no modifier is created, so a scaled
        // stock does not show up as a Friction/Cycle-speed/Leak-size
        // contributor in the Progress system panel -- only a paired
        // modifyRate effect in the same purchase (the shape the retired
        // refactor/rebuild cards used) would surface there. factor 0 wipes the
        // stock entirely; factor > 1 (a future challenge doubling backlog,
        // say) is schema-legal too. Clamped at 0 like every other stock write.
        // ADR 0009: a pipeline-stage scale is injected/removed work, so one
        // in-flight remaining (engine-picked when several are live) moves by
        // the actual clamped delta.
        const before = state.stocks[effect.stock];
        state.stocks[effect.stock] = Math.max(0, before * effect.factor);
        if (isPipelineStock(effect.stock)) attachInjectedWork(state, state.stocks[effect.stock] - before);
        break;
      }
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
        // sickFactor (modifiers.ts). No shipped card ramps today, and a ramp is
        // a machine rather than a person, so no ramp source is sick-able; a
        // future sick-able one would have its contribution scaled while sick.
        pushModifier(state, source, effect.target, "add", 0, undefined, { perDay: effect.perDay, cap: effect.cap });
        break;
      case "continuousDeploy":
        // Marker effect only: it carries no numeric parameters and creates
        // no modifier. tick.ts derives activation directly from ownership
        // via continuousDeployActive, so there is nothing to apply here.
        break;
      case "removeHuman": {
        // Challenge-driven roster loss (a poaching-style choice option; no
        // Studio challenge uses it today, see challenges.json). Ignores
        // DecisionDef.removable the same way payroll failure does -- the
        // person left, whether or not the player could have clicked Remove.
        // No-ops without content or when no human remains (defensive: the
        // challenge condition should have required minHumanDevs >= 1).
        if (!ctx.content) break;
        const humans = humanDevInstances(state, ctx.content);
        const target =
          (ctx.instanceId !== undefined ? humans.find((h) => h.instanceId === ctx.instanceId) : undefined) ?? humans[0];
        if (!target) break;
        const def = ctx.content.decisions.find((d) => d.id === target.defId);
        state.decisions = state.decisions.filter((d) => d.instanceId !== target.instanceId);
        state.modifiers = state.modifiers.filter((m) => m.source !== target.instanceId);
        if (def) log(state, `Lost: ${def.name}`);
        break;
      }
    }
  }
}
