import { isContractProject } from "./types";
import type {
  ActiveProject,
  DailyExpenses,
  GameContent,
  GameState,
  HeadcountFlag,
  StockFlowMod,
} from "./types";
import type { Rng } from "./rng";
import { sampleIndependentHits } from "./binomial";
import { agentSeatCount, scaledDecisionCost } from "./agentCost";
import { effectiveDebtMultiplier, effectiveRate, pruneExpired, scaledModifierValue } from "./modifiers";
import { continuousDeployActive } from "./continuousDeploy";
import { detectArchetypes } from "./archetypes";
import { detectMilestones } from "./milestones";
import { attachInjectedWork, committedWork, unshippedWork } from "./work";
import { advancePlan } from "./projects";
import { applySeatCapacity, effectiveCapacity } from "./capacity";
import { ktloBurnPerDay, productFinishRate, syncKtloBase } from "./ktlo";
import { applyEffects, clampStock, recordGrantScales } from "./effects";
import { instanceIsActive } from "./roster";

// Release 3 replaces this stub with real challenge rolling.
export type ChallengePhase = (state: GameState, rng: Rng, content: GameContent) => void;

export function log(state: GameState, message: string): void {
  state.log.push({ day: state.day, message });
  if (state.log.length > 200) state.log.shift();
}

/** Sparkline length for the Income and Expenses panels. Quiet days stay in the buffer. */
export const INCOME_HISTORY_DAYS = 14;

// 1-decimal UI (`fmt` maximumFractionDigits: 1) paints remaining in [0, 0.05)
// as "0". Completing at float ~0 left a sub-grain tail walking finish →
// review → deploy for extra days while Size / Backlog / stages all read 0.
export const PROJECT_DISPLAY_GRAIN = 0.05;

function recordDailyIncome(state: GameState, recurring: number, burst: number): void {
  if (!state.incomeByDay) state.incomeByDay = [];
  state.incomeByDay.push({ day: state.day, recurring, burst });
  while (state.incomeByDay.length > INCOME_HISTORY_DAYS) state.incomeByDay.shift();
}

function recordDailyExpenses(state: GameState, split: Omit<DailyExpenses, "day">): void {
  if (!state.expensesByDay) state.expensesByDay = [];
  state.expensesByDay.push({ day: state.day, ...split });
  while (state.expensesByDay.length > INCOME_HISTORY_DAYS) state.expensesByDay.shift();
}

/** Agent copies plus the rest of the agent ladder (harness, orchestration, CI review). */
function isAgentExpenseId(defId: string): boolean {
  return defId === "agent" || defId.startsWith("agent-");
}

/** Owned per-day drain plus KTLO cash, bucketed for the Expenses chart. */
export function dailyExpenseSplit(
  state: Pick<GameState, "decisions" | "day">,
  content: GameContent,
): Omit<DailyExpenses, "day"> {
  let human = 0;
  let agents = 0;
  let ktlo = ktloBurnPerDay(content);
  for (const inst of state.decisions) {
    if (!instanceIsActive(inst, state.day)) continue;
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    const perDay = scaledDecisionCost(def, agentSeatCount(state), "perDay");
    if (perDay <= 0) continue;
    if (def.human) human += perDay;
    else if (isAgentExpenseId(def.id)) agents += perDay;
    else ktlo += perDay;
  }
  return { human, agents, ktlo };
}

