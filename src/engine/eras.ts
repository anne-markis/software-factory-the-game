import type { EraDef, EraEntryPredicate, ErasConfig, GameState } from "./types";

/** AND of the floors on one entry path. Schema requires at least one floor. */
export function eraEntryPredicateMet(
  state: Readonly<GameState>,
  predicate: EraEntryPredicate,
): boolean {
  if (predicate.minBudget !== undefined && state.stocks.budget < predicate.minBudget) {
    return false;
  }
  if (predicate.minReputation !== undefined && state.stocks.reputation < predicate.minReputation) {
    return false;
  }
  if (
    predicate.minCompletedProjects !== undefined &&
    state.completedProjects < predicate.minCompletedProjects
  ) {
    return false;
  }
  if (predicate.minUsers !== undefined && state.stocks.users < predicate.minUsers) {
    return false;
  }
  return true;
}

export function formatEraEntryPredicate(predicate: EraEntryPredicate): string {
  const parts: string[] = [];
  if (predicate.minBudget !== undefined) {
    parts.push(`$${predicate.minBudget.toLocaleString("en-US")} budget`);
  }
  if (predicate.minReputation !== undefined) {
    parts.push(`${predicate.minReputation} reputation`);
  }
  if (predicate.minCompletedProjects !== undefined) {
    parts.push(`${predicate.minCompletedProjects} completed projects`);
  }
  if (predicate.minUsers !== undefined) {
    parts.push(`${predicate.minUsers} users`);
  }
  return parts.join(" and ");
}

export function eraDisplayName(eras: ErasConfig | undefined, eraId: string): string {
  return eras?.eras.find((era) => era.id === eraId)?.name ?? eraId;
}

/** Next era on the one-way ladder, or undefined when this is the last rung. */
export function nextEraDef(eras: ErasConfig, eraId: string): EraDef | undefined {
  const index = eras.eras.findIndex((era) => era.id === eraId);
  if (index < 0 || index >= eras.eras.length - 1) return undefined;
  return eras.eras[index + 1];
}

/**
 * If any OR-path into the next era is met, return that era and the first
 * matching path. Tick stays name-dumb: it only walks the ordered catalog.
 */
export function evaluateNextEraEntry(
  state: Readonly<GameState>,
  eras: ErasConfig,
): { era: EraDef; path: EraEntryPredicate } | null {
  const next = nextEraDef(eras, state.eraId);
  if (!next?.entryAnyOf) return null;
  for (const path of next.entryAnyOf) {
    if (eraEntryPredicateMet(state, path)) {
      return { era: next, path };
    }
  }
  return null;
}
