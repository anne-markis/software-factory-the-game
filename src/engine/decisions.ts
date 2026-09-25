import type { DecisionDef, DecisionInstance, Effect, GameContent, GameState, GambleOutcome, RateId } from "./types";
import type { Rng } from "./rng";
import { applySeatCapacity, effectiveCapacity } from "./capacity";
import { applyEffects, clampStock, recordAutoSchedule, recordGrantScales } from "./effects";
import { agentSeatCount, scaledDecisionCost } from "./agentCost";
import { instanceIsActive } from "./roster";
import { isDeliveryFrozen, log, syncHumanQuitRate } from "./tick";

export type AvailabilityCode = "missing-requires" | "cannot-afford" | "already-owned";

export interface Availability {
  def: DecisionDef;
  purchasable: boolean;
  code?: AvailabilityCode;
  reason?: string;
}

function authoredEffects(def: DecisionDef): Effect[] {
  const effects = [...def.effects];
  for (const outcome of def.gamble ?? []) effects.push(...outcome.effects);
  return effects;
}

/** True when any authored effect or gamble outcome uses modifyRate on this id (not `"all"`). */
export function decisionTargetsExactRate(def: DecisionDef, rate: RateId): boolean {
  return authoredEffects(def).some((e) => e.type === "modifyRate" && e.target === rate);
}

function owned(state: GameState, defId: string): boolean {
  return state.decisions.some((d) => d.defId === defId);
}

function ownedCount(state: GameState, defId: string): number {
  return state.decisions.filter((d) => d.defId === defId).length;
}

function defName(content: GameContent, defId: string): string {
  return content.decisions.find((d) => d.id === defId)?.name ?? defId;
}

export function availability(state: GameState, content: GameContent): Availability[] {
  return content.decisions.map((def) => {
    if (def.unique && owned(state, def.id)) {
      return { def, purchasable: false, code: "already-owned" as const, reason: "already owned" };
    }
    const missing = (def.requires ?? []).filter((r) => !owned(state, r)).map((id) => defName(content, id));
    // Count gates are the same kind of lock as `requires`, so they
    // share its reason line -- the count is spelled out because "requires Add
    // coding agent" would read as satisfied to a player who owns one.
    for (const gate of def.requiresCounts ?? []) {
      if (ownedCount(state, gate.id) < gate.count) {
        missing.push(`${gate.count}x ${defName(content, gate.id)}`);
      }
    }
    if (missing.length > 0) {
      return { def, purchasable: false, code: "missing-requires" as const, reason: `requires ${missing.join(", ")}` };
    }
    const oneTime = scaledDecisionCost(def, agentSeatCount(state), "oneTime");
    if (state.stocks.budget < oneTime) {
      return { def, purchasable: false, code: "cannot-afford" as const, reason: "cannot afford" };
    }
    return { def, purchasable: true };
  });
}

function rollGamble(table: GambleOutcome[], rng: Rng): GambleOutcome {
  const roll = rng.next();
  let cumulative = 0;
  for (const outcome of table) {
    cumulative += outcome.probability;
    if (roll < cumulative) return outcome;
  }
  return table[table.length - 1];
}

/** Fill empty seats from Ready, or spill extra back, without finishing work. */
function rebalanceSeats(state: GameState, content: GameContent): void {
  if (isDeliveryFrozen(state)) return;
  applySeatCapacity(state, effectiveCapacity(state, content), 0);
}

/** Own a decision without paying oneTime or rolling a gamble. Used at new-game start. */
export function grantDecision(state: GameState, content: GameContent, defId: string): void {
  const def = content.decisions.find((d) => d.id === defId);
  if (!def) return;
  if (state.decisions.some((d) => d.defId === defId)) return;
  const instanceId = `inst-${state.nextInstanceId++}`;
  const instance: DecisionInstance = { instanceId, defId: def.id };
  if (def.human) instance.human = true;
  if (def.agent) instance.agent = true;
  applyEffects(state, def.effects.filter((e) => e.type !== "sellCompany"), instanceId, { decisionId: def.id, content });
  state.decisions.push(instance);
}

export type ApplyDecisionHooks = {
  sellCompany?: (budgetGrant: number) => void;
};

