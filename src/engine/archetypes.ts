import type { GameContent, GameState } from "./types";
import { debtDragMultiplier } from "./modifiers";

// Systems-thinking archetype narration (Release 15). Engine-detected, each
// fires exactly once per game into the event log, guarded by
// state.archetypesSeen. Kept out of content for now: these are cross-cutting
// observations about the whole loop's behavior, not a single decision's
// effect, and their thresholds derive from the debtDrag config rather than
// any new magic numbers.
//
// This module depends only on types.ts and modifiers.ts (both cycle-free).
// tick.ts passes its own `log` in rather than this module importing it, so
// there is no tick <-> archetypes import cycle (mirroring the reasoning in
// continuousDeploy.ts).

// A decision "raises the debt multiplier" if a base effect multiplies it above
// 1 (agent, copilot, contractor, agent-swarm in shipped content). Derived from
// effects, not a hardcoded id list, so new content is classified automatically.
function raisesDebt(content: GameContent, defId: string): boolean {
  const def = content.decisions.find((d) => d.id === defId);
  return def?.effects.some((e) => e.type === "modifyDebtMultiplier" && e.op === "mul" && e.value > 1) ?? false;
}

// Product of a def's base debt-multiplier mul effects (1 if none), used to
// compare a synergy's debt against its base and spot structural mitigators.
function debtMulProduct(effects: readonly { type: string; op?: string; value?: number }[]): number {
  let p = 1;
  for (const e of effects) {
    if (e.type === "modifyDebtMultiplier" && e.op === "mul" && typeof e.value === "number") p *= e.value;
  }
  return p;
}

// The set of decision ids that "lower the debt multiplier" -- either directly
// (a base effect multiplies debt below 1, e.g. test-suite; or a base effect
// shrinks the techDebt stock via scaleStock with factor < 1, e.g.
// refactoring-sprint/redesign-rebuild, Release 16) or structurally, by being
// the ifOwned provider of a synergy that reduces some decision's debt below
// its base (agent-harness for agent, swarm-orchestrator for agent-swarm).
// Derived entirely from content so the archetypes stay data-driven.
function debtLowererIds(content: GameContent): Set<string> {
  const ids = new Set<string>();
  for (const def of content.decisions) {
    if (def.effects.some((e) => e.type === "modifyDebtMultiplier" && e.op === "mul" && e.value < 1)) {
      ids.add(def.id);
    }
    if (def.effects.some((e) => e.type === "scaleStock" && e.stock === "techDebt" && e.factor < 1)) {
      ids.add(def.id);
    }
    const baseDebt = debtMulProduct(def.effects);
    for (const syn of def.synergies ?? []) {
      // Guard (Release 15 final review): only compare debt products when the
      // synergy's effects actually contain a modifyDebtMultiplier term. A
      // rate-only synergy (e.g. a bonus-speed swap on a debt-raiser) would
      // otherwise default its debt product to 1 via debtMulProduct's
      // no-matching-terms fallback, which reads as "lower than any raiser's
      // baseDebt > 1" and misclassifies the provider as a mitigator even
      // though it never touches the debt multiplier at all.
      if (
        syn.effects &&
        syn.effects.some((e) => e.type === "modifyDebtMultiplier") &&
        debtMulProduct(syn.effects) < baseDebt
      ) {
        ids.add(syn.ifOwned);
      }
    }
  }
  return ids;
}

export function detectArchetypes(
  state: GameState,
  content: GameContent,
  log: (state: GameState, message: string) => void,
): void {
  const seen = new Set(state.archetypesSeen);

  // Limits to growth: the drag has grown past halfway to its cap (threshold
  // derived from maxDrag, not a new constant). The faster you shipped, the
  // more debt you grew; the more debt, the slower you now ship.
  if (!seen.has("limits-to-growth")) {
    const mult = debtDragMultiplier(state);
    if (mult < 1 - state.debtDragMaxDrag / 2) {
      const pct = Math.round((1 - mult) * 100);
      state.archetypesSeen.push("limits-to-growth");
      log(
        state,
        `Limits to growth: tech debt drag now cancels ${pct}% of your capacity. The faster you shipped, the more debt you grew; the more debt, the slower you ship.`,
      );
    }
  }

  // Shifting the burden: quick capacity fixes (2+ debt-raising decisions) are
  // feeding the debt loop while nothing pays it down (zero debt-lowering
  // decisions owned) and debt is already past the grace band (freeDebt).
  if (!seen.has("shifting-the-burden")) {
    const lowerers = debtLowererIds(content);
    let raiserCount = 0;
    let lowererCount = 0;
    for (const inst of state.decisions) {
      if (raisesDebt(content, inst.defId)) raiserCount += 1;
      if (lowerers.has(inst.defId)) lowererCount += 1;
    }
    if (raiserCount >= 2 && lowererCount === 0 && state.stocks.techDebt > state.debtDragFreeDebt) {
      state.archetypesSeen.push("shifting-the-burden");
      log(state, "Shifting the burden: quick capacity fixes are feeding the debt loop while nothing pays it down.");
    }
  }
}
