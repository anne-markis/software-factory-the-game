import type { DeliveryRateId, GameContent, GameState, Modifier } from "../engine/types";
import { debtDragMultiplier, effectiveRate } from "../engine/modifiers";
import { esc } from "./render";
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
function contribution(op: "add" | "mul", value: number, ramping = false): string {
  if (op === "add") {
    const display = ramping ? value.toFixed(1) : `${value}`;
    const suffix = ramping ? " (ramping)" : "";
    return `${value >= 0 ? "+" : ""}${display}/day${suffix}`; // negatives carry their own sign
  }
  return `x${value}`;
}

function classifyRateModifier(m: Modifier): RateGroup {
  if (m.op === "mul") return m.value >= 1 ? "speed" : "friction";
  return m.value < 0 ? "friction" : "speed";
}

function targetsFor(rate: DeliveryRateId): ReadonlyArray<Modifier["target"]> {
  return rate === "finish" ? ["finish", "allRates"] : rate === "deploy" ? ["deploy", "allRates"] : ["pull", "allRates"];
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

function inProgressZoom(state: Readonly<GameState>, content: GameContent): string {
  const speedNodes = buildRateGroupNodes(state, content, "speed", "finish");
  const frictionNodes = buildRateGroupNodes(state, content, "friction", "finish");
  const leakNodes = buildLeakNodes(state, content);
  const friction = frictionNodes.length === 0 ? "" : renderCol("Friction", frictionNodes);
  return `
    <div class="stage-zoom" data-zoom-open="inProgress">
      <div class="stage-zoom-head">In Progress</div>
      <div class="stage-zoom-cols">
        ${renderCol("Cycle speed", speedNodes)}
        ${friction}
        ${renderCol("Leak size", leakNodes)}
      </div>
    </div>`;
}

function doneZoom(state: Readonly<GameState>, content: GameContent): string {
  const speedNodes = buildRateGroupNodes(state, content, "speed", "deploy");
  const frictionNodes = buildRateGroupNodes(state, content, "friction", "deploy");
  const finish = effectiveRate(state, "finish");
  const deploy = effectiveRate(state, "deploy");
  const waiting = state.stocks.done.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const bound: ContributorNode[] = [
    { label: `Finish ${finish.toFixed(1)}/day in`, dim: false },
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

export function renderStageZoom(
  state: Readonly<GameState>,
  content: GameContent,
  open: ZoomStage | null,
): string {
  if (open === "inProgress") return inProgressZoom(state, content);
  if (open === "done") return doneZoom(state, content);
  return "";
}
