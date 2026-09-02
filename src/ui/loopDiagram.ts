import type { DeliveryRateId, GameContent, GameState } from "../engine/types";
import { effectiveDebtMultiplier, effectiveRate } from "../engine/modifiers";
import { continuousDeployActive } from "../engine/continuousDeploy";

// The arrows must show what actually flowed through each stage
// this tick, not the stage's uncapped rate (effectiveRate) -- those only
// agree when the stage's upstream stock fully saturates it every tick, and
// diverge whenever a stage is stock-limited (fresh game, post-stall, a newly
// bought speed-up outrunning its upstream stage). tick.ts already computes
// and persists exactly this realized flow per stage (pointsPerDay is the
// realized deploy flow; pullFlow/finishFlow mirror it for the other two
// stages), so read those instead of recomputing/relabeling capacity here.
function realizedFlow(state: Readonly<GameState>, rate: DeliveryRateId): number {
  switch (rate) {
    case "pull":
      return state.pullFlow;
    case "finish":
      return state.finishFlow;
    case "deploy":
      return state.pointsPerDay;
  }
}

type StageKey = "ideas" | "plan" | "backlog" | "inProgress" | "done" | "shipped";

interface StageDef {
  key: StageKey;
  label: string;
  // Ideas and Plan paint total capacity on the box (discover / plan rate),
  // not realized flow. Ready and later stay count-only.
  rateId?: "discover" | "plan";
}

const UPSTREAM: StageDef[] = [
  { key: "ideas", label: "Ideas", rateId: "discover" },
  { key: "plan", label: "Plan", rateId: "plan" },
];

const PIPELINE_FULL: StageDef[] = [
  // ADR 0009: Ready is waiting-to-pull (`backlog`). Cockpit "Backlog" is
  // unshipped work across Ready + In Progress + Done, not this box. Ideas
  // and Plan sit left of Ready; they are stocks, not pipeline stages.
  { key: "backlog", label: "Ready" },
  { key: "inProgress", label: "In Progress" },
  { key: "done", label: "Done" },
  { key: "shipped", label: "Shipped" },
];

// Continuous-deploy layout: Done is dropped -- once ci-cd is owned it always
// pins at 0 (tick.ts ships the whole done stock every tick), so a box for it
// would only ever read 0 and add nothing. Ideas and Plan stay.
const PIPELINE_CD: StageDef[] = [
  { key: "backlog", label: "Ready" },
  { key: "inProgress", label: "In Progress" },
  { key: "shipped", label: "Shipped" },
];

const BOX_W = 150;
const BOX_H = 78;
const GAP = 48;
const Y = 24;
const STAGE_COUNT = 6;
const VIEW_W = STAGE_COUNT * BOX_W + (STAGE_COUNT - 1) * GAP + 32;
// Room below the debt-regen arc for the FR-2.1 teaching caption.
const VIEW_H = 200;

// FR-2.1: terse Delivery-loop teaching caption, voice-matched to
// the Progress panel footer ("The inner system's pace sets outer throughput…").
// Binding-stage visual cue (FR-2.2) is separate; this copy always shows.
export const DELIVERY_LOOP_CAPTION =
  "A steady box means balanced flow; a growing box marks the bottleneck.";

// binding-stage bottleneck cue (machine-side only).
//
// Threshold (documented for the PR / DoD):
// - Inflow capacity must be clearly ahead of outflow: inflowRate >=
//   INFLOW_RATIO × outflowRate (1.5×). Uses effectiveRate (decision-facing
//   capacity), not realized flow — a starved upstream can make realized
//   inflow look low even when the stage is the structural bottleneck.
// - The pile itself proves a sustained stretch: stock >= SUSTAINED_DAYS
//   days of outflow capacity (3 days). No streak counter in engine/UI
//   state — a transient blip never reaches a 3-day pile.
// - Zero outflow with a non-empty stock and positive inflow also counts
//   (infinite days of backlog).
// Among candidates, pick the largest days-of-outflow pile (most visibly
// stuck). Continuous deploy drops Done, so only In Progress can cue then.
// Ideas / Plan never cue: they are not pipeline stages. A healthy balanced
// loop (equal rates, small stocks) never cues.
export type BindingStage = "inProgress" | "done";