// Attribute shipped points equally across in-flight remainings, pay revenue
// and bonuses. Factory throughput is conserved; each live contract gets
// credit / n. Completing a remaining in this tick snaps its unused share onto
// whoever is still live (same-tick leftover redistribution).
//
// Shipped points with no project in flight intentionally earn nothing (no
// contract, no pay).
//
// Surplus (pipeline work not committed to any in-flight remaining) ships
// first and is not credited. That leftover is rework injected while no
// contract was running; crediting it would complete the next project early
// (ADR 0009). Extra work injected *during* a contract is attached onto
// remaining, so it delays that contract instead of becoming surplus.
function completeProject(state: GameState, p: ActiveProject): void {
  state.stocks.budget += p.completionBonus;
  state.stocks.reputation += p.reputationReward;
  // Pay any stock grants recorded on this project (the Launch beta grants
  // +30 users, which is what flips the users economy on). Clamp at 0 like
  // every other stock write. Log a users grant when non-zero so the beta
  // launch reads clearly.
  for (const grant of p.completionStockGrants ?? []) {
    state.stocks[grant.stock] = clampStock(state, grant.stock, state.stocks[grant.stock] + grant.amount);
    if ((grant.stock === "users" || grant.stock === "morale") && grant.amount !== 0) {
      log(state, `${p.name}: +${grant.amount} ${grant.stock}`);
    }
  }
  state.completedProjects += 1;
  if (!state.completedProjectIds) state.completedProjectIds = [];
  // Every completion is recorded. Unique offers finish once, so their id
  // appears once. A repeatable offer (Ship next feature) appears once
  // per completion, and stockFlowMods stack once per entry.
  state.completedProjectIds.push(p.defId);
  log(state, `Project complete: ${p.name} (+$${p.completionBonus} bonus, +${p.reputationReward} reputation)`);
}

function attributeShipped(state: GameState, shippedFlow: number): void {
  const pipelineBefore = unshippedWork(state) + shippedFlow;
  const surplus = Math.max(0, pipelineBefore - committedWork(state));
  let credit = Math.max(0, shippedFlow - Math.min(shippedFlow, surplus));
  while (credit > 1e-12 && state.projects.length > 0) {
    const n = state.projects.length;
    const share = credit / n;
    const stillLive: ActiveProject[] = [];
    let leftover = 0;
    for (const p of state.projects) {
      const applied = Math.min(share, p.remaining);
      p.remaining -= applied;
      state.stocks.budget += applied * p.payoutPerPoint;
      leftover += share - applied;
      // Epsilon tolerance: float drift from fractional flows could otherwise
      // strand a project at a tiny positive remainder forever.
      if (p.remaining > 1e-9) {
        stillLive.push(p);
      } else {
        p.remaining = 0;
        completeProject(state, p);
      }
    }
    state.projects = stillLive;
    credit = leftover;
  }
}

// After ship-credit and debt attach: remaining below the 1-decimal display
// grain is already "0 left" on the board. Snap-complete so grants (tech-debt
// paydown, user lumps) fire that tick. Unpaid crumbs stay in the pipeline as
// surplus (ADR 0009: leftover ships without credit). Visible remainings
// (>= grain, which paints as 0.1+) still wait for ship.
function snapCompleteBelowDisplayGrain(state: GameState): void {
  if (state.projects.length === 0) return;
  const stillLive: ActiveProject[] = [];
  for (const p of state.projects) {
    if (p.remaining < PROJECT_DISPLAY_GRAIN) {
      p.remaining = 0;
      completeProject(state, p);
    } else {
      stillLive.push(p);
    }
  }
  state.projects = stillLive;
}

// Always-on stock flows (Studio organic acquisition). Runs after
// shipping, once per configured flow whose condition holds. Deterministic (no
// rng): grossGain (flat acquirePerDay plus acquirePerStock.perUnit per point
// of another stock, e.g. reputation) minus churn (stocks[stock] *
// churnRatePerDay), clamped at 0. stockFlowMods from owned decisions and
// from completed projects (one application per completedProjectIds entry)
// add to the flow's acquirePerDay / churnRatePerDay. Studio decisions ship
// none; Ship v1 and each Ship next feature raise user acquire. Base
// churn only.
function applyStockFlowMods(
  mods: readonly StockFlowMod[] | undefined,
  flowStock: string,
  acquirePerDay: number,
  churnRate: number,
): { acquirePerDay: number; churnRate: number } {
  for (const mod of mods ?? []) {
    if (mod.stock !== flowStock) continue;
    acquirePerDay += mod.acquirePerDayDelta ?? 0;
    churnRate += mod.churnRateDelta ?? 0;
  }
  return { acquirePerDay, churnRate };
}

