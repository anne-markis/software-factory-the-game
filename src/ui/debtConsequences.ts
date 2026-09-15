import type { GameContent, GameState } from "../engine/types";
import {
  challengeConditionMet,
  challengeProbability,
  debtScalingChallenges,
} from "../engine/challenges";
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

/**
 * What high tech debt does, even at 0. Current magnitudes replace the
 * "after N" phrasing once that effect is live, so the line is a legend at
 * the start of a run and a readout later.
 */
export function debtConsequenceParts(state: Readonly<GameState>, content: GameContent): string[] {
  const parts: string[] = [];
  const drag = 1 - debtDragMultiplier(state);
  const dragPct = Math.round(drag * 100);
  const maxPct = Math.round(state.debtDragMaxDrag * 100);
  if (drag <= 0) {
    parts.push(`slows delivery after ${fmt(state.debtDragFreeDebt)} (up to ${maxPct}%)`);
  } else if (drag >= state.debtDragMaxDrag - 1e-12) {
    parts.push(`${dragPct}% slower (max)`);
  } else if (dragPct === 0) {
    parts.push(`<1% slower (up to ${maxPct}%)`);
  } else {
    parts.push(`${dragPct}% slower (up to ${maxPct}%)`);
  }

  const leak = effectiveDebtMultiplier(state);
  if (leak > 0) {
    if (state.completedProjects >= 1) {
      parts.push(`rework +${fmt(leak)} per ship`);
    } else {
      parts.push("adds rework after first ship");
    }
  }

  for (const def of debtScalingChallenges(content)) {
    if (challengeConditionMet(def, state, content)) {
      const pct = Math.round(challengeProbability(def, state) * 100);
      parts.push(`${def.name} ${pct}%/day`);
    } else {
      parts.push(`${def.name} more likely as debt rises`);
    }
  }
  return parts;
}

export function renderDebtConsequences(state: Readonly<GameState>, content: GameContent): string {
  const parts = debtConsequenceParts(state, content);
  const tone = debtConsequenceTone(state);
  const toneClass = tone === "ok" ? "" : ` debt-${tone}`;
  return (
    `<div class="debt-consequences${toneClass}" role="status" data-debt-tone="${tone}">` +
    `<span class="debt-consequences-label">High tech debt</span> ${esc(parts.join(" · "))}` +
    `</div>`
  );
}
