import type { GameContent, GameState, PlanItem, ProjectDef } from "./types";
import { availability } from "./decisions";
import { log } from "./tick";
import { drainUnshippedWork, unshippedWork } from "./work";
import { effectiveRate } from "./modifiers";

export interface ProjectAvailability {
  def: ProjectDef;
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

function blockReason(state: GameState, content: GameContent, def: ProjectDef): string | undefined {
  if (state.projects.some((p) => p.defId === def.id)) return "already in flight";
  if (planItems(state).some((p) => p.defId === def.id)) return "already in plan";
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
  return def.pursue === true;
}

function cannotAfford(state: GameState, def: ProjectDef): boolean {
  if (state.stocks.budget < def.upfrontCost) return true;
  return isPursue(def) && state.stocks.ideas < def.sizePoints;
}

export function projectAvailability(state: GameState, content: GameContent): ProjectAvailability[] {
  return content.projects.map((def) => {
    const blocked = blockReason(state, content, def);
    if (blocked) return { def, startable: false, reason: blocked };
    if (cannotAfford(state, def)) return { def, startable: false, reason: "cannot afford" };
    return { def, startable: true };
  });
}

function enterReady(state: GameState, def: ProjectDef): void {
  state.stocks.backlog += def.sizePoints;
  state.projects.push({
    defId: def.id,
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

export function startProject(state: GameState, content: GameContent, defId: string): void {
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
  const def = content.projects.find((p) => p.id === defId);
  if (!def) throw new Error(`Unknown project: ${defId}`);
  if (!isPursue(def)) throw new Error(`${def.name} starts, it is not pursued`);
  const blocked = blockReason(state, content, def);
  if (blocked) throw new Error(`${def.name}: ${blocked}`);
  if (state.stocks.ideas < def.sizePoints) {
    throw new Error(`Cannot pursue ${def.name}: not enough ideas`);
  }
  if (state.stocks.budget < def.upfrontCost) {
    throw new Error(`Cannot afford ${def.name}`);
  }
  state.stocks.ideas -= def.sizePoints;
  state.stocks.budget -= def.upfrontCost;
  planItems(state).push({
    defId: def.id,
    name: def.name,
    progress: 0,
    size: def.sizePoints,
  });
  syncPlanStock(state);
  log(state, `Pursuing: ${def.name} (−${def.sizePoints} ideas, −$${def.upfrontCost})`);
}

export function takeProject(state: GameState, content: GameContent, defId: string): void {
  const def = content.projects.find((p) => p.id === defId);
  if (!def) throw new Error(`Unknown project: ${defId}`);
  if (isPursue(def)) pursueProject(state, content, defId);
  else startProject(state, content, defId);
}

export function cancelPlan(state: GameState, defId: string): void {
  const items = planItems(state);
  const idx = items.findIndex((p) => p.defId === defId);
  if (idx < 0) throw new Error(`${defId} is not in plan`);
  const item = items[idx]!;
  items.splice(idx, 1);
  syncPlanStock(state);
  log(state, `Cancelled plan: ${item.name} (${item.progress} progress discarded)`);
}

function enterReadyFromPlan(state: GameState, content: GameContent, item: PlanItem): void {
  const def = content.projects.find((p) => p.id === item.defId);
  if (def) {
    enterReady(state, def);
  } else {
    state.stocks.backlog += item.size;
    state.projects.push({
      defId: item.defId,
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

export function abandonProject(state: GameState, defId: string): void {
  const idx = state.projects.findIndex((p) => p.defId === defId);
  if (idx < 0) throw new Error(`${defId} is not in flight`);
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
