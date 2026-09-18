import type { DeliveryRateId, GameContent, GameState, Modifier } from "../engine/types";
import { availability, decisionTargetsExactRate } from "../engine/decisions";
import { debtDragMultiplier, effectiveRate } from "../engine/modifiers";
import { esc, renderDecisionNode } from "./render";
import type { ZoomStage } from "./loopDiagram";

export type { ZoomStage };

interface ContributorNode {
  label: string;
  dim: boolean;
}

type RateGroup = "speed" | "friction";

// Challenge/choice modifier sources look like "chal-prod-incident-d103"; strip
// the "chal-" prefix and the trailing "-dNNN" day-stamp to get a readable name.
function cleanSourceLabel(source: string): string {
  return source.replace(/^chal-/, "").replace(/-d\d+$/, "");
}

// Ramp modifiers (rampPerDay set) accumulate via repeated += of small float
// increments (e.g. 0.02/day), so their raw value drifts like 0.39999999999999997.
// Round those to one decimal for display and flag them as still-growing;
// non-ramp contributions are shown at full precision as before.
function contribution(op: "add" | "mul", value: number, ramping = false, unit = "/day"): string {
  if (op === "add") {
    const display = ramping ? value.toFixed(1) : `${value}`;
    const suffix = ramping ? " (ramping)" : "";
    return `${value >= 0 ? "+" : ""}${display}${unit}${suffix}`; // negatives carry their own sign
  }
  return `x${value}`;
}

function classifyRateModifier(m: Modifier): RateGroup {
  if (m.op === "mul") return m.value >= 1 ? "speed" : "friction";
  return m.value < 0 ? "friction" : "speed";
}

function targetsFor(rate: DeliveryRateId): ReadonlyArray<Modifier["target"]> {
  if (rate === "finish") return ["finish", "allRates"];
  if (rate === "review") return ["review", "allRates"];
  if (rate === "deploy") return ["deploy", "allRates"];
  return ["pull", "allRates"];
}

function matchesRate(m: Modifier, rate: DeliveryRateId): boolean {
  return (targetsFor(rate) as readonly string[]).includes(m.target);
}

// Builds a Cycle-speed / Deploy-speed or Friction stack for one pipeline rate.
function buildRateGroupNodes(
  state: Readonly<GameState>,
  content: GameContent,
  group: RateGroup,
  rate: DeliveryRateId,
): ContributorNode[] {
  const nodes: ContributorNode[] = [];
  if (group === "speed") nodes.push({ label: `Base ${state.baseRates[rate].toFixed(1)}/day`, dim: false });

  const instanceIds = new Set(state.decisions.map((d) => d.instanceId));

  for (const inst of state.decisions) {
    const mods = state.modifiers.filter(
      (m) => matchesRate(m, rate) && m.source === inst.instanceId && classifyRateModifier(m) === group,
    );
    if (mods.length === 0) continue;
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    const sick = inst.sickUntilDay !== undefined && inst.sickUntilDay > state.day;
    const contributions = mods.map((m) => contribution(m.op, m.value, m.rampPerDay !== undefined)).join(", ");
    const gamble = inst.gambleLabel ? ` [${inst.gambleLabel}]` : "";
    const sickSuffix = sick ? " (sick)" : "";
    nodes.push({ label: `${def.name}${gamble}: ${contributions}${sickSuffix}`, dim: sick });
  }

  for (const m of state.modifiers) {
    if (!matchesRate(m, rate)) continue;
    if (classifyRateModifier(m) !== group) continue;
    if (instanceIds.has(m.source)) continue;
    const cleaned = cleanSourceLabel(m.source);
    const expiry = m.expiresDay !== undefined ? ` (${m.expiresDay - state.day}d left)` : "";
    nodes.push({ label: `${cleaned}: ${contribution(m.op, m.value, m.rampPerDay !== undefined)}${expiry}`, dim: false });
  }

  if (group === "friction") {
    const drag = debtDragMultiplier(state);
    if (drag < 1) nodes.push({ label: `Tech debt drag x${drag.toFixed(2)}`, dim: false });
  }

  return nodes;
}