export function applyDecision(
  state: GameState,
  content: GameContent,
  defId: string,
  rng: Rng,
  hooks?: ApplyDecisionHooks,
): void {
  const entry = availability(state, content).find((a) => a.def.id === defId);
  if (!entry) throw new Error(`Unknown decision: ${defId}`);
  if (!entry.purchasable) {
    throw new Error(
      entry.code === "cannot-afford" ? `Cannot afford ${entry.def.name}` : `${entry.def.name}: ${entry.reason}`,
    );
  }
  const def = entry.def;
  const sale = def.effects.find((e) => e.type === "sellCompany");
  if (sale?.type === "sellCompany") {
    if (!hooks?.sellCompany) throw new Error(`${def.name} requires the engine to start a new company`);
    hooks.sellCompany(sale.budgetGrant);
    return;
  }
  state.stocks.budget -= scaledDecisionCost(def, agentSeatCount(state), "oneTime");

  // Synergy ownership is evaluated at purchase time only; removing the
  // synergy provider later does not revert instances purchased under it. The
  // choice is recorded on the instance so consumers can tell which variant
  // this instance actually got (see archetypes.ts's debt mitigation check).
  const synergy = (def.synergies ?? []).find((s) => owned(state, s.ifOwned));
  const effects = synergy?.effects ?? def.effects;
  // The card's own synergy wins. Otherwise an active owner may replace the
  // whole table (pending hires do not). Purchase-time only.
  const provided = synergy?.gamble
    ? undefined
    : state.decisions
        .filter((inst) => instanceIsActive(inst, state.day))
        .map((inst) => content.decisions.find((d) => d.id === inst.defId))
        .flatMap((owner) => owner?.replacesGamble ?? [])
        .find((row) => row.id === def.id)?.gamble;
  const gamble = synergy?.gamble ?? provided ?? def.gamble;

  const instanceId = `inst-${state.nextInstanceId++}`;
  const instance: DecisionInstance = { instanceId, defId: def.id };
  if (def.human) instance.human = true;
  if (def.agent) instance.agent = true;
  if (synergy) instance.appliedSynergyIfOwned = synergy.ifOwned;

  const queued: Effect[] = [...effects];
  let gambleLabel: string | undefined;
  if (gamble) {
    const outcome = rollGamble(gamble, rng);
    gambleLabel = outcome.label;
    instance.gambleLabel = outcome.label;
    queued.push(...outcome.effects);
  }

  const delay = def.delayDays;
  if (delay) {
    instance.activeOnDay = state.day + delay;
    instance.pendingEffects = queued;
    log(
      state,
      gambleLabel
        ? `${def.name}: ${gambleLabel}, joining in ${delay} days`
        : `Purchased: ${def.name}, joining in ${delay} days`,
    );
  } else {
    recordGrantScales(instance, queued);
    recordAutoSchedule(instance, queued);
    applyEffects(state, queued, instanceId, { decisionId: def.id, content });
    log(state, gambleLabel ? `${def.name}: ${gambleLabel}` : `Purchased: ${def.name}`);
  }
  state.decisions.push(instance);
  rebalanceSeats(state, content);
  state.rngState = rng.getState();
}

export function removeDecision(state: GameState, content: GameContent, instanceId: string): void {
  const inst = state.decisions.find((d) => d.instanceId === instanceId);
  if (!inst) throw new Error(`Unknown instance: ${instanceId}`);
  const def = content.decisions.find((d) => d.id === inst.defId);
  if (def && !def.removable) throw new Error(`${def.name} cannot be removed`);
  const moraleHit = def?.human === true ? (content.start.humanRemovalMorale ?? 0) : 0;
  state.decisions = state.decisions.filter((d) => d.instanceId !== instanceId);
  state.modifiers = state.modifiers.filter((m) => m.source !== instanceId);
  rebalanceSeats(state, content);
  if (moraleHit > 0) {
    state.stocks.morale = clampStock(state, "morale", state.stocks.morale - moraleHit);
    syncHumanQuitRate(state, content);
  }
  if (def) {
    log(state, moraleHit > 0 ? `Removed: ${def.name}. Morale −${moraleHit}.` : `Removed: ${def.name}`);
  }
}
