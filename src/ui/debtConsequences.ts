import { debtDragMultiplier } from "../engine/modifiers";
import type { GameState } from "../engine/types";

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export type DebtConsequenceTone = "ok" | "warn" | "high";

export function debtConsequenceTone(state: Readonly<GameState>): DebtConsequenceTone {
  const drag = 1 - debtDragMultiplier(state);
  if (drag >= state.debtDragMaxDrag - 1e-12) return "high";
  if (drag > 0) return "warn";
  return "ok";
}

/** Live slowdown from excess debt, or null while the free band still covers it. */
export function debtDragLabel(state: Readonly<GameState>): string | null {
  const drag = 1 - debtDragMultiplier(state);
  if (drag <= 0) return null;
  const dragPct = Math.round(drag * 100);
  if (drag >= state.debtDragMaxDrag - 1e-12) return `${dragPct}% slower (max)`;
  if (dragPct === 0) return "<1% slower";
  return `${dragPct}% slower`;
}

export function formatDebtStatValue(state: Readonly<GameState>): string {
  const n = fmt(state.stocks.techDebt);
  const drag = debtDragLabel(state);
  return drag ? `${n} (${drag})` : n;
}

export function debtRegenCaption(state: Readonly<GameState>, leakPerPoint: string): string {
  const drag = debtDragLabel(state);
  return drag ? `debt +${leakPerPoint}/pt · ${drag}` : `debt +${leakPerPoint}/pt`;
}