function buildLeakNodes(state: Readonly<GameState>, content: GameContent): ContributorNode[] {
  const nodes: ContributorNode[] = [{ label: `Base x${state.debtMultiplierBase}`, dim: false }];
  const instanceIds = new Set(state.decisions.map((d) => d.instanceId));

  for (const inst of state.decisions) {
    const mods = state.modifiers.filter((m) => m.target === "debtMultiplier" && m.source === inst.instanceId);
    if (mods.length === 0) continue;
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    const contributions = mods.map((m) => contribution(m.op, m.value, m.rampPerDay !== undefined)).join(", ");
    const gamble = inst.gambleLabel ? ` [${inst.gambleLabel}]` : "";
    nodes.push({ label: `${def.name}${gamble}: ${contributions}`, dim: false });
  }

  for (const m of state.modifiers) {
    if (m.target !== "debtMultiplier") continue;
    if (instanceIds.has(m.source)) continue;
    const cleaned = cleanSourceLabel(m.source);
    const expiry = m.expiresDay !== undefined ? ` (${m.expiresDay - state.day}d left)` : "";
    nodes.push({ label: `${cleaned}: ${contribution(m.op, m.value, m.rampPerDay !== undefined)}${expiry}`, dim: false });
  }

  return nodes;
}

function renderCol(header: string, nodes: readonly ContributorNode[]): string {
  const items = nodes
    .map((n) => {
      const dim = n.dim ? ` class="stage-zoom-dim"` : "";
      return `<p${dim}>${esc(n.label)}</p>`;
    })
    .join("");
  return `<div><h4>${esc(header)}</h4>${items}</div>`;
}

function buildCapacityNodes(state: Readonly<GameState>, content: GameContent): ContributorNode[] {
  const nodes: ContributorNode[] = [{ label: `Base ${state.baseCapacity}`, dim: false }];
  const seenFromOwned = new Set<string>();
  const instanceIds = new Set(state.decisions.map((d) => d.instanceId));

  for (const inst of state.decisions) {
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    const sick = inst.sickUntilDay !== undefined && inst.sickUntilDay > state.day;
    const gamble = inst.gambleLabel ? ` [${inst.gambleLabel}]` : "";
    const sickSuffix = sick ? " (sick)" : "";
    if (def.capacity && def.capacity !== 0) {
      nodes.push({
        label: `${def.name}${gamble}: +${def.capacity}${sickSuffix}`,
        dim: sick,
      });
    }
    const capMods = state.modifiers.filter((m) => m.target === "capacity" && m.source === inst.instanceId);
    if (capMods.length > 0 && def) {
      const contributions = capMods.map((m) => contribution(m.op, m.value, m.rampPerDay !== undefined, "")).join(", ");
      nodes.push({
        label: `${def.name}${gamble}: ${contributions}${sickSuffix}`,
        dim: sick,
      });
    }
    if (def.capacityFromOwned && !seenFromOwned.has(def.id)) {
      seenFromOwned.add(def.id);
      for (const grant of def.capacityFromOwned) {
        const n = state.decisions.filter((d) => d.defId === grant.id).length;
        const add = n * grant.per;
        if (add === 0) continue;
        const source = content.decisions.find((d) => d.id === grant.id);
        nodes.push({ label: `${source?.name ?? grant.id}: +${add}`, dim: false });
      }
    }
  }

  for (const m of state.modifiers) {
    if (m.target !== "capacity") continue;
    if (instanceIds.has(m.source)) continue;
    const cleaned = cleanSourceLabel(m.source);
    const expiry = m.expiresDay !== undefined ? ` (${m.expiresDay - state.day}d left)` : "";
    nodes.push({
      label: `${cleaned}: ${contribution(m.op, m.value, m.rampPerDay !== undefined, "")}${expiry}`,
      dim: false,
    });
  }

  return nodes;
}

