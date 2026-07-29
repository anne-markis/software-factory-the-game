import type { GameContent, GameState, RateId } from "../engine/types";
import { RATE_IDS } from "../engine/types";
import { effectiveDebtMultiplier } from "../engine/modifiers";
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

// Font sizes bumped from 13/15 to 16/18: since release 14 this diagram
// renders at half page width (side by side with the progress loop), so the
// same viewBox now scales down further -- the larger source sizes keep the
// scaled-down text legible.
function box(x: number, label: string, value: number): string {
  const text = value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return `
      <rect x="${x}" y="${Y}" width="${BOX_W}" height="${BOX_H}" fill="none" stroke="currentColor"/>
      <text x="${x + BOX_W / 2}" y="${Y + 24}" text-anchor="middle" font-size="16">${label}</text>
      <text x="${x + BOX_W / 2}" y="${Y + 46}" text-anchor="middle" font-size="18" font-weight="bold">${text}</text>`;
}

function arrow(x1: number, x2: number, label: string): string {
  const mid = Y + BOX_H / 2;
  return `
      <line x1="${x1}" y1="${mid}" x2="${x2 - 8}" y2="${mid}" stroke="currentColor" marker-end="url(#arrow)"/>
      <text x="${(x1 + x2) / 2}" y="${mid - 8}" text-anchor="middle" font-size="11">${label}</text>`;
}

function debtRegenLoop(startX: number, endX: number, debt: string): string {
  const loopY = Y + BOX_H + 40;
  return `
    <path d="M ${startX} ${Y + BOX_H} V ${loopY} H ${endX} V ${Y + BOX_H + 8}" fill="none" stroke="currentColor" stroke-dasharray="4 3" marker-end="url(#arrow)"/>
    <text x="${(startX + endX) / 2}" y="${loopY - 6}" text-anchor="middle" font-size="11">debt +${debt}/pt</text>`;
}

const DEFS = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`;

function fourBoxLoop(state: Readonly<GameState>): string {
  const boxes = FULL_STAGES.map((stage, i) => box(10 + i * (BOX_W + GAP), stage.label, state.stocks[stage.key])).join("");

  const arrows = RATE_IDS.map((rate, i) => {
    const x1 = 10 + BOX_W + i * (BOX_W + GAP);
    const x2 = x1 + GAP;
    return arrow(x1, x2, `${realizedFlow(state, rate).toFixed(1)}/day`);
  }).join("");

  // tech debt regeneration: shipped back to backlog underneath
  const startX = 10 + 3 * (BOX_W + GAP) + BOX_W / 2;
  const endX = 10 + BOX_W / 2;
  const regen = debtRegenLoop(startX, endX, effectiveDebtMultiplier(state).toFixed(1));

  return `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="100%" role="img" aria-label="Delivery loop">
      ${DEFS}
      ${boxes}${arrows}${regen}
    </svg>`;
}

function continuousDeployLoop(state: Readonly<GameState>): string {
  // Re-centered for 3 boxes instead of left-aligned like the 4-box layout,
  // so the diagram doesn't read as truncated with empty space on the right.
  const contentWidth = CD_STAGES.length * BOX_W + (CD_STAGES.length - 1) * GAP;
  const x0 = (VIEW_W - contentWidth) / 2;

  const boxes = CD_STAGES.map((stage, i) => box(x0 + i * (BOX_W + GAP), stage.label, state.stocks[stage.key])).join("");

  const pullX1 = x0 + BOX_W;
  const pullArrow = arrow(pullX1, pullX1 + GAP, `${realizedFlow(state, "pull").toFixed(1)}/day`);

  const finishArrowX1 = x0 + BOX_W + GAP + BOX_W; // right edge of the inProgress box
  const finishArrowX2 = finishArrowX1 + GAP;
  const finishArrow = arrow(finishArrowX1, finishArrowX2, `${realizedFlow(state, "finish").toFixed(1)}/day`);
  const caption = `
      <text x="${(finishArrowX1 + finishArrowX2) / 2}" y="${Y + BOX_H / 2 + 16}" text-anchor="middle" font-size="10" font-style="italic">continuous deploy</text>`;

  // tech debt regeneration: shipped (last box) back to backlog (first box)
  const startX = x0 + 2 * (BOX_W + GAP) + BOX_W / 2;
  const endX = x0 + BOX_W / 2;
  const regen = debtRegenLoop(startX, endX, effectiveDebtMultiplier(state).toFixed(1));

  return `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="100%" role="img" aria-label="Delivery loop">
      ${DEFS}
      ${boxes}${pullArrow}${finishArrow}${caption}${regen}
    </svg>`;
}

export function loopDiagramSvg(state: Readonly<GameState>, content: GameContent): string {
  return continuousDeployActive(state, content) ? continuousDeployLoop(state) : fourBoxLoop(state);
}