function runStockFlows(state: GameState, content: GameContent): void {
  state.userAcquireFlow = 0;
  state.userChurnFlow = 0;
  state.moraleRecoverFlow = 0;
  state.moralePrideFlow = 0;
  for (const flow of content.start.stockFlows ?? []) {
    if (flow.condition?.minCompletedProjects !== undefined && state.completedProjects < flow.condition.minCompletedProjects) {
      continue;
    }
    let acquirePerDay = flow.acquirePerDay ?? 0;
    let churnRate = flow.churnRatePerDay ?? 0;
    for (const inst of state.decisions) {
      const def = content.decisions.find((d) => d.id === inst.defId);
      ({ acquirePerDay, churnRate } = applyStockFlowMods(def?.stockFlowMods, flow.stock, acquirePerDay, churnRate));
    }
    for (const id of state.completedProjectIds ?? []) {
      const def = content.projects.find((p) => p.id === id);
      const mods = def && isContractProject(def) ? def.stockFlowMods : undefined;
      ({ acquirePerDay, churnRate } = applyStockFlowMods(mods, flow.stock, acquirePerDay, churnRate));
    }
    const fromStock = flow.acquirePerStock ? state.stocks[flow.acquirePerStock.stock] * flow.acquirePerStock.perUnit : 0;
    const grossGain = acquirePerDay + fromStock;
    const churnAmount = state.stocks[flow.stock] * churnRate;
    if (flow.stock === "users") {
      state.userAcquireFlow += grossGain;
      state.userChurnFlow += churnAmount;
    }
    if (flow.stock === "morale") {
      state.moraleRecoverFlow += acquirePerDay;
      state.moralePrideFlow += fromStock;
    }
    state.stocks[flow.stock] = clampStock(state, flow.stock, state.stocks[flow.stock] + grossGain - churnAmount);
  }
}

