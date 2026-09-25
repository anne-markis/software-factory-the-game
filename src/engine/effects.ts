import type { DecisionInstance, Effect, GameContent, GameState, Modifier, ModifierTarget, StockName } from "./types";
import { log } from "./tick";
import { attachInjectedWork, isPipelineStock } from "./work";
import { instanceIsActive } from "./roster";

export interface EffectContext {
  instanceId?: string;
  // Required for effects that consult decision defs (removeHuman). Optional
  // elsewhere so existing call sites stay unchanged.
  content?: GameContent;
  // Set when these effects are a decision purchase. addToStock then honors
  // active owners' scaleDecisionGrant factors for this def id.
  decisionId?: string;
}

/** Copy the last autoSchedule effect onto the instance that owns these effects. */
export function recordAutoSchedule(inst: DecisionInstance, effects: Effect[]): void {
  for (const effect of effects) {
    if (effect.type !== "autoSchedule") continue;
    inst.autoSchedule = {
      projectIds: [...effect.projectIds],
      ideaCostFactor: effect.ideaCostFactor,
      cashReserve: effect.cashReserve,
      skipWhenBurnExceedsIncome: effect.skipWhenBurnExceedsIncome,
    };
  }
}

/** Copy scaleDecisionGrant rows onto the instance that owns these effects. */
export function recordGrantScales(inst: DecisionInstance, effects: Effect[]): void {
  const scales = effects.flatMap((effect) =>
    effect.type === "scaleDecisionGrant"
      ? [{ targetDecision: effect.targetDecision, stock: effect.stock, factor: effect.factor }]
      : [],
  );
  if (scales.length > 0) inst.grantScales = scales;
}

/** Highest active scale for this purchase, or 1 when nobody is scaling it. */
export function decisionGrantFactor(state: GameState, decisionId: string, stock: StockName): number {
  let best: number | undefined;
  for (const inst of state.decisions) {
    if (!instanceIsActive(inst, state.day)) continue;
    for (const scale of inst.grantScales ?? []) {
      if (scale.targetDecision !== decisionId || scale.stock !== stock) continue;
      best = best === undefined ? scale.factor : Math.max(best, scale.factor);
    }
  }
  return best ?? 1;
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
  scaleFromHumansPer?: number,
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
    scaleFromHumansPer,
  });
}

function humanDevInstances(state: GameState, content: GameContent) {
  return state.decisions.filter((inst) => {
    if (!instanceIsActive(inst, state.day)) return false;
    const def = content.decisions.find((d) => d.id === inst.defId);
    return def?.human === true;
  });
}

/** Clamp a stock write: never below 0, never above GameState.stockMax when set. */
export function clampStock(state: Pick<GameState, "stockMax">, stock: StockName, value: number): number {
  const floor = Math.max(0, value);
  const cap = state.stockMax?.[stock];
  return cap === undefined ? floor : Math.min(cap, floor);
}

/**
 * Owned modifiers are snapshotted at purchase. A save that bought the agent
 * ladder before plan was on those cards has no plan modifier to reload.
 * Grant each owned instance the plan-targeted modifyRate from the effects it
 * was bought under (base, or the synergy recorded on the instance). Gamble
 * outcomes stay as stored. Idempotent: a later load does not stack a second copy.
 */
export function grantMissingPlanRates(state: GameState, content: GameContent): void {
  for (const inst of state.decisions) {
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    const syn = (def.synergies ?? []).find((s) => s.ifOwned === inst.appliedSynergyIfOwned);
    const effects = syn?.effects ?? def.effects;
    for (const effect of effects) {
      if (effect.type !== "modifyRate" || effect.target !== "plan") continue;
      const already = state.modifiers.some(
        (m) => m.source === inst.instanceId && m.target === "plan" && m.op === effect.op,
      );
      if (already) continue;
      pushModifier(
        state,
        inst.instanceId,
        "plan",
        effect.op,
        effect.value,
        effect.durationDays,
        undefined,
        effect.scaleFromHumansPer,
      );
    }
  }
}

/** Copy human flags and scaleFromHumansPer from current content onto live state. */
export function hydrateHumanScale(state: GameState, content: GameContent): void {
  for (const inst of state.decisions) {
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (def?.human === true) inst.human = true;
    else delete inst.human;
    if (def?.agent === true) inst.agent = true;
    else delete inst.agent;
    if (!def) continue;
    const syn = (def.synergies ?? []).find((s) => s.ifOwned === inst.appliedSynergyIfOwned);
    const effects = syn?.effects ?? def.effects;
    for (const effect of effects) {
      if (effect.type !== "modifyRate" || effect.scaleFromHumansPer === undefined) continue;
      const target = effect.target === "all" ? "allRates" : effect.target;
      for (const m of state.modifiers) {
        if (m.source === inst.instanceId && m.target === target && m.op === effect.op) {
          m.scaleFromHumansPer = effect.scaleFromHumansPer;
        }
      }
    }
  }
}

export function applyEffects(state: GameState, effects: Effect[], source: string, ctx: EffectContext = {}): void {
  for (const effect of effects) {
    switch (effect.type) {
      case "modifyRate": {
        const target: ModifierTarget = effect.target === "all" ? "allRates" : effect.target;
        pushModifier(
          state,
          source,
          target,
          effect.op,
          effect.value,
          effect.durationDays,
          undefined,
          effect.scaleFromHumansPer,
        );
        break;
      }
      case "modifyDebtMultiplier":
        pushModifier(state, source, "debtMultiplier", effect.op, effect.value, effect.durationDays);
        break;
      case "addToStock": {
        const factor = ctx.decisionId ? decisionGrantFactor(state, ctx.decisionId, effect.stock) : 1;
        const before = state.stocks[effect.stock];
        state.stocks[effect.stock] = clampStock(state, effect.stock, before + effect.value * factor);
        if (isPipelineStock(effect.stock)) attachInjectedWork(state, state.stocks[effect.stock] - before);
        break;
      }
      case "scaleDecisionGrant":
        // Stored on the owning instance via recordGrantScales when the
        // effects land. Nothing to apply to stocks or modifiers here.
        break;
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
        state.stocks[effect.stock] = clampStock(state, effect.stock, before * effect.factor);
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
      case "modifyCapacity":
        pushModifier(state, source, "capacity", effect.op, effect.value, effect.durationDays);
        break;
      case "keepProject":
        // Marker only. scheduleKeptProjects reads the owning def each tick.
        break;
      case "sellCompany":
        throw new Error("sellCompany is applied by the engine, not as a stock effect");
      case "autoSchedule":
        // Stored on the owning instance via recordAutoSchedule when the
        // effects land. The tick pursues from that policy.
        break;
      case "modifyKtloCash":
        pushModifier(state, source, "ktloCash", "add", effect.perDay, effect.durationDays);
        break;
    }
  }
}
