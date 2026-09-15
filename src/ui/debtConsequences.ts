import type { GameContent, GameState } from "../engine/types";
import { debtScaledChallengeRisks } from "../engine/challenges";
import { debtDragMultiplier, effectiveDebtMultiplier } from "../engine/modifiers";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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

/** Live, numbers-only facts about what the current techDebt stock is doing. */
export function debtConsequenceParts(state: Readonly<GameState>, content: GameContent): string[] {
  const parts: string[] = [];
  const drag = 1 - debtDragMultiplier(state);
  const dragPct = Math.round(drag * 100);
  if (drag <= 0) {
    parts.push(`no slowdown until ${fmt(state.debtDragFreeDebt)}`);
  } else if (drag >= state.debtDragMaxDrag - 1e-12) {
    parts.push(`${dragPct}% slower (max)`);
  } else if (dragPct === 0) {
    parts.push("<1% slower");
  } else {
    parts.push(`${dragPct}% slower`);
  }

  if (state.completedProjects >= 1) {
    const leak = effectiveDebtMultiplier(state);
    if (leak > 0) parts.push(`rework +${fmt(leak)} per ship`);
  }

  for (const risk of debtScaledChallengeRisks(state, content)) {
    const pct = Math.round(risk.probability * 100);
    parts.push(`${risk.name} ${pct}%/day`);
  }
  return parts;
}

export function renderDebtConsequences(state: Readonly<GameState>, content: GameContent): string {
  const parts = debtConsequenceParts(state, content);
  const tone = debtConsequenceTone(state);
  const toneClass = tone === "ok" ? "" : ` debt-${tone}`;
  return (
    `<div class="debt-consequences${toneClass}" role="status" data-debt-tone="${tone}">` +
    `<span class="debt-consequences-label">Debt</span> ${esc(parts.join(" · "))}` +
    `</div>`
  );
}
