import type { DecisionDef, Effect, GambleOutcome } from "../engine/types";

// Derives a terse, numbers-only summary of what a decision does, straight
// from its structured `effects`/`gamble`/`incomePerDay` data (see design doc
// docs/superpowers/specs/2026-07-22-card-legibility-design.md section 3).
// This is deliberately NOT prose: the authored `description` carries the
// benefit/catch narrative, this line exists so a balance retune can never
// leave the card lying about its own numbers. Synergy-conditional effects
// are intentionally not summarized here (spec section 3): they're
// conditional on ownership of another decision and the authored prose
// already mentions the synergy partner.

function fmtNum(n: number): string {
  // Round to 2dp and strip trailing zeros (1.0 -> "1", 1.20 -> "1.2") so a
  // whole-number rate reads as "+1/day" rather than "+1.0/day", matching the
  // shipped exemplars in the design doc.
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

// Explicit sign for add-op deltas: fmtNum already embeds "-" for negatives,
// so only the "+" needs adding here.
function signed(n: number): string {
  return n >= 0 ? `+${fmtNum(n)}` : fmtNum(n);
}

function rateLabel(target: "pull" | "finish" | "deploy" | "all"): string {
  return target === "all" ? "all rates" : target;
}

// Short display labels for stock keys used in scaleStock/addToStock
// summaries -- "debt" reads better on a narrow card than "techDebt".
const STOCK_LABELS: Record<string, string> = {
  techDebt: "debt",
  inProgress: "in progress",
};
function stockLabel(stock: string): string {
  return STOCK_LABELS[stock] ?? stock;
}

// FELT duration, not the raw field: durationDays counts from the moment a
// modifier is created (expiresDay = day + durationDays), but expired
// modifiers are pruned at the START of the tick they expire on, before that
// tick's flows run. A purchase-time effect (between ticks) is therefore
// live for durationDays - 1 subsequent ticks -- this is the same off-by-one
// documented in docs/CONTENT-AUTHORING.md's modifyRate timing note, and the
// authored descriptions are written in terms of this felt number, so the
// derived line must agree with them rather than the raw field.
function withFeltDuration(body: string, durationDays: number | undefined): string {
  return durationDays === undefined ? body : `${body} for ${durationDays - 1}d`;
}

function describeEffect(effect: Effect): string | null {
  switch (effect.type) {
    case "modifyRate": {
      const label = rateLabel(effect.target);
      const body = effect.op === "mul" ? `${label} x${fmtNum(effect.value)}` : `${label} ${signed(effect.value)}/day`;
      return withFeltDuration(body, effect.durationDays);
    }
    case "modifyDebtMultiplier": {
      const body = effect.op === "mul" ? `debt x${fmtNum(effect.value)}` : `debt ${signed(effect.value)}`;
      return withFeltDuration(body, effect.durationDays);
    }
    case "addToStock":
      return `${stockLabel(effect.stock)} ${signed(effect.value)}`;
    case "scaleStock": {
      const pctReduction = Math.round((1 - effect.factor) * 100);
      const label = stockLabel(effect.stock);
      return pctReduction >= 0 ? `${label} -${pctReduction}%` : `${label} +${Math.abs(pctReduction)}%`;
    }
    case "rampRate":
      return `${effect.target} +${fmtNum(effect.perDay)}/day up to +${fmtNum(effect.cap)}`;
    case "continuousDeploy":
      return "removes the Done stage";
    case "sickness":
      // Schema-legal but functionally inert on a decision's own effects (see
      // docs/CONTENT-AUTHORING.md section 3): applyDecision never threads an
      // instanceId through, so this never actually does anything when it
      // lives here. Nothing to summarize; filtered out by the caller.
      return null;
    case "removeHuman":
      // Challenge-only roster loss; not used on shop decision cards today.
      return "loses a developer";
    default: {
      // Exhaustiveness guard: a new Effect variant that reaches here is a
      // compile error, not a silently-blank card.
      const exhaustive: never = effect;
      return exhaustive;
    }
  }
}

// Collapses one gamble outcome's modifyRate effects to a single
// (label, op, value) when every rate they touch moves by the same op+value
// (e.g. basic-dev's outcomes move pull and finish by the same amount) --
// this is what lets the range form read as "all rates +2.0 to -0.5" rather
// than repeating pull and finish separately. Returns null when the outcome
// doesn't collapse cleanly (mixed ops/values, or no rate effects at all),
// which routes the whole gamble to the best/worst fallback below.
function collapsedOutcome(effects: Effect[]): { label: string; op: "add" | "mul"; value: number } | null {
  const rateEffects = effects.filter((e): e is Extract<Effect, { type: "modifyRate" }> => e.type === "modifyRate");
  if (rateEffects.length === 0) return null;
  const [first, ...rest] = rateEffects;
  const uniform = rest.every((e) => e.op === first.op && e.value === first.value) && first.durationDays === undefined && rest.every((e) => e.durationDays === undefined);
  if (!uniform) return null;
  const targets = new Set(rateEffects.map((e) => e.target));
  const label = targets.size > 1 || targets.has("all") ? "all rates" : rateLabel(first.target);
  return { label, op: first.op, value: first.value };
}

// Best-effort magnitude for the heterogeneous fallback: sums every numeric
// effect value/factor an outcome carries so outcomes can still be ranked
// best-to-worst even when they don't collapse to one clean rate delta.
function outcomeScore(effects: Effect[]): number {
  return effects.reduce((sum, e) => {
    if (e.type === "modifyRate" || e.type === "modifyDebtMultiplier") return sum + e.value;
    if (e.type === "addToStock") return sum + e.value;
    if (e.type === "scaleStock") return sum + e.factor;
    return sum;
  }, 0);
}

function summarizeGamble(gamble: GambleOutcome[]): string {
  const collapsed = gamble.map((o) => collapsedOutcome(o.effects));
  const allCollapsed = collapsed.every((c): c is NonNullable<typeof c> => c !== null);
  if (allCollapsed) {
    const labels = new Set(collapsed.map((c) => c!.label));
    const ops = new Set(collapsed.map((c) => c!.op));
    if (labels.size === 1 && ops.size === 1) {
      const label = collapsed[0]!.label;
      const op = collapsed[0]!.op;
      const values = collapsed.map((c) => c!.value);
      const max = Math.max(...values);
      const min = Math.min(...values);
      // Fixed to 1 decimal place (unlike fmtNum elsewhere): gamble outcome
      // values are authored to 1dp (2.0, 1.0, 0.5, -0.5, ...) and a range
      // reads oddly with mismatched precision at its two ends -- see the
      // design doc's own exemplar, "all rates +2.0 to -0.5 (gamble)".
      const fmtRange = (v: number) => (op === "mul" ? `x${v.toFixed(1)}` : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`);
      // The range shows the spread; the card's gamble chip carries the
      // "this is a gamble" label, so it is not repeated in the suffix here.
      return `${label} ${fmtRange(max)} to ${fmtRange(min)}`;
    }
  }
  // Fallback: shape is too heterogeneous to range cleanly (spec section 3)
  // -- name the best and worst outcome instead of trying to force a range.
  const scored = gamble.map((o) => ({ label: o.label, score: outcomeScore(o.effects) }));
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const worst = scored.reduce((a, b) => (b.score < a.score ? b : a));
  return `${best.label} to ${worst.label}`;
}

// Pure: same DecisionDef always yields the same string. Never returns "" for
// a shipped decision -- a decision with no effects, no gamble, and no
// incomePerDay (e.g. agent-harness, whose only job is a synergy target)
// still needs something on the card rather than a blank derived line.
export function summarizeDecisionEffects(def: DecisionDef): string {
  const parts: string[] = [];
  for (const effect of def.effects) {
    const s = describeEffect(effect);
    if (s) parts.push(s);
  }
  if (def.incomePerDay) parts.push(`+$${fmtNum(def.incomePerDay)}/day`);
  if (def.gamble && def.gamble.length > 0) parts.push(summarizeGamble(def.gamble));
  // Empty for decisions whose only job is to be a synergy target or a
  // challenge gate (agent-harness, swarm-orchestrator, eng-manager,
  // ddos-protection). The caller omits the line entirely rather than
  // printing "no direct effect", which reads as "this does nothing" on a
  // purchase that costs real money; their authored description carries the
  // conditional story instead.
  return parts.join(", ");
}
