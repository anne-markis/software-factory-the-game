import type { GameContent, GameState, PermanentProjectDef } from "./types";
import { isPermanentProject } from "./types";
import { effectiveRate } from "./modifiers";
import { instanceIsActive } from "./roster";

export function permanentProjects(content: GameContent): PermanentProjectDef[] {
  return content.projects.filter(isPermanentProject);
}

/** Copy catalog basePerDay onto the ktlo rate. Cards then add and multiply. */
export function syncKtloBase(state: GameState, content: GameContent): void {
  let base = 0;
  for (const def of permanentProjects(content)) base += def.basePerDay;
  state.baseRates.ktlo = base;
}

/** Cash drain on Keep the lights on, plus active-card and hosting surcharges. */
export function ktloBurnPerDay(
  state: Pick<GameState, "decisions" | "day" | "stocks">,
  content: GameContent,
): number {
  let n = 0;
  for (const def of permanentProjects(content)) {
    n += def.perDay;
    if (def.hostingPerUser) n += state.stocks.users * def.hostingPerUser;
  }
  for (const inst of state.decisions) {
    if (!instanceIsActive(inst, state.day)) continue;
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (def?.ktloPerDay) n += def.ktloPerDay;
  }
  return n;
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
