import type { GameContent, GameState, RateId } from "../engine/types";
import { RATE_IDS } from "../engine/types";
import { effectiveDebtMultiplier, effectiveRate } from "../engine/modifiers";
import { continuousDeployActive } from "../engine/continuousDeploy";

// Issue #9: the arrows must show what actually flowed through each stage
// this tick, not the stage's uncapped rate (effectiveRate) -- those only
// agree when the stage's upstream stock fully saturates it every tick, and
// diverge whenever a stage is stock-limited (fresh game, post-stall, a newly
// bought speed-up outrunning its upstream stage). tick.ts already computes
// and persists exactly this realized flow per stage (pointsPerDay is the
// realized deploy flow; pullFlow/finishFlow mirror it for the other two
// stages), so read those instead of recomputing/relabeling capacity here.
function realizedFlow(state: Readonly<GameState>, rate: RateId): number {
  switch (rate) {
    case "pull":
      return state.pullFlow;
    case "finish":
      return state.finishFlow;
    case "deploy":
      return state.pointsPerDay;
  }
}

const FULL_STAGES: { key: "backlog" | "inProgress" | "done" | "shipped"; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "inProgress", label: "In Progress" },
  { key: "done", label: "Done" },
  { key: "shipped", label: "Shipped" },
];

// Continuous-deploy layout: Done is dropped -- once ci-cd is owned it always
// pins at 0 (tick.ts ships the whole done stock every tick), so a box for it
// would only ever read 0 and add nothing.
const CD_STAGES: { key: "backlog" | "inProgress" | "shipped"; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "inProgress", label: "In Progress" },
  { key: "shipped", label: "Shipped" },
];

const BOX_W = 150;
const BOX_H = 60;
const GAP = 60;
const Y = 30;
const VIEW_W = 860;
const VIEW_H = 170;

// Issue #64: binding-stage bottleneck cue (machine-side only).
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
// A healthy balanced loop (equal rates, small stocks) never cues.
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

// Font sizes bumped from 13/15 to 16/18: since release 14 this diagram
// renders at half page width (side by side with the progress loop), so the
// same viewBox now scales down further -- the larger source sizes keep the
// scaled-down text legible.
function box(x: number, label: string, value: number, binding: boolean): string {
  const text = value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  // Binding cue: thicker stroke + data attribute for tests / assistive tech.
  // Caption lives under the stage box (same italic voice as continuous deploy).
  const strokeWidth = binding ? ' stroke-width="2.5"' : "";
  const dataAttr = binding ? ' data-binding="true"' : "";
  const cue = binding
    ? `
      <text x="${x + BOX_W / 2}" y="${Y + BOX_H + 14}" text-anchor="middle" font-size="10" font-style="italic" fill="currentColor">capacity-bound</text>`
    : "";
  return `
      <rect x="${x}" y="${Y}" width="${BOX_W}" height="${BOX_H}" fill="none" stroke="currentColor"${strokeWidth}${dataAttr}/>
      <text x="${x + BOX_W / 2}" y="${Y + 24}" text-anchor="middle" font-size="16" fill="currentColor">${label}</text>
      <text x="${x + BOX_W / 2}" y="${Y + 46}" text-anchor="middle" font-size="18" font-weight="bold" fill="currentColor">${text}</text>${cue}`;
}

function arrow(x1: number, x2: number, label: string, bindingOutflow = false): string {
  const mid = Y + BOX_H / 2;
  // Outflow of the binding stage gets a matching thicker stroke so the
  // "stuck here" read includes the constrained arrow, not only the box.
  const strokeWidth = bindingOutflow ? ' stroke-width="2.5"' : "";
  const dataAttr = bindingOutflow ? ' data-binding-outflow="true"' : "";
  return `
      <line x1="${x1}" y1="${mid}" x2="${x2 - 8}" y2="${mid}" stroke="currentColor" marker-end="url(#arrow)"${strokeWidth}${dataAttr}/>
      <text x="${(x1 + x2) / 2}" y="${mid - 8}" text-anchor="middle" font-size="11" fill="currentColor">${label}</text>`;
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

function fourBoxLoop(state: Readonly<GameState>, binding: BindingStage | null): string {
  const boxes = FULL_STAGES.map((stage, i) =>
    box(10 + i * (BOX_W + GAP), stage.label, state.stocks[stage.key], binding === stage.key),
  ).join("");

  // RATE_IDS order is pull → finish → deploy; outflow of inProgress is finish
  // (index 1), outflow of done is deploy (index 2).
  const arrows = RATE_IDS.map((rate, i) => {
    const x1 = 10 + BOX_W + i * (BOX_W + GAP);
    const x2 = x1 + GAP;
    const bindingOutflow =
      (binding === "inProgress" && rate === "finish") || (binding === "done" && rate === "deploy");
    return arrow(x1, x2, `${realizedFlow(state, rate).toFixed(1)}/day`, bindingOutflow);
  }).join("");

  // tech debt regeneration: shipped back to backlog underneath
  const startX = 10 + 3 * (BOX_W + GAP) + BOX_W / 2;
  const endX = 10 + BOX_W / 2;
  const regen = debtRegenLoop(startX, endX, effectiveDebtMultiplier(state).toFixed(1));

  return `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="100%" role="img" aria-label="${ariaLabel(binding)}">
      ${DEFS}
      ${boxes}${arrows}${regen}
    </svg>`;
}

function continuousDeployLoop(state: Readonly<GameState>, binding: BindingStage | null): string {
  // Re-centered for 3 boxes instead of left-aligned like the 4-box layout,
  // so the diagram doesn't read as truncated with empty space on the right.
  const contentWidth = CD_STAGES.length * BOX_W + (CD_STAGES.length - 1) * GAP;
  const x0 = (VIEW_W - contentWidth) / 2;

  const boxes = CD_STAGES.map((stage, i) =>
    box(x0 + i * (BOX_W + GAP), stage.label, state.stocks[stage.key], binding === stage.key),
  ).join("");

  const pullX1 = x0 + BOX_W;
  const pullArrow = arrow(pullX1, pullX1 + GAP, `${realizedFlow(state, "pull").toFixed(1)}/day`);

  const finishArrowX1 = x0 + BOX_W + GAP + BOX_W; // right edge of the inProgress box
  const finishArrowX2 = finishArrowX1 + GAP;
  const finishArrow = arrow(
    finishArrowX1,
    finishArrowX2,
    `${realizedFlow(state, "finish").toFixed(1)}/day`,
    binding === "inProgress",
  );
  const caption = `
      <text x="${(finishArrowX1 + finishArrowX2) / 2}" y="${Y + BOX_H / 2 + 16}" text-anchor="middle" font-size="10" font-style="italic" fill="currentColor">continuous deploy</text>`;

  // tech debt regeneration: shipped (last box) back to backlog (first box)
  const startX = x0 + 2 * (BOX_W + GAP) + BOX_W / 2;
  const endX = x0 + BOX_W / 2;
  const regen = debtRegenLoop(startX, endX, effectiveDebtMultiplier(state).toFixed(1));

  return `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="100%" role="img" aria-label="${ariaLabel(binding)}">
      ${DEFS}
      ${boxes}${pullArrow}${finishArrow}${caption}${regen}
    </svg>`;
}

export function loopDiagramSvg(state: Readonly<GameState>, content: GameContent): string {
  const binding = bindingBottleneckStage(state, content);
  return continuousDeployActive(state, content)
    ? continuousDeployLoop(state, binding)
    : fourBoxLoop(state, binding);
}
