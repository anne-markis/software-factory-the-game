import type { StockFlowMod, StockName } from "../engine/types";

// Display labels for completion grants / flow mods. "debt" matches the
// shop's derived line; "users" stays plural (unlike income-per-user).
const STOCK_LABELS: Record<string, string> = {
  techDebt: "debt",
  inProgress: "in progress",
};

function stockLabel(stock: string): string {
  return STOCK_LABELS[stock] ?? stock;
}

function signedInt(n: number): string {
  const abs = Math.abs(n);
  const body = Object.is(abs, -0) ? "0" : String(abs);
  if (n > 0) return `+${body}`;
  if (n < 0) return `−${body}`;
  return "0";
}

export type ProjectChipTone = "rep" | "debt" | "users" | "stock";

export interface ProjectChip {
  tone: ProjectChipTone;
  text: string;
}

export interface ProjectEffectSource {
  reputationReward?: number;
  completionStockGrants?: { stock: StockName; amount: number }[];
  stockFlowMods?: StockFlowMod[];
}

function toneFor(stock: string): ProjectChipTone {
  if (stock === "techDebt") return "debt";
  if (stock === "users") return "users";
  return "stock";
}

/** Color-coded effect chips for a project offer or in-flight row. Money stays in table columns. */
export function projectEffectChips(source: ProjectEffectSource): ProjectChip[] {
  const chips: ProjectChip[] = [];
  const rep = source.reputationReward ?? 0;
  if (rep !== 0) chips.push({ tone: "rep", text: `${signedInt(rep)} rep` });

  for (const grant of source.completionStockGrants ?? []) {
    const label = stockLabel(grant.stock);
    if (grant.stock === "techDebt") {
      chips.push({ tone: "debt", text: `debt ${signedInt(grant.amount)}` });
    } else {
      chips.push({ tone: toneFor(grant.stock), text: `${signedInt(grant.amount)} ${label}` });
    }
  }

  for (const mod of source.stockFlowMods ?? []) {
    const label = stockLabel(mod.stock);
    const tone = toneFor(mod.stock);
    if (mod.acquirePerDayDelta) {
      chips.push({ tone, text: `${signedInt(mod.acquirePerDayDelta)} ${label}/day` });
    }
    if (mod.churnRateDelta) {
      chips.push({ tone, text: `${label} churn ${signedInt(mod.churnRateDelta)}` });
    }
  }
  return chips;
}
