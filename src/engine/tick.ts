import type { GameContent, GameState } from "./types";
import type { Rng } from "./rng";
import { effectiveDebtMultiplier, effectiveRate, pruneExpired } from "./modifiers";
import { continuousDeployActive } from "./continuousDeploy";
import { detectArchetypes } from "./archetypes";
import { detectMilestones } from "./milestones";

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
      state.stocks.reputation += p.reputationReward;
      state.completedProjects += 1;
      log(state, `Project complete: ${p.name} (+$${p.completionBonus} bonus, +${p.reputationReward} reputation)`);
      state.projects.shift();
    }
  }
}

function chargeUpkeep(state: GameState, content: GameContent): void {
  const snapshot = [...state.decisions];
  // Net total incomePerDay against baseBurnPerDay in the same step, before
  // the zero-floor clamp below. Crediting income after an already-clamped
  // burn would throw the burn deficit away entirely once budget had been
  // driven to 0, turning any owned income decision into a permanent,
  // risk-free income stream instead of being consumed by ongoing burn
  // (issue #13). This still credits ALL income (from the same snapshot the
  // payroll loop below uses) before charging ANY payroll, so income from a
  // later-purchased decision can still rescue an earlier decision's payroll;
  // otherwise outcomes would depend arbitrarily on purchase order.
  let totalIncome = 0;
  for (const inst of snapshot) {
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (def?.incomePerDay) totalIncome += def.incomePerDay;
  }
  // Clamp at 0 deliberately per the design spec: budget never goes negative;
  // insolvency manifests as payroll failure removals, not a negative balance.
  state.stocks.budget = Math.max(0, state.stocks.budget - state.baseBurnPerDay + totalIncome);
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

  // Ramp growth runs after pruneExpired (so a modifier expiring this tick
  // doesn't grow first) and before challengePhase, so any challenge effect
  // that reads or stacks on rate modifiers this tick (and the in-progress
  // panel, which reads state after tick()) sees the ramp's current value,
  // not last tick's.
  for (const m of state.modifiers) {
    if (m.rampPerDay !== undefined && m.rampCap !== undefined) {
      m.value = Math.min(m.rampCap, m.value + m.rampPerDay);
    }
  }

  challengePhase(state, rng, content);

  const deployRate = effectiveRate(state, "deploy");
  const finishRate = effectiveRate(state, "finish");
  const pullRate = effectiveRate(state, "pull");

  // Downstream first so a point cannot cross the whole pipeline in one day.
  // Once continuous deploy is active (an owned decision's def carries a
  // continuousDeploy effect -- see continuousDeployActive), the Done stage
  // no longer queues: the entire done stock ships this tick, ignoring
  // deployRate entirely. This still runs BEFORE finish refills done below,
  // so a point that finishes into done later in this same tick ships next
  // tick, not this one -- a point still takes a full tick to cross each
  // remaining stage, the same ordering guarantee the throttled case relies
  // on. Everything downstream (FIFO project attribution, debt regen,
  // pointsPerDay) reads shippedFlow unchanged either way.
  const shippedFlow = continuousDeployActive(state, content)
    ? state.stocks.done
    : Math.min(state.stocks.done, deployRate);
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

  // Archetype narration reads this tick's settled techDebt (drag) and the
  // owned decision set; each fires at most once per game. Runs before
  // chargeUpkeep so a payroll-failure removal later this tick does not race
  // the ownership counts, matching the pre-flow reads elsewhere.
  detectArchetypes(state, content, log);
  detectMilestones(state, content, log);

  chargeUpkeep(state, content);

  state.pointsPerDay = shippedFlow;
  state.rngState = rng.getState();
}
