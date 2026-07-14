import type { GameContent, GameState } from "./types";
import type { Rng } from "./rng";
import { effectiveDebtMultiplier, effectiveRate, pruneExpired } from "./modifiers";

// Release 3 replaces this stub with real challenge rolling.
export type ChallengePhase = (state: GameState, rng: Rng, content: GameContent) => void;

export function log(state: GameState, message: string): void {
  state.log.push({ day: state.day, message });
  if (state.log.length > 200) state.log.shift();
}

// Attribute shipped points FIFO across projects, pay revenue and bonuses.
// Release 1 always has exactly one project; the FIFO loop already handles many.
function attributeShipped(state: GameState, shippedFlow: number): void {
  let remaining = shippedFlow;
  while (remaining > 0 && state.projects.length > 0) {
    const p = state.projects[0];
    const applied = Math.min(remaining, p.remaining);
    p.remaining -= applied;
    state.stocks.budget += applied * p.payoutPerPoint;
    remaining -= applied;
    if (p.remaining <= 0) {
      state.stocks.budget += p.completionBonus;
      state.completedProjects += 1;
      log(state, `Project complete: ${p.name} (+$${p.completionBonus} bonus)`);
      state.projects.shift();
    }
  }
}

function chargeUpkeep(state: GameState, content: GameContent): void {
  state.stocks.budget = Math.max(0, state.stocks.budget - state.baseBurnPerDay);
  for (const inst of [...state.decisions]) {
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    if (def.incomePerDay) state.stocks.budget += def.incomePerDay;
    const perDay = def.cost.perDay ?? 0;
    if (perDay === 0) continue;
    if (state.stocks.budget >= perDay) {
      state.stocks.budget -= perDay;
    } else {
      state.decisions = state.decisions.filter((d) => d.instanceId !== inst.instanceId);
      state.modifiers = state.modifiers.filter((m) => m.source !== inst.instanceId);
      log(state, `Payroll failed: ${def.name} removed permanently`);
    }
  }
}

export function tick(state: GameState, rng: Rng, content: GameContent, challengePhase: ChallengePhase): void {
  if (state.paused) return;
  state.day += 1;
  pruneExpired(state);
  challengePhase(state, rng, content);

  const deployRate = effectiveRate(state, "deploy");
  const finishRate = effectiveRate(state, "finish");
  const pullRate = effectiveRate(state, "pull");

  // Downstream first so a point cannot cross the whole pipeline in one day.
  const shippedFlow = Math.min(state.stocks.done, deployRate);
  state.stocks.done -= shippedFlow;
  state.stocks.shipped += shippedFlow;

  const finishFlow = Math.min(state.stocks.inProgress, finishRate);
  state.stocks.inProgress -= finishFlow;
  state.stocks.done += finishFlow;

  const pullFlow = Math.min(state.stocks.backlog, pullRate);
  state.stocks.backlog -= pullFlow;
  state.stocks.inProgress += pullFlow;

  attributeShipped(state, shippedFlow);

  const debtGain = shippedFlow * effectiveDebtMultiplier(state);
  state.stocks.techDebt += debtGain;
  state.stocks.backlog += debtGain;

  chargeUpkeep(state, content);

  state.pointsPerDay = shippedFlow;
  state.rngState = rng.getState();
}
