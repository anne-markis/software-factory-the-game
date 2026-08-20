import type { GameContent, GameState } from "./types";
import type { Rng } from "./rng";
import { effectiveDebtMultiplier, effectiveRate, pruneExpired } from "./modifiers";
import { continuousDeployActive } from "./continuousDeploy";
import { detectArchetypes } from "./archetypes";
import { detectMilestones } from "./milestones";
import { attachInjectedWork, committedWork, unshippedWork } from "./work";

// Release 3 replaces this stub with real challenge rolling.
export type ChallengePhase = (state: GameState, rng: Rng, content: GameContent) => void;

export function log(state: GameState, message: string): void {
  state.log.push({ day: state.day, message });
  if (state.log.length > 200) state.log.shift();
}

// Attribute shipped points FIFO across projects, pay revenue and bonuses.
// Release 1 always has exactly one project; the FIFO loop already handles many.
// Shipped points with no project in flight intentionally earn nothing (no contract, no pay).
//
// Surplus (pipeline work not committed to any in-flight remaining) ships
// first and is not credited. That leftover is rework injected while no
// contract was running; crediting it would complete the next project early
// (ADR 0009). Extra work injected *during* a contract is attached onto
// remaining, so it delays that contract instead of becoming surplus.
function attributeShipped(state: GameState, shippedFlow: number): void {
  const pipelineBefore = unshippedWork(state) + shippedFlow;
  const surplus = Math.max(0, pipelineBefore - committedWork(state));
  let remaining = Math.max(0, shippedFlow - Math.min(shippedFlow, surplus));
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
      // Studio spine (issue #88): pay any stock grants recorded on this
      // project (the Launch beta grants +30 users, which is what flips the
      // users economy on). Clamp at 0 like every other stock write. Log a
      // users grant when non-zero so the beta launch reads clearly.
      for (const grant of p.completionStockGrants ?? []) {
        state.stocks[grant.stock] = Math.max(0, state.stocks[grant.stock] + grant.amount);
        if (grant.stock === "users" && grant.amount !== 0) {
          log(state, `${p.name}: +${grant.amount} users`);
        }
      }
      state.completedProjects += 1;
      log(state, `Project complete: ${p.name} (+$${p.completionBonus} bonus, +${p.reputationReward} reputation)`);
      state.projects.shift();
    }
  }
}

// Always-on stock flows (Studio organic acquisition, issue #88). Runs after
// shipping, once per configured flow whose condition holds. Deterministic (no
// rng): grossGain (flat acquirePerDay plus acquirePerStock.perUnit per point
// of another stock, e.g. reputation) minus churn (stocks[stock] *
// churnRatePerDay), clamped at 0. stockFlowMods owned by decisions add to the
// flow's acquirePerDay / churnRatePerDay (Studio ships none). Base churn only.
function runStockFlows(state: GameState, content: GameContent): void {
  state.userAcquireFlow = 0;
  state.userChurnFlow = 0;
  for (const flow of content.start.stockFlows ?? []) {
    if (flow.condition?.minCompletedProjects !== undefined && state.completedProjects < flow.condition.minCompletedProjects) {
      continue;
    }
    let acquirePerDay = flow.acquirePerDay ?? 0;
    let churnRate = flow.churnRatePerDay ?? 0;
    for (const inst of state.decisions) {
      const def = content.decisions.find((d) => d.id === inst.defId);
      for (const mod of def?.stockFlowMods ?? []) {
        if (mod.stock !== flow.stock) continue;
        acquirePerDay += mod.acquirePerDayDelta ?? 0;
        churnRate += mod.churnRateDelta ?? 0;
      }
    }
    const fromStock = flow.acquirePerStock ? state.stocks[flow.acquirePerStock.stock] * flow.acquirePerStock.perUnit : 0;
    const grossGain = acquirePerDay + fromStock;
    const churnAmount = state.stocks[flow.stock] * churnRate;
    if (flow.stock === "users") {
      state.userAcquireFlow += grossGain;
      state.userChurnFlow += churnAmount;
    }
    state.stocks[flow.stock] = Math.max(0, state.stocks[flow.stock] + grossGain - churnAmount);
  }
}

function chargeUpkeep(state: GameState, content: GameContent, rng: Rng): void {
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
  state.userIncomeFlow = 0;
  for (const inst of snapshot) {
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    if (def.incomePerDay) totalIncome += def.incomePerDay;
    // Studio monetization (issue #85): income scaled by a stock's level,
    // stacked on top of any flat incomePerDay. The subscription card reads
    // users; useless at 0 users (contributes exactly 0).
    if (def.incomeFromStock) {
      const fromStock = state.stocks[def.incomeFromStock.stock] * def.incomeFromStock.perUnit;
      totalIncome += fromStock;
      if (def.incomeFromStock.stock === "users") state.userIncomeFlow += fromStock;
    }
    // Probabilistic income burst scaled by a stock's level (one-time-product
    // card). Rolled per owned decision each day; on a hit it credits
    // stocks[stock] * perUnit. Netted into the same income step as everything
    // else so it is consumed by burn like flat income (issue #13 semantics).
    if (def.burstFromStock) {
      if (rng.next() < def.burstFromStock.probabilityPerDay) {
        const burst = state.stocks[def.burstFromStock.stock] * def.burstFromStock.perUnit;
        if (burst > 0) {
          totalIncome += burst;
          if (def.burstFromStock.stock === "users") state.userIncomeFlow += burst;
          log(state, `${def.name}: +$${burst.toFixed(0)} from a product sale burst`);
        }
      }
    }
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
  // Studio spine (issue #88): tech debt always accrues, but it only refills
  // the backlog once the first project (the Launch beta) has completed. This
  // gives the beta a clean 300-point burndown -- no debt-driven backlog growth
  // fighting the very first delivery -- while preserving the reinforcing
  // debt->rework loop for every project after it.
  //
  // ADR 0009: refill is injected work. Attach it onto the oldest in-flight
  // contract so rework delays delivery instead of FIFO-counting as progress.
  // With no project in flight it stays unattributed surplus.
  if (state.completedProjects >= 1) {
    state.stocks.backlog += debtGain;
    attachInjectedWork(state, debtGain);
  }

  // Organic stock flows (users acquisition) run after shipping/debt and read
  // this tick's completedProjects, so they turn on the same tick the beta
  // completes. Deterministic; see runStockFlows.
  runStockFlows(state, content);

  // Archetype narration reads this tick's settled techDebt (drag) and the
  // owned decision set; each fires at most once per game. Runs before
  // chargeUpkeep so a payroll-failure removal later this tick does not race
  // the ownership counts, matching the pre-flow reads elsewhere.
  detectArchetypes(state, content, log);
  detectMilestones(state, content, log);

  chargeUpkeep(state, content, rng);

  state.pointsPerDay = shippedFlow;
  state.pullFlow = pullFlow;
  state.finishFlow = finishFlow;
  state.rngState = rng.getState();
}
