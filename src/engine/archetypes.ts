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

// A decision "raises the debt multiplier" if a base effect pushes it upward:
// a mul above 1, or an add above 0 (the stacking agent card, -- linear stacking made add the natural op, and an additive raiser is every bit as much of a raiser as a multiplicative one). Derived from effects, not a
// hardcoded id list, so new content is classified automatically.
function raisesDebt(content: GameContent, defId: string): boolean {
  const def = content.decisions.find((d) => d.id === defId);
  return (
    def?.effects.some(
      (e) => e.type === "modifyDebtMultiplier" && (e.op === "mul" ? e.value > 1 : e.value > 0),
    ) ?? false
  );
}

// Where a set of effects leaves the debt multiplier, starting from `base`.
// Evaluated exactly the way effectiveDebtMultiplier does it -- adds first, then
// muls -- so an additive debt term counts here the same as it does in the
// simulation (the stacking agent card made add a real op on this target, and the old mul-only product silently ignored it, which would read a +0.1 raiser as debt-neutral). Used to compare a synergy variant against the
// base effects it replaces.
function debtMulOutcome(base: number, effects: readonly { type: string; op?: string; value?: number }[]): number {
  let value = base;
  for (const e of effects) {
    if (e.type === "modifyDebtMultiplier" && e.op === "add" && typeof e.value === "number") value += e.value;
  }
  for (const e of effects) {
    if (e.type === "modifyDebtMultiplier" && e.op === "mul" && typeof e.value === "number") value *= e.value;
  }
  return value;
}

// The set of decision ids that lower debt directly through their own base
// effects: a base effect pushes the debt multiplier down (a mul below 1, e.g.
// test-suite or the agent harness; or an add below 0), or a base effect shrinks
// the techDebt stock via scaleStock with factor < 1 (Release 16's
// refactor/rebuild pair, now out of Studio). Ownership alone is proof of
// mitigation here, since the effect landed when the instance was bought.
// Derived entirely from content so the archetypes stay data-driven.
function directDebtLowererIds(content: GameContent): Set<string> {
  const ids = new Set<string>();
  for (const def of content.decisions) {
    if (
      def.effects.some(
        (e) => e.type === "modifyDebtMultiplier" && (e.op === "mul" ? e.value < 1 : e.value < 0),
      )
    ) {
      ids.add(def.id);
    }
    if (def.effects.some((e) => e.type === "scaleStock" && e.stock === "techDebt" && e.factor < 1)) {
      ids.add(def.id);
    }
  }
  return ids;
}

function synergyKey(defId: string, ifOwned: string): string {
  return `${defId}\u0000${ifOwned}`;
}

// Keys for the (decision, synergy provider) pairs whose synergy variant
// mitigates debt: the variant's debt-multiplier product comes out below the
// def's base product. No Studio card ships a synergy any more (replaced the agent/harness synergy with global multipliers), but content can
// still author them, so the classification stays.
//
// Structural mitigation like this is only real for an instance that was
// actually purchased under the synergy -- synergies are selected at purchase
// time and recorded as DecisionInstance.appliedSynergyIfOwned -- so owning the
// provider proves nothing on its own (when agent-harness carried the mitigating synergy, the very first agent could never have been bought under it, yet owning the harness used to suppress shifting-the-burden).
// Keyed per pair rather than by provider id so a provider whose synergy is
// debt-mitigating on one decision cannot credit an instance of another
// decision whose synergy with it leaves debt untouched.
function debtMitigatingSynergyKeys(content: GameContent): Set<string> {
  const keys = new Set<string>();
  // The content's own starting debt multiplier: comparing both variants at the
  // real base is what makes an add-op term's weight relative to a mul-op one
  // come out the way it will in play.
  const base = content.start.debtMultiplier;
  for (const def of content.decisions) {
    const baseDebt = debtMulOutcome(base, def.effects);
    for (const syn of def.synergies ?? []) {
      // Guard (Release 15 final review): only compare outcomes when the
      // synergy's effects actually contain a modifyDebtMultiplier term. A
      // rate-only synergy (e.g. a bonus-speed swap on a debt-raiser) leaves the
      // debt multiplier at `base`, which reads as "lower than any raiser's
      // baseDebt" and would misclassify the synergy as a mitigator even though
      // it never touches the debt multiplier at all.
      if (
        syn.effects &&
        syn.effects.some((e) => e.type === "modifyDebtMultiplier") &&
        debtMulOutcome(base, syn.effects) < baseDebt
      ) {
        keys.add(synergyKey(def.id, syn.ifOwned));
      }
    }
  }
  return keys;
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
  // feeding the debt loop while nothing pays it down (no owned instance
  // mitigates debt, either directly or through a synergy it was actually
  // bought under) and debt is already past the grace band (freeDebt).
  if (!seen.has("shifting-the-burden")) {
    const direct = directDebtLowererIds(content);
    const mitigatingSynergies = debtMitigatingSynergyKeys(content);
    let raiserCount = 0;
    let lowererCount = 0;
    for (const inst of state.decisions) {
      if (raisesDebt(content, inst.defId)) raiserCount += 1;
      const mitigates =
        direct.has(inst.defId) ||
        (inst.appliedSynergyIfOwned !== undefined &&
          mitigatingSynergies.has(synergyKey(inst.defId, inst.appliedSynergyIfOwned)));
      if (mitigates) lowererCount += 1;
    }
    if (raiserCount >= 2 && lowererCount === 0 && state.stocks.techDebt > state.debtDragFreeDebt) {
      state.archetypesSeen.push("shifting-the-burden");
      log(state, "Shifting the burden: quick capacity fixes are feeding the debt loop while nothing pays it down.");
    }
  }
}
