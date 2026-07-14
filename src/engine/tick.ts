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
// Shipped points with no project in flight intentionally earn nothing (no contract, no pay).
function attributeShipped(state: GameState, shippedFlow: number): void {
  let remaining = shippedFlow;
  while (remaining > 0 && state.projects.length > 0) {
    const p = state.projects[0];
    const applied = Math.min(remaining, p.remaining);
    p.remaining -= applied;
    state.stocks.budget += applied * p.payoutPerPoint;
    remaining -= applied;
    // Epsilon tolerance: float drift from fractional flows could otherwise
    // strand a project at a tiny positive remainder forever.
    if (p.remaining <= 1e-9) {
      state.stocks.budget += p.completionBonus;
      state.completedProjects += 1;
      log(state, `Project complete: ${p.name} (+$${p.completionBonus} bonus)`);
      state.projects.shift();
    }
  }
}

function chargeUpkeep(state: GameState, content: GameContent): void {
  // Clamp at 0 deliberately per the design spec: budget never goes negative;
  // insolvency manifests as payroll failure removals, not a negative balance.
  state.stocks.budget = Math.max(0, state.stocks.budget - state.baseBurnPerDay);
  const snapshot = [...state.decisions];
  // Credit ALL income before charging ANY payroll, so income from a
  // later-purchased decision can rescue an earlier decision's payroll;
  // otherwise outcomes would depend arbitrarily on purchase order.
  for (const inst of snapshot) {
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (def?.incomePerDay) state.stocks.budget += def.incomePerDay;
  }
  for (const inst of snapshot) {
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
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
