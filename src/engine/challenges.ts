import type { ChallengeDef, GameContent, GameState } from "./types";
import type { Rng } from "./rng";
import { hashRoll } from "./rng";
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
  if (cond.lacksDecision !== undefined) {
    if (state.decisions.some((inst) => inst.defId === cond.lacksDecision)) return false;
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

// Returns whether the challenge actually fired (effects applied or a new
// choice queued). False for the "already pending" no-op so callers -- the
// global spacing gap in rollChallenges -- don't treat a no-op as an event.
function fire(def: ChallengeDef, state: GameState, instanceId?: string): boolean {
  if (def.choice) {
    if (state.pendingChoices.some((pc) => pc.challengeId === def.id)) return false; // one at a time
    state.pendingChoices.push({ challengeId: def.id, expiresDay: state.day + def.choice.expiresInDays });
    log(state, `Decision needed: ${def.name} (${def.choice.expiresInDays} days to respond)`);
    return true; // queueing does not start the cooldown clock; resolveChoice/expiry-default does
  }
  applyEffects(state, def.effects, `chal-${def.id}-d${state.day}`, { instanceId });
  log(state, `${def.name}: ${def.description}`);
  if (def.cooldownDays !== undefined) state.challengeLastFired[def.id] = state.day;
  return true;
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

// The `rng` parameter is retained only to satisfy the ChallengePhase signature
// that tick.ts calls through; the challenge phase no longer consumes the shared
// stream at all. Each challenge rolls a stateless hashRoll keyed by its own id
// (plus the human instance id, for perHumanDev challenges), so adding or
// reordering content leaves every existing challenge's rolls untouched. Gamble
// rolls on decision purchases still use the shared stream (see decisions.ts).
export function rollChallenges(state: GameState, _rng: Rng, content: GameContent): void {
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

  // Global event spacing: after any challenge fires (effects applied or a
  // choice queued -- either counts, the player is already dealing with it),
  // no challenge may fire until challengeSpacingDays elapses. lastChallengeDay
  // is undefined until the first-ever fire, so the spacing gap never blocks
  // the opening days of a game. spacingDays 0 disables the gap (the
  // inequality below can then never hold, since lastChallengeDay is always <=
  // state.day by the time it's read). Note this is checked once per tick,
  // before the roll loop -- it does not re-check mid-loop -- so it composes
  // with the same-tick break below rather than duplicating it.
  const spacingDays = content.start.challengeSpacingDays;
  const spacingActive = state.lastChallengeDay !== undefined && state.day < state.lastChallengeDay + spacingDays;
  if (spacingActive) return;

  outer: for (const def of content.challenges) {
    if (!conditionMet(def, state, content)) continue;
    if (cooldownActive(def, state)) continue;
    if (def.perHumanDev) {
      // Per-human rolls are keyed by instanceId as well as def id: independent
      // per instance, and stable across content edits (instance ids are stable
      // within a game).
      for (const inst of humanDevInstances(state, content)) {
        if (hashRoll(state.gameSeed, state.day, `${def.id}:${inst.instanceId}`) < probability(def, state)) {
          if (fire(def, state, inst.instanceId)) {
            state.lastChallengeDay = state.day;
            // One event at a time: stop rolling further challenges this tick.
            // Gated on spacingDays > 0 so spacing-disabled games keep the
            // legacy same-tick multi-fire behavior existing tests pin.
            if (spacingDays > 0) break outer;
          }
        }
      }
    } else {
      if (hashRoll(state.gameSeed, state.day, def.id) < probability(def, state)) {
        if (fire(def, state)) {
          state.lastChallengeDay = state.day;
          if (spacingDays > 0) break outer;
        }
      }
    }
  }
}
