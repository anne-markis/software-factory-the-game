import type { GameContent, GameState, PermanentProjectDef } from "./types";
import { isPermanentProject } from "./types";
import { effectiveRate } from "./modifiers";

export function permanentProjects(content: GameContent): PermanentProjectDef[] {
  return content.projects.filter(isPermanentProject);
}

/** Copy catalog basePerDay onto the ktlo rate. Cards then add and multiply. */
export function syncKtloBase(state: GameState, content: GameContent): void {
  let base = 0;
  for (const def of permanentProjects(content)) base += def.basePerDay;
  state.baseRates.ktlo = base;
}

/** Finish left for contracts after KTLO reserves its rate. */
export function productFinishRate(state: GameState, content: GameContent): number {
  const finish = effectiveRate(state, "finish");
  if (permanentProjects(content).length === 0) return finish;
  return Math.max(0, finish - effectiveRate(state, "ktlo"));
}

export function isRetiredProject(content: GameContent, id: string): boolean {
  return (content.retiredProjectIds ?? []).includes(id);
}