export const BINDING_INFLOW_RATIO = 1.5;
export const BINDING_SUSTAINED_DAYS = 3;

interface BindingCandidate {
  stage: BindingStage;
  daysOfOutflow: number;
}

function candidateDays(
  stock: number,
  inflowRate: number,
  outflowRate: number,
): number | null {
  if (stock <= 0 || inflowRate <= 0) return null;
  if (outflowRate <= 0) return Infinity;
  if (inflowRate < BINDING_INFLOW_RATIO * outflowRate) return null;
  const days = stock / outflowRate;
  return days >= BINDING_SUSTAINED_DAYS ? days : null;
}

export function bindingBottleneckStage(
  state: Readonly<GameState>,
  content: GameContent,
): BindingStage | null {
  const candidates: BindingCandidate[] = [];

  const pull = effectiveRate(state, "pull");
  const finish = effectiveRate(state, "finish");
  const inProgressDays = candidateDays(state.stocks.inProgress, pull, finish);
  if (inProgressDays !== null) {
    candidates.push({ stage: "inProgress", daysOfOutflow: inProgressDays });
  }

  if (!continuousDeployActive(state, content)) {
    const deploy = effectiveRate(state, "deploy");
    const doneDays = candidateDays(state.stocks.done, finish, deploy);
    if (doneDays !== null) {
      candidates.push({ stage: "done", daysOfOutflow: doneDays });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.daysOfOutflow - a.daysOfOutflow);
  return candidates[0]!.stage;
}

function pipelineFlowBetween(from: StageKey, to: StageKey): DeliveryRateId | null {
  if (from === "backlog" && to === "inProgress") return "pull";
  if (from === "inProgress" && to === "done") return "finish";
  if (from === "done" && to === "shipped") return "deploy";
  // Continuous deploy: finish ships straight from In Progress to Shipped.
  if (from === "inProgress" && to === "shipped") return "finish";
  return null;
}

function fmtStock(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function fmtRate(value: number): string {
  return `${value.toFixed(1)}/day`;
}

// Font sizes 16/18: six boxes use a wider viewBox at full cockpit width so
// the same source sizes stay readable without shrinking into soup.
function box(
  x: number,
  label: string,
  value: number,
  binding: boolean,
  stageKey: string,
  rateLabel?: string,
): string {
  const text = fmtStock(value);
  // Binding cue: thicker stroke + data attribute for tests / assistive tech.
  // Caption lives under the stage box (same italic voice as continuous deploy).
  const strokeWidth = binding ? ' stroke-width="2.5"' : "";
  const dataAttr = binding ? ' data-binding="true"' : "";
  const cue = binding
    ? `
      <text x="${x + BOX_W / 2}" y="${Y + BOX_H + 14}" text-anchor="middle" font-size="10" font-style="italic" fill="currentColor">capacity-bound</text>`
    : "";
  const rate =
    rateLabel !== undefined
      ? `
      <text x="${x + BOX_W / 2}" y="${Y + 66}" text-anchor="middle" font-size="12" fill="currentColor" data-stage-rate="true">${rateLabel}</text>`
      : "";
  return `
      <g data-stage="${stageKey}">
      <rect x="${x}" y="${Y}" width="${BOX_W}" height="${BOX_H}" fill="none" stroke="currentColor"${strokeWidth}${dataAttr}/>
      <text x="${x + BOX_W / 2}" y="${Y + 24}" text-anchor="middle" font-size="16" fill="currentColor">${label}</text>
      <text x="${x + BOX_W / 2}" y="${Y + 46}" text-anchor="middle" font-size="18" font-weight="bold" fill="currentColor" data-stage-value="true">${text}</text>${rate}${cue}
      </g>`;
}

function arrow(x1: number, x2: number, label: string, bindingOutflow = false): string {
  const mid = Y + BOX_H / 2;
  // Outflow of the binding stage gets a matching thicker stroke so the
  // "stuck here" read includes the constrained arrow, not only the box.
  const strokeWidth = bindingOutflow ? ' stroke-width="2.5"' : "";
  const dataAttr = bindingOutflow ? ' data-binding-outflow="true"' : "";
  const caption = label
    ? `
      <text x="${(x1 + x2) / 2}" y="${mid - 8}" text-anchor="middle" font-size="11" fill="currentColor">${label}</text>`
    : "";
  return `
      <line x1="${x1}" y1="${mid}" x2="${x2 - 8}" y2="${mid}" stroke="currentColor" marker-end="url(#arrow)"${strokeWidth}${dataAttr}/>${caption}`;
}

function debtRegenLoop(startX: number, endX: number, debt: string): string {
  const loopY = Y + BOX_H + 40;
  return `
    <path d="M ${startX} ${Y + BOX_H} V ${loopY} H ${endX} V ${Y + BOX_H + 8}" fill="none" stroke="currentColor" stroke-dasharray="4 3" marker-end="url(#arrow)"/>
    <text x="${(startX + endX) / 2}" y="${loopY - 6}" text-anchor="middle" font-size="11" fill="currentColor">debt +${debt}/pt</text>`;
}

const DEFS = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`;

function ariaLabel(binding: BindingStage | null): string {
  if (binding === "done") return "Delivery loop, Done capacity-bound";
  if (binding === "inProgress") return "Delivery loop, In Progress capacity-bound";
  return "Delivery loop";
}

function teachingCaption(): string {
  return `<text x="10" y="${VIEW_H - 10}" font-size="12" fill="currentColor">${DELIVERY_LOOP_CAPTION}</text>`;
}

function stageX(x0: number, index: number): number {
  return x0 + index * (BOX_W + GAP);
}

function deliveryLoop(
  state: Readonly<GameState>,
  binding: BindingStage | null,
  stages: StageDef[],
  continuousDeploy: boolean,
): string {
  // Re-center when Done drops so five boxes do not read as a truncated six.
  const contentWidth = stages.length * BOX_W + (stages.length - 1) * GAP;
  const x0 = (VIEW_W - contentWidth) / 2;

  const boxes = stages
    .map((stage, i) => {
      const rateLabel = stage.rateId ? fmtRate(effectiveRate(state, stage.rateId)) : undefined;
      return box(
        stageX(x0, i),
        stage.label,
        state.stocks[stage.key],
        binding === stage.key,
        stage.key,
        rateLabel,
      );
    })
    .join("");

  const arrows = stages
    .slice(0, -1)
    .map((from, i) => {
      const to = stages[i + 1]!;
      const x1 = stageX(x0, i) + BOX_W;
      const x2 = x1 + GAP;
      const flow = pipelineFlowBetween(from.key, to.key);
      const label = flow ? fmtRate(realizedFlow(state, flow)) : "";
      const bindingOutflow =
        (binding === "inProgress" && flow === "finish") || (binding === "done" && flow === "deploy");
      const cdCaption =
        continuousDeploy && flow === "finish"
          ? `
      <text x="${(x1 + x2) / 2}" y="${Y + BOX_H / 2 + 16}" text-anchor="middle" font-size="10" font-style="italic" fill="currentColor">continuous deploy</text>`
          : "";
      return arrow(x1, x2, label, bindingOutflow) + cdCaption;
    })
    .join("");

  // Tech-debt regen returns to Ready, not Ideas.
  const readyIdx = stages.findIndex((s) => s.key === "backlog");
  const shippedIdx = stages.findIndex((s) => s.key === "shipped");
  const startX = stageX(x0, shippedIdx) + BOX_W / 2;
  const endX = stageX(x0, readyIdx) + BOX_W / 2;
  const regen = debtRegenLoop(startX, endX, effectiveDebtMultiplier(state).toFixed(1));

  return `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="100%" role="img" aria-label="${ariaLabel(binding)}">
      ${DEFS}
      ${boxes}${arrows}${regen}
      ${teachingCaption()}
    </svg>`;
}

export function loopDiagramSvg(state: Readonly<GameState>, content: GameContent): string {
  const binding = bindingBottleneckStage(state, content);
  const cd = continuousDeployActive(state, content);
  const stages = cd ? [...UPSTREAM, ...PIPELINE_CD] : [...UPSTREAM, ...PIPELINE_FULL];
  return deliveryLoop(state, binding, stages, cd);
}
