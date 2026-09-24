import type { ContractProjectDef, GameContent, GameState, PlanItem, ProjectDef } from "./types";
import { isContractProject, isPermanentProject } from "./types";
import { isRetiredProject } from "./ktlo";
import { availability } from "./decisions";
import { log } from "./tick";
import { drainUnshippedWork, unshippedWork } from "./work";
import { effectiveRate } from "./modifiers";

export interface ProjectAvailability {
  def: ContractProjectDef;
  startable: boolean;
  reason?: string;
}

function completedIds(state: GameState): string[] {
  return state.completedProjectIds ?? [];
}

function planItems(state: GameState): PlanItem[] {
  if (!state.plan) state.plan = [];
  return state.plan;
}

export function planStock(state: Pick<GameState, "plan">): number {
  return (state.plan ?? []).reduce((sum, p) => sum + p.progress, 0);
}

function syncPlanStock(state: GameState): void {
  state.stocks.plan = planStock(state);
}

function projectName(content: GameContent, id: string): string {
  if (content.start.initialProject.id === id) return content.start.initialProject.name;
  return content.projects.find((p) => p.id === id)?.name ?? id;
}

function copyCount(state: GameState, defId: string): number {
  const inFlight = state.projects.filter((p) => p.defId === defId).length;
  const inPlan = planItems(state).filter((p) => p.defId === defId).length;
  return inFlight + inPlan;
}

// Parallel offers share one row. The cap is the active era's parallelCopies,
// defaulting to 1 when the era omits it or the fixture has no era catalog.
export function parallelCap(state: GameState, content: GameContent, def: ContractProjectDef): number {
  if (def.parallel !== true) return 1;
  return content.eras?.eras.find((era) => era.id === state.eraId)?.parallelCopies ?? 1;
}

function blockReason(state: GameState, content: GameContent, def: ContractProjectDef): string | undefined {
  if (copyCount(state, def.id) >= parallelCap(state, content, def)) {
    if (state.projects.some((p) => p.defId === def.id)) return "already in flight";
    return "already in plan";
  }
  if (def.unique && completedIds(state).includes(def.id)) return "already completed";
  const needed = def.requiresCompleted ?? 0;
  if (state.completedProjects < needed) return `requires ${needed} completed project(s)`;
  if (def.requiresCompletedId !== undefined && !completedIds(state).includes(def.requiresCompletedId)) {
    return `requires completed ${projectName(content, def.requiresCompletedId)}`;
  }
  if (def.requiresReputation !== undefined && state.stocks.reputation < def.requiresReputation) {
    return `requires ${def.requiresReputation} reputation`;
  }
  return undefined;
}

function isPursue(def: ProjectDef): boolean {
  return isContractProject(def) && def.pursue === true;
}

export function pursueIdeaCost(def: ContractProjectDef): number {
  if (!isPursue(def)) return 0;
  return def.ideaCost ?? def.sizePoints;
}

function cannotAfford(state: GameState, def: ContractProjectDef): boolean {
  if (state.stocks.budget < def.upfrontCost) return true;
  return isPursue(def) && state.stocks.ideas < pursueIdeaCost(def);
}

function offeredContracts(content: GameContent): ContractProjectDef[] {
  return content.projects.filter(
    (def): def is ContractProjectDef => isContractProject(def) && !isRetiredProject(content, def.id),
  );
}

export function projectAvailability(state: GameState, content: GameContent): ProjectAvailability[] {
  return offeredContracts(content).map((def) => {
    const blocked = blockReason(state, content, def);
    if (blocked) return { def, startable: false, reason: blocked };
    if (cannotAfford(state, def)) return { def, startable: false, reason: "cannot afford" };
    return { def, startable: true };
  });
}

function ensureProjectInstanceCounter(state: GameState): void {
  if (state.nextProjectInstanceId === undefined) state.nextProjectInstanceId = 1;
}

export function assignMissingProjectInstances(state: GameState): void {
  ensureProjectInstanceCounter(state);
  for (const project of state.projects) {
    if (!project.instanceId) project.instanceId = allocProjectInstance(state);
  }
  for (const item of state.plan ?? []) {
    if (!item.instanceId) item.instanceId = allocProjectInstance(state);
  }
}

function allocProjectInstance(state: GameState): string {
  ensureProjectInstanceCounter(state);
  const id = `proj-${state.nextProjectInstanceId}`;
  state.nextProjectInstanceId += 1;
  return id;
}

function enterReady(state: GameState, def: ContractProjectDef, instanceId = allocProjectInstance(state)): void {
  state.stocks.backlog += def.sizePoints;
  state.projects.push({
    defId: def.id,
    instanceId,
    name: def.name,
    remaining: def.sizePoints,
    payoutPerPoint: def.payoutPerPoint,
    completionBonus: def.completionBonus,
    reputationReward: def.reputationReward,
    // Studio spine: carry the def's stock grants onto the live
    // project so completion pays them from the values recorded at start.
    ...(def.completionStockGrants ? { completionStockGrants: def.completionStockGrants.map((g) => ({ ...g })) } : {}),
  });
}

function rejectUnstartable(content: GameContent, defId: string): void {
  const def = content.projects.find((p) => p.id === defId);
  if (!def) return;
  if (isPermanentProject(def)) throw new Error(`${def.name} is always on`);
  if (isRetiredProject(content, def.id)) throw new Error(`${def.name} is no longer offered`);
}

