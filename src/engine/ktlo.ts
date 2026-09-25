import type { GameContent, GameState, HostingTier, PermanentProjectDef } from "./types";
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

/** Highest hosting band the current user count qualifies for. */
export function activeHostingTier(def: PermanentProjectDef, users: number): HostingTier | undefined {
  let best: HostingTier | undefined;
  for (const tier of def.hostingTiers ?? []) {
    if (users >= tier.minUsers && (best === undefined || tier.minUsers > best.minUsers)) best = tier;
  }
  return best;
}

/** Next hosting band above the current user count. */
export function nextHostingTier(def: PermanentProjectDef, users: number): HostingTier | undefined {
  let next: HostingTier | undefined;
  for (const tier of def.hostingTiers ?? []) {
    if (tier.minUsers > users && (next === undefined || tier.minUsers < next.minUsers)) next = tier;
  }
  return next;
}

function hostingPerDay(def: PermanentProjectDef, users: number): number {
  return activeHostingTier(def, users)?.perDay ?? 0;
}

/** Sum of live modifyKtloCash adds. A credit is a negative value. */
export function ktloCashAdjustment(state: Pick<GameState, "modifiers">): number {
  let n = 0;
  for (const m of state.modifiers) {
    if (m.target === "ktloCash" && m.op === "add") n += m.value;
  }
  return n;
}

/** Cash drain on Keep the lights on, plus hosting band, card surcharges, and live spikes. */
export function ktloBurnPerDay(
  state: Pick<GameState, "decisions" | "day" | "stocks" | "modifiers">,
  content: GameContent,
): number {
  let n = 0;
  for (const def of permanentProjects(content)) {
    n += def.perDay;
    n += hostingPerDay(def, state.stocks.users);
  }
  for (const inst of state.decisions) {
    if (!instanceIsActive(inst, state.day)) continue;
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (def?.ktloPerDay) n += def.ktloPerDay;
  }
  n += ktloCashAdjustment(state);
  return Math.max(0, n);
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
