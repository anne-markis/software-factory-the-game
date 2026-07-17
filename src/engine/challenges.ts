import type { ChallengeDef, GameContent, GameState } from "./types";
import type { Rng } from "./rng";
import { applyEffects } from "./effects";
import { log } from "./tick";

function humanDevInstances(state: GameState, content: GameContent) {
  return state.decisions.filter((inst) => {
    const def = content.decisions.find((d) => d.id === inst.defId);
    return def?.human === true;
  });
}

function conditionMet(def: ChallengeDef, state: GameState, content: GameContent): boolean {
  const cond = def.condition;
  if (!cond) return true;
  const humans = humanDevInstances(state, content).length;
  if (cond.minHumanDevs !== undefined && humans < cond.minHumanDevs) return false;
  if (cond.maxHumanDevs !== undefined && humans > cond.maxHumanDevs) return false;
  if (cond.minTechDebt !== undefined && state.stocks.techDebt < cond.minTechDebt) return false;
  if (cond.minDay !== undefined && state.day < cond.minDay) return false;
  if (cond.hasTag !== undefined) {
    const ownedTags = new Set(
      state.decisions.flatMap((inst) => content.decisions.find((d) => d.id === inst.defId)?.tags ?? []),
    );
    if (!ownedTags.has(cond.hasTag)) return false;
  }
  return true;
}

function probability(def: ChallengeDef, state: GameState): number {
  let p = def.probabilityPerDay;
  if (def.probScaling) {
    p += Math.floor(state.stocks.techDebt / def.probScaling.per) * def.probScaling.add;
  }
  return Math.min(1, p);
}

function fire(def: ChallengeDef, state: GameState, instanceId?: string): void {
  if (def.choice) {
    if (state.pendingChoices.some((pc) => pc.challengeId === def.id)) return; // one at a time
    state.pendingChoices.push({ challengeId: def.id, expiresDay: state.day + def.choice.expiresInDays });
    log(state, `Decision needed: ${def.name} (${def.choice.expiresInDays} days to respond)`);
    return; // queueing does not start the cooldown clock; resolveChoice/expiry-default does
  }
  applyEffects(state, def.effects, `chal-${def.id}-d${state.day}`, { instanceId });
  log(state, `${def.name}: ${def.description}`);
  if (def.cooldownDays !== undefined) state.challengeLastFired[def.id] = state.day;
}

function cooldownActive(def: ChallengeDef, state: GameState): boolean {
  if (def.cooldownDays === undefined) return false;
  const lastFired = state.challengeLastFired[def.id];
  if (lastFired === undefined) return false;
  return state.day < lastFired + def.cooldownDays;
}

export function resolveChoice(state: GameState, content: GameContent, challengeId: string, optionId: string): void {
  const pending = state.pendingChoices.find((pc) => pc.challengeId === challengeId);
  if (!pending) throw new Error(`No pending choice for ${challengeId}`);
  const def = content.challenges.find((c) => c.id === challengeId);
  const option = def?.choice?.options.find((o) => o.id === optionId);
  if (!def || !option) throw new Error(`Unknown option ${optionId} for ${challengeId}`);
  applyEffects(state, option.effects, `choice-${challengeId}-d${state.day}`);
  log(state, `${def.name}: chose "${option.label}"`);
  state.pendingChoices = state.pendingChoices.filter((pc) => pc.challengeId !== challengeId);
  if (def.cooldownDays !== undefined) state.challengeLastFired[challengeId] = state.day;
}

export function rollChallenges(state: GameState, rng: Rng, content: GameContent): void {
  // expire pending choices first: apply defaults
  for (const pending of [...state.pendingChoices]) {
    if (pending.expiresDay <= state.day) {
      const def = content.challenges.find((c) => c.id === pending.challengeId);
      if (def?.choice) {
        const fallback = def.choice.options.find((o) => o.id === def.choice!.defaultOptionId)!;
        applyEffects(state, fallback.effects, `choice-${def.id}-d${state.day}`);
        log(state, `${def.name}: expired, defaulted to "${fallback.label}"`);
        if (def.cooldownDays !== undefined) state.challengeLastFired[def.id] = state.day;
      }
      state.pendingChoices = state.pendingChoices.filter((pc) => pc !== pending);
    }
  }

  for (const def of content.challenges) {
    if (!conditionMet(def, state, content)) continue;
    // same rule as conditionMet/minDay: skip without consuming an rng draw
    if (cooldownActive(def, state)) continue;
    if (def.perHumanDev) {
      for (const inst of humanDevInstances(state, content)) {
        if (rng.next() < probability(def, state)) fire(def, state, inst.instanceId);
      }
    } else {
      if (rng.next() < probability(def, state)) fire(def, state);
    }
  }
}