export function startProject(state: GameState, content: GameContent, defId: string): void {
  rejectUnstartable(content, defId);
  const entry = projectAvailability(state, content).find((p) => p.def.id === defId);
  if (!entry) throw new Error(`Unknown project: ${defId}`);
  if (!entry.startable) {
    throw new Error(entry.reason === "cannot afford" ? `Cannot afford ${entry.def.name}` : `${entry.def.name}: ${entry.reason}`);
  }
  const def = entry.def;
  if (isPursue(def)) throw new Error(`${def.name} is pursued, not started`);
  state.stocks.budget -= def.upfrontCost;
  enterReady(state, def);
  log(state, `Started project: ${def.name} (+${def.sizePoints} points, -$${def.upfrontCost})`);
}

export function pursueProject(state: GameState, content: GameContent, defId: string): void {
  rejectUnstartable(content, defId);
  const def = content.projects.find((p) => p.id === defId);
  if (!def) throw new Error(`Unknown project: ${defId}`);
  if (!isContractProject(def) || !isPursue(def)) throw new Error(`${def.name} starts, it is not pursued`);
  const blocked = blockReason(state, content, def);
  if (blocked) throw new Error(`${def.name}: ${blocked}`);
  const ideas = pursueIdeaCost(def);
  if (state.stocks.ideas < ideas) {
    throw new Error(`Cannot pursue ${def.name}: not enough ideas`);
  }
  if (state.stocks.budget < def.upfrontCost) {
    throw new Error(`Cannot afford ${def.name}`);
  }
  state.stocks.ideas -= ideas;
  state.stocks.budget -= def.upfrontCost;
  planItems(state).push({
    defId: def.id,
    instanceId: allocProjectInstance(state),
    name: def.name,
    progress: 0,
    size: def.sizePoints,
  });
  syncPlanStock(state);
  log(state, `Pursuing: ${def.name} (−${ideas} ideas, −$${def.upfrontCost})`);
}

export function takeProject(state: GameState, content: GameContent, defId: string): void {
  const def = content.projects.find((p) => p.id === defId);
  if (!def) throw new Error(`Unknown project: ${defId}`);
  if (isPursue(def)) pursueProject(state, content, defId);
  else startProject(state, content, defId);
}

function planIndex(state: GameState, key: string): number {
  const items = planItems(state);
  const byInstance = items.findIndex((p) => p.instanceId === key);
  if (byInstance >= 0) return byInstance;
  return items.findIndex((p) => p.defId === key);
}

export function cancelPlan(state: GameState, key: string): void {
  const items = planItems(state);
  const idx = planIndex(state, key);
  if (idx < 0) throw new Error(`${key} is not in plan`);
  const item = items[idx]!;
  items.splice(idx, 1);
  syncPlanStock(state);
  log(state, `Cancelled plan: ${item.name} (${item.progress} progress discarded)`);
}

function enterReadyFromPlan(state: GameState, content: GameContent, item: PlanItem): void {
  const def = content.projects.find((p) => p.id === item.defId);
  const instanceId = item.instanceId || allocProjectInstance(state);
  if (def && isContractProject(def)) {
    enterReady(state, def, instanceId);
  } else {
    state.stocks.backlog += item.size;
    state.projects.push({
      defId: item.defId,
      instanceId,
      name: item.name,
      remaining: item.size,
      payoutPerPoint: 0,
      completionBonus: 0,
      reputationReward: 0,
    });
  }
  log(state, `Ready: ${item.name} (+${item.size} points)`);
}

// Fill Plan at the plan rate, split evenly across named items. Unused
// capacity (empty Plan, or leftover after an item hits size with no peers)
// is dropped. Hitting size auto-enters Ready: same ledger write as Start
// (Ready stock + remaining = size), no second Start click, no extra Ideas
// or money spend.
export function advancePlan(state: GameState, content: GameContent): void {
  const items = planItems(state);
  if (items.length === 0) {
    syncPlanStock(state);
    return;
  }
  let credit = effectiveRate(state, "plan");
  while (credit > 1e-12 && planItems(state).length > 0) {
    const live = state.plan.length;
    const share = credit / live;
    const stillPlanning: PlanItem[] = [];
    const completed: PlanItem[] = [];
    let leftover = 0;
    for (const item of state.plan) {
      const room = Math.max(0, item.size - item.progress);
      const applied = Math.min(share, room);
      item.progress += applied;
      leftover += share - applied;
      if (item.progress + 1e-9 >= item.size) {
        item.progress = item.size;
        completed.push(item);
      } else {
        stillPlanning.push(item);
      }
    }
    state.plan = stillPlanning;
    for (const item of completed) {
      enterReadyFromPlan(state, content, item);
    }
    credit = leftover;
  }
  syncPlanStock(state);
}

function projectIndex(state: GameState, key: string): number {
  const byInstance = state.projects.findIndex((p) => p.instanceId === key);
  if (byInstance >= 0) return byInstance;
  return state.projects.findIndex((p) => p.defId === key);
}

export function abandonProject(state: GameState, key: string): void {
  const idx = projectIndex(state, key);
  if (idx < 0) throw new Error(`${key} is not in flight`);
  const p = state.projects[idx];
  drainUnshippedWork(state, p.remaining);
  state.projects.splice(idx, 1);
  log(state, `Abandoned project: ${p.name} (${p.remaining} points discarded)`);
}

export function isStalled(state: GameState, content: GameContent): boolean {
  const pipelineEmpty = unshippedWork(state) <= 0;
  if (!pipelineEmpty) return false;
  const anyProject = projectAvailability(state, content).some((p) => p.startable);
  const anyDecision = availability(state, content).some((a) => a.purchasable);
  return !anyProject && !anyDecision;
}
