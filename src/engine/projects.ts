import type { GameContent, GameState, ProjectDef } from "./types";
import { availability } from "./decisions";
import { log } from "./tick";

export interface ProjectAvailability {
  def: ProjectDef;
  startable: boolean;
  reason?: string;
}

export function projectAvailability(state: GameState, content: GameContent): ProjectAvailability[] {
  return content.projects.map((def) => {
    if (state.projects.some((p) => p.defId === def.id)) return { def, startable: false, reason: "already in flight" };
    const needed = def.requiresCompleted ?? 0;
    if (state.completedProjects < needed) return { def, startable: false, reason: `requires ${needed} completed project(s)` };
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
  });
  log(state, `Started project: ${def.name} (+${def.sizePoints} points, -$${def.upfrontCost})`);
}

export function isStalled(state: GameState, content: GameContent): boolean {
  const pipelineEmpty = state.stocks.backlog + state.stocks.inProgress + state.stocks.done <= 0;
  if (!pipelineEmpty) return false;
  const anyProject = projectAvailability(state, content).some((p) => p.startable);
  const anyDecision = availability(state, content).some((a) => a.purchasable);
  return !anyProject && !anyDecision;
}