function inProgressZoom(state: Readonly<GameState>, content: GameContent): string {
  const capacityNodes = buildCapacityNodes(state, content);
  const speedNodes = buildRateGroupNodes(state, content, "speed", "finish");
  const frictionNodes = buildRateGroupNodes(state, content, "friction", "finish");
  const leakNodes = buildLeakNodes(state, content);
  const friction = frictionNodes.length === 0 ? "" : renderCol("Friction", frictionNodes);
  return `
    <div class="stage-zoom" data-zoom-open="inProgress">
      <div class="stage-zoom-head">In Progress</div>
      <div class="stage-zoom-cols">
        ${renderCol("Capacity", capacityNodes)}
        ${renderCol("Cycle speed", speedNodes)}
        ${friction}
        ${renderCol("Leak size", leakNodes)}
      </div>
    </div>`;
}

function doneZoom(state: Readonly<GameState>, content: GameContent): string {
  const speedNodes = buildRateGroupNodes(state, content, "speed", "deploy");
  const frictionNodes = buildRateGroupNodes(state, content, "friction", "deploy");
  const review = effectiveRate(state, "review");
  const deploy = effectiveRate(state, "deploy");
  const waiting = state.stocks.done.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const bound: ContributorNode[] = [
    { label: `Review ${review.toFixed(1)}/day in`, dim: false },
    { label: `Deploy ${deploy.toFixed(1)}/day out`, dim: false },
    { label: `${waiting} waiting`, dim: false },
  ];
  const friction = frictionNodes.length === 0 ? "" : renderCol("Friction", frictionNodes);
  return `
    <div class="stage-zoom" data-zoom-open="done">
      <div class="stage-zoom-head">Done</div>
      <div class="stage-zoom-cols">
        ${renderCol("Deploy speed", speedNodes)}
        ${renderCol("Why bound", bound)}
        ${friction}
      </div>
    </div>`;
}

function inReviewZoom(state: Readonly<GameState>, content: GameContent): string {
  const speedNodes = buildRateGroupNodes(state, content, "speed", "review");
  const frictionNodes = buildRateGroupNodes(state, content, "friction", "review");
  const finish = effectiveRate(state, "finish");
  const review = effectiveRate(state, "review");
  const waiting = state.stocks.inReview.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const bound: ContributorNode[] = [
    { label: `Finish ${finish.toFixed(1)}/day in`, dim: false },
    { label: `Review ${review.toFixed(1)}/day out`, dim: false },
    { label: `${waiting} waiting on PRs`, dim: false },
  ];
  const friction = frictionNodes.length === 0 ? "" : renderCol("Friction", frictionNodes);
  return `
    <div class="stage-zoom" data-zoom-open="inReview">
      <div class="stage-zoom-head">In Review</div>
      <div class="stage-zoom-cols">
        ${renderCol("Review speed", speedNodes)}
        ${renderCol("Why bound", bound)}
        ${friction}
        ${renderReviewOffers(state, content)}
      </div>
    </div>`;
}

// Next lever is derived from authored effects: any shop decision whose
// modifyRate target is exactly `review` (not `all`). Ids stay in content.
function renderReviewOffers(state: Readonly<GameState>, content: GameContent): string {
  const ownedCounts = new Map<string, number>();
  for (const inst of state.decisions) {
    ownedCounts.set(inst.defId, (ownedCounts.get(inst.defId) ?? 0) + 1);
  }
  const bits: string[] = [];
  for (const a of availability(state as GameState, content)) {
    if (!decisionTargetsExactRate(a.def, "review")) continue;
    if (a.code === "already-owned") continue;
    if (a.code === "missing-requires") {
      const reason = a.reason ?? "requires another card";
      bits.push(`<p class="stage-zoom-dim">${esc(a.def.name)} — ${esc(reason)}</p>`);
      continue;
    }
    bits.push(renderDecisionNode(a, ownedCounts.get(a.def.id) ?? 0));
  }
  const items = bits.length > 0 ? bits.join("") : `<p class="stage-zoom-dim">No shop card targets review</p>`;
  return `<div><h4>Next lever</h4>${items}</div>`;
}

export function renderStageZoom(
  state: Readonly<GameState>,
  content: GameContent,
  open: ZoomStage | null,
): string {
  if (open === "inProgress") return inProgressZoom(state, content);
  if (open === "inReview") return inReviewZoom(state, content);
  if (open === "done") return doneZoom(state, content);
  return "";
}
