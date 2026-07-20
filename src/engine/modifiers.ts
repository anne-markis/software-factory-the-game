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

// Tech-debt drag (Release 15, Limits to Growth): the debt stock pushes back on
// throughput. Debt at or below debtDragFreeDebt costs nothing; every point of
// excess above it slows all rates by debtDragPerPoint, and the total slowdown
// is capped at debtDragMaxDrag. Returns a multiplier in [1 - maxDrag, 1] that
// effectiveRate applies to every rate alongside the context-switch tax. Pure.
export function debtDragMultiplier(state: GameState): number {
  const excess = Math.max(0, state.stocks.techDebt - state.debtDragFreeDebt);
  const drag = Math.min(state.debtDragMaxDrag, excess * state.debtDragPerPoint);
  return 1 - drag;
}

export function effectiveRate(state: GameState, rate: RateId): number {
  let value = state.baseRates[rate];
  // Sickness deliberately scales only add-op modifiers (an instance's additive
  // contribution to a rate). If a future sick-able concept uses mul modifiers,
  // sickness will not apply to it without extending this function.
  for (const m of state.modifiers) {
    if (m.op === "add" && applies(m, rate)) value += m.value * sickFactorFor(state, m.source);
  }
  for (const m of state.modifiers) {
    if (m.op === "mul" && applies(m, rate)) value *= m.value;
  }
  value *= contextSwitchTax(state);
  value *= debtDragMultiplier(state);
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
