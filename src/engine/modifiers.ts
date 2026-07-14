import type { GameState, Modifier, RateId } from "./types";

export function pruneExpired(state: GameState): void {
  state.modifiers = state.modifiers.filter((m) => m.expiresDay === undefined || m.expiresDay > state.day);
  for (const d of state.decisions) {
    if (d.sickUntilDay !== undefined && d.sickUntilDay <= state.day) {
      delete d.sickUntilDay;
      delete d.sickFactor;
    }
  }
}

function sickFactorFor(state: GameState, source: string): number {
  const inst = state.decisions.find((d) => d.instanceId === source);
  if (inst && inst.sickUntilDay !== undefined && inst.sickUntilDay > state.day) {
    return inst.sickFactor ?? 1;
  }
  return 1;
}

function applies(m: Modifier, rate: RateId): boolean {
  return m.target === rate || m.target === "allRates";
}

export function contextSwitchTax(state: GameState): number {
  const n = state.projects.length;
  return n <= 1 ? 1 : Math.pow(state.contextSwitchFactor, n - 1);
}

export function effectiveRate(state: GameState, rate: RateId): number {
  let value = state.baseRates[rate];
  for (const m of state.modifiers) {
    if (m.op === "add" && applies(m, rate)) value += m.value * sickFactorFor(state, m.source);
  }
  for (const m of state.modifiers) {
    if (m.op === "mul" && applies(m, rate)) value *= m.value;
  }
  value *= contextSwitchTax(state);
  return Math.max(0, value);
}

export function effectiveDebtMultiplier(state: GameState): number {
  let value = state.debtMultiplierBase;
  for (const m of state.modifiers) {
    if (m.target === "debtMultiplier" && m.op === "add") value += m.value;
  }
  for (const m of state.modifiers) {
    if (m.target === "debtMultiplier" && m.op === "mul") value *= m.value;
  }
  return Math.max(0, value);
}
