import type { GameContent, GameState, ProjectDef } from "./types";
import { availability } from "./decisions";
import { log } from "./tick";
import { drainUnshippedWork, unshippedWork } from "./work";

export interface ProjectAvailability {
  def: ProjectDef;
  startable: boolean;
  reason?: string;
}

function completedIds(state: GameState): string[] {
  return state.completedProjectIds ?? [];
}

function projectName(content: GameContent, id: string): string {
  if (content.start.initialProject.id === id) return content.start.initialProject.name;
  return content.projects.find((p) => p.id === id)?.name ?? id;
}

export function projectAvailability(state: GameState, content: GameContent): ProjectAvailability[] {
  return content.projects.map((def) => {
    if (state.projects.some((p) => p.defId === def.id)) return { def, startable: false, reason: "already in flight" };
    if (def.unique && completedIds(state).includes(def.id)) {
      return { def, startable: false, reason: "already completed" };
    }
    const needed = def.requiresCompleted ?? 0;
    if (state.completedProjects < needed) return { def, startable: false, reason: `requires ${needed} completed project(s)` };
    if (def.requiresCompletedId !== undefined && !completedIds(state).includes(def.requiresCompletedId)) {
      return { def, startable: false, reason: `requires completed ${projectName(content, def.requiresCompletedId)}` };
    }
    if (def.requiresReputation !== undefined && state.stocks.reputation < def.requiresReputation) {
      return { def, startable: false, reason: `requires ${def.requiresReputation} reputation` };
    }
    if (state.stocks.budget < def.upfrontCost) return { def, startable: false, reason: "cannot afford" };
    return { def, startable: true };
  });
}

export function startProject(state: GameState, content: GameContent, defId: string): void {
  const entry = projectAvailability(state, content).find((p) => p.def.id === defId);
  if (!entry) throw new Error(`Unknown project: ${defId}`);
  if (!entry.startable) {
    throw new Error(entry.reason === "cannot afford" ? `Cannot afford ${entry.def.name}` : `${entry.def.name}: ${entry.reason}`);
  }
  const def = entry.def;
  state.stocks.budget -= def.upfrontCost;
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
  log(state, `Started project: ${def.name} (+${def.sizePoints} points, -$${def.upfrontCost})`);
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
