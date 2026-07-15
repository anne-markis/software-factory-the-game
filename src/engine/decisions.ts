import type { DecisionDef, GameContent, GameState, GambleOutcome } from "./types";
import type { Rng } from "./rng";
import { applyEffects } from "./effects";
import { log } from "./tick";

export interface Availability {
  def: DecisionDef;
  purchasable: boolean;
  reason?: string;
}

function owned(state: GameState, defId: string): boolean {
  return state.decisions.some((d) => d.defId === defId);
}

export function availability(state: GameState, content: GameContent): Availability[] {
  return content.decisions.map((def) => {
    const missing = (def.requires ?? []).filter((r) => !owned(state, r));
    if (missing.length > 0) return { def, purchasable: false, reason: `requires ${missing.join(", ")}` };
    const oneTime = def.cost.oneTime ?? 0;
    if (state.stocks.budget < oneTime) return { def, purchasable: false, reason: "cannot afford" };
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

export function applyDecision(state: GameState, content: GameContent, defId: string, rng: Rng): void {
  const entry = availability(state, content).find((a) => a.def.id === defId);
  if (!entry) throw new Error(`Unknown decision: ${defId}`);
  if (!entry.purchasable) {
    throw new Error(entry.reason === "cannot afford" ? `Cannot afford ${defId}` : `${defId} ${entry.reason}`);
  }
  const def = entry.def;
  state.stocks.budget -= def.cost.oneTime ?? 0;

  const synergy = (def.synergies ?? []).find((s) => owned(state, s.ifOwned));
  const effects = synergy?.effects ?? def.effects;
  const gamble = synergy?.gamble ?? def.gamble;

  const instanceId = `inst-${state.nextInstanceId++}`;
  const instance = { instanceId, defId: def.id } as GameState["decisions"][number];

  applyEffects(state, effects, instanceId);
  if (gamble) {
    const outcome = rollGamble(gamble, rng);
    instance.gambleLabel = outcome.label;
    applyEffects(state, outcome.effects, instanceId);
    log(state, `${def.name}: ${outcome.label}`);
  } else {
    log(state, `Purchased: ${def.name}`);
  }
  state.decisions.push(instance);
  state.rngState = rng.getState();
}

export function removeDecision(state: GameState, content: GameContent, instanceId: string): void {
  const inst = state.decisions.find((d) => d.instanceId === instanceId);
  if (!inst) throw new Error(`Unknown instance: ${instanceId}`);
  const def = content.decisions.find((d) => d.id === inst.defId);
  if (def && !def.removable) throw new Error(`${def.name} cannot be removed`);
  state.decisions = state.decisions.filter((d) => d.instanceId !== instanceId);
  state.modifiers = state.modifiers.filter((m) => m.source !== instanceId);
  if (def) log(state, `Removed: ${def.name}`);
}
