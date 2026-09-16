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

/** Amber/red class for a live drag; undefined while the free band still covers it. */
export function debtToneClass(tone: DebtConsequenceTone): "debt-warn" | "debt-high" | undefined {
  if (tone === "ok") return undefined;
  return tone === "high" ? "debt-high" : "debt-warn";
}

/**
 * Compact slowdown for the throughput number (Points/Day), or null while
 * the free band still covers it. Lives on the rate that actually slows,
 * not on the Tech Debt counter.
 */
export function debtDragLabel(state: Readonly<GameState>): string | null {
  const drag = 1 - debtDragMultiplier(state);
  if (drag <= 0) return null;
  const dragPct = Math.round(drag * 100);
  if (dragPct === 0) return "-<1%";
  return `-${dragPct}%`;
}

export function formatThroughputValue(state: Readonly<GameState>): string {
  const n = fmt(state.pointsPerDay);
  const drag = debtDragLabel(state);
  return drag ? `${n} (${drag})` : n;
}