function chargeUpkeep(state: GameState, content: GameContent, rng: Rng): void {
  const snapshot = [...state.decisions];
  // Net total incomePerDay against KTLO cash in the same step, before
  // the zero-floor clamp below. Crediting income after an already-clamped
  // burn would throw the burn deficit away entirely once budget had been
  // driven to 0, turning any owned income decision into a permanent,
  // risk-free income stream instead of being consumed by ongoing burn
  // This still credits ALL income (from the same snapshot the payroll loop below uses) before charging ANY payroll, so income from a
  // later-purchased decision can still rescue an earlier decision's payroll;
  // otherwise outcomes would depend arbitrarily on purchase order.
  let totalIncome = 0;
  let recurringIncome = 0;
  let burstIncome = 0;
  state.userIncomeFlow = 0;
  for (const inst of snapshot) {
    if (!instanceIsActive(inst, state.day)) continue;
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    if (def.incomePerDay) {
      totalIncome += def.incomePerDay;
      recurringIncome += def.incomePerDay;
    }
    // Studio monetization: income scaled by a stock's level,
    // stacked on top of any flat incomePerDay. The subscription card reads
    // users; useless at 0 users (contributes exactly 0).
    if (def.incomeFromStock) {
      const fromStock = state.stocks[def.incomeFromStock.stock] * def.incomeFromStock.perUnit;
      totalIncome += fromStock;
      recurringIncome += fromStock;
      if (def.incomeFromStock.stock === "users") state.userIncomeFlow += fromStock;
    }
    // Per-unit sales (one-time-product card). Each point of stock rolls
    // probabilityPerDay independently; each hit credits perUnit. Expected
    // $/day is still stock * p * perUnit, but a small stock means fewer
    // sales rather than the same rare all-or-nothing company roll. Skip
    // when the stock is 0: hits would credit $0, and drawing here would
    // burn the purchase RNG stream through the isolated pre-launch
    // burndown (users stay 0 until the first project completes).
    // Receipts go on incomeByDay, not the Events log.
    if (def.burstFromStock) {
      const stock = state.stocks[def.burstFromStock.stock];
      if (stock > 0) {
        const sales = sampleIndependentHits(rng, stock, def.burstFromStock.probabilityPerDay);
        const burst = sales * def.burstFromStock.perUnit;
        if (burst > 0) {
          totalIncome += burst;
          burstIncome += burst;
          if (def.burstFromStock.stock === "users") state.userIncomeFlow += burst;
        }
      }
    }
  }
  recordDailyIncome(state, recurringIncome, burstIncome);
  const seats = agentSeatCount({ decisions: snapshot, day: state.day });
  recordDailyExpenses(state, dailyExpenseSplit({ decisions: snapshot, day: state.day }, content));
  // Clamp at 0 deliberately per the design spec: budget never goes negative.
  // Insolvency also freezes delivery (isDeliveryFrozen) and removes unpaid
  // payroll; it is not a negative balance.
  state.stocks.budget = Math.max(0, state.stocks.budget - ktloBurnPerDay(content) + totalIncome);
  for (const inst of snapshot) {
    if (!instanceIsActive(inst, state.day)) continue;
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    const perDay = scaledDecisionCost(def, seats, "perDay");
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

/** True when a tick starts already at $0: pull/finish/review/deploy realize 0 flow. */
export function isDeliveryFrozen(state: Pick<GameState, "stocks">): boolean {
  return state.stocks.budget <= 0;
}

function flaggedActiveCount(state: GameState, content: GameContent, flag: HeadcountFlag): number {
  return state.decisions.filter((inst) => {
    if (!instanceIsActive(inst, state.day)) return false;
    const def = content.decisions.find((d) => d.id === inst.defId);
    return def?.[flag] === true;
  }).length;
}

export function activateDueInstances(state: GameState, content: GameContent): void {
  let activated = false;
  for (const inst of state.decisions) {
    if (inst.pendingEffects === undefined) continue;
    if (!instanceIsActive(inst, state.day)) continue;
    recordGrantScales(inst, inst.pendingEffects);
    applyEffects(state, inst.pendingEffects, inst.instanceId, { instanceId: inst.instanceId, content });
    delete inst.pendingEffects;
    activated = true;
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (def) log(state, `${def.name} started`);
  }
  if (activated && !isDeliveryFrozen(state)) {
    applySeatCapacity(state, effectiveCapacity(state, content), 0);
  }
}

function oversightWeights(state: GameState, content: GameContent): { watch: number; leak: number; humans: number; agents: number } {
  const cfg = content.start.oversight;
  if (!cfg) return { watch: 0, leak: 0, humans: 0, agents: 0 };
  let watchMul = 1;
  let leakMul = 1;
  for (const inst of state.decisions) {
    if (!instanceIsActive(inst, state.day)) continue;
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def?.oversightMods) continue;
    watchMul *= def.oversightMods.watchMul ?? 1;
    leakMul *= def.oversightMods.leakMul ?? 1;
  }
  const humans = flaggedActiveCount(state, content, "human") + 1;
  const agents = flaggedActiveCount(state, content, "agent");
  return {
    watch: humans * cfg.perHuman * watchMul,
    leak: agents * cfg.perAgent * leakMul,
    humans,
    agents,
  };
}

function agentFinishContribution(state: GameState): number {
  let add = 0;
  for (const m of state.modifiers) {
    if (m.op !== "add" || (m.target !== "finish" && m.target !== "allRates")) continue;
    const inst = state.decisions.find((d) => d.instanceId === m.source);
    if (!inst?.agent || !instanceIsActive(inst, state.day)) continue;
    add += scaledModifierValue(state, m);
  }
  let mul = 1;
  for (const m of state.modifiers) {
    if (m.op !== "mul" || (m.target !== "finish" && m.target !== "allRates")) continue;
    mul *= m.value;
  }
  return add * mul;
}

function applyOversight(state: GameState, content: GameContent, frozen: boolean): number {
  state.oversightWatch = 0;
  state.oversightLeak = 0;
  state.oversightOffPolicy = 0;
  state.moraleOverloadFlow = 0;
  const cfg = content.start.oversight;
  if (!cfg) return 0;
  const { watch, leak, agents } = oversightWeights(state, content);
  state.oversightWatch = watch;
  state.oversightLeak = leak;
  const cap = state.stockMax.oversight ?? 100;
  const target = agents === 0 || watch + leak <= 0 ? cap : Math.min(cap, (cap * watch) / (watch + leak));
  const current = state.stocks.oversight;
  const next = clampStock(state, "oversight", current + cfg.approachPerDay * (target - current));
  state.stocks.oversight = next;
  const offPolicy = agents === 0 ? 0 : Math.max(0, (cfg.offPolicyBelow - next) / cfg.offPolicyBelow);
  state.oversightOffPolicy = offPolicy;
  const moraleLeak = Math.max(0, (cfg.moraleLeakBelow - next) / cfg.moraleLeakScale);
  state.moraleOverloadFlow = moraleLeak;
  if (moraleLeak > 0) {
    state.stocks.morale = clampStock(state, "morale", state.stocks.morale - moraleLeak);
  }
  if (frozen || offPolicy <= 0) return 0;
  return offPolicy * agentFinishContribution(state);
}

function applyHeadcountRatioDrags(state: GameState, content: GameContent): void {
  for (const drag of content.start.headcountRatioDrags ?? []) {
    const numerator = flaggedActiveCount(state, content, drag.numerator);
    let denominator = flaggedActiveCount(state, content, drag.denominator);
    if (drag.founderCounts && drag.denominator === "human") denominator += 1;
    const ratio = numerator / Math.max(1, denominator);
    const excess = Math.max(0, ratio - drag.freeBand);
    const drain = excess * drag.drainPerExcess;
    if (drain <= 0) continue;
    if (drag.stock === "morale") state.moraleOverloadFlow += drain;
    state.stocks[drag.stock] = clampStock(state, drag.stock, state.stocks[drag.stock] - drain);
  }
}

function applyInstanceChurn(state: GameState, content: GameContent, rng: Rng): void {
  state.employeeQuitRate = 0;
  let quit = false;
  for (const rule of content.start.instanceChurn ?? []) {
    const level = state.stocks[rule.stock];
    const p = level >= rule.safeBand ? 0 : ((rule.safeBand - level) / rule.safeBand) * rule.maxRatePerDay;
    if (rule.flag === "human") state.employeeQuitRate = Math.max(state.employeeQuitRate, p);
    if (p <= 0) continue;
    const targets = state.decisions.filter((inst) => {
      if (!instanceIsActive(inst, state.day)) return false;
      const def = content.decisions.find((d) => d.id === inst.defId);
      return def?.[rule.flag] === true;
    });
    for (const inst of targets) {
      if (rng.next() >= p) continue;
      const def = content.decisions.find((d) => d.id === inst.defId);
      state.decisions = state.decisions.filter((d) => d.instanceId !== inst.instanceId);
      state.modifiers = state.modifiers.filter((m) => m.source !== inst.instanceId);
      if (def) log(state, `Quit: ${def.name}`);
      quit = true;
    }
  }
  if (quit && !isDeliveryFrozen(state)) {
    applySeatCapacity(state, effectiveCapacity(state, content), 0);
  }
}

export function tick(state: GameState, rng: Rng, content: GameContent, challengePhase: ChallengePhase): void {
  if (state.paused) return;
  state.day += 1;
  pruneExpired(state);
  activateDueInstances(state, content);

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

  syncKtloBase(state, content);
  const frozen = isDeliveryFrozen(state);
  const deployRate = frozen ? 0 : effectiveRate(state, "deploy");
  const reviewRate = frozen ? 0 : effectiveRate(state, "review");
  const finishRate = frozen ? 0 : productFinishRate(state, content);
  const capacity = effectiveCapacity(state, content);
  // Ideas faucet: always-on from day 0, not a pipeline stage, not frozen
  // with delivery. Shop cards raise it via modifyRate add on discover.
  state.stocks.ideas = Math.max(0, state.stocks.ideas + effectiveRate(state, "discover"));

  // Downstream first: ship Done, then review into Done, then finish into
  // In Review. Speed (finishRate) is how much leaves the Ready+In Progress
  // pool into In Review; a point is in one stage at a time. In Progress is
  // capacity, filled from Ready. Continuous deploy still dumps Done before
  // this tick's review lands, so a point that is reviewed today ships next
  // tick — the same lag finish used to have vs Done.
  const shippedFlow = frozen
    ? 0
    : continuousDeployActive(state, content)
      ? state.stocks.done
      : Math.min(state.stocks.done, deployRate);
  state.stocks.done -= shippedFlow;
  state.stocks.shipped += shippedFlow;

  const reviewFlow = frozen ? 0 : Math.min(state.stocks.inReview, reviewRate);
  state.stocks.inReview -= reviewFlow;
  state.stocks.done += reviewFlow;

  let finishFlow = 0;
  let pullFlow = 0;
  if (!frozen) {
    ({ finishFlow, pullFlow } = applySeatCapacity(state, capacity, finishRate));
  }

  attributeShipped(state, shippedFlow);

  const debtGain = shippedFlow * effectiveDebtMultiplier(state) + applyOversight(state, content, frozen);
  state.stocks.techDebt += debtGain;
  // Studio spine: tech debt always accrues, but it only refills
  // the backlog once the first project (the Launch beta) has completed. This
  // gives the beta a clean 300-point burndown -- no debt-driven backlog growth
  // fighting the very first delivery -- while preserving the reinforcing
  // debt->rework loop for every project after it.
  //
  // ADR 0009: refill is injected work. Attach it onto one in-flight remaining
  // (engine-picked when several are live) so rework delays delivery instead of
  // FIFO-counting as progress. With no project in flight it stays unattributed
  // surplus.
  if (state.completedProjects >= 1) {
    state.stocks.backlog += debtGain;
    attachInjectedWork(state, debtGain);
  }

  snapCompleteBelowDisplayGrain(state);

  // Plan fill + auto-Ready run after ship-credit so a newly readied
  // contract cannot collect today's shipped points, and after seats so
  // new Ready work waits until the next tick to take an In Progress seat.
  advancePlan(state, content);

  // Organic stock flows (users acquisition) run after shipping/debt and read
  // this tick's completedProjects, so they turn on the same tick the beta
  // completes. Deterministic; see runStockFlows.
  runStockFlows(state, content);
  applyHeadcountRatioDrags(state, content);

  // Archetype narration reads this tick's settled techDebt (drag) and the
  // owned decision set; each fires at most once per game. Runs before
  // chargeUpkeep so a payroll-failure removal later this tick does not race
  // the ownership counts, matching the pre-flow reads elsewhere.
  detectArchetypes(state, content, log);
  detectMilestones(state, content, log);

  applyInstanceChurn(state, content, rng);
  chargeUpkeep(state, content, rng);

  state.pointsPerDay = shippedFlow;
  state.pullFlow = pullFlow;
  state.finishFlow = finishFlow;
  state.reviewFlow = reviewFlow;
  state.rngState = rng.getState();
}
