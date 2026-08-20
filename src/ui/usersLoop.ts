import type { GameContent, GameState } from "../engine/types";
import { stockDragMultiplier } from "../engine/modifiers";

export const USERS_LOOP_CAPTION =
  "Users stay 0 until launch; then they grow, pay if you monetize, and slow delivery above the free band.";

const BOX_W = 150;
const BOX_H = 60;
const GAP = 60;
const Y = 30;
const VIEW_W = 860;
const VIEW_H = 188;

const DEFS = `<defs><marker id="users-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`;

function box(x: number, label: string, value: string): string {
  return `
      <rect x="${x}" y="${Y}" width="${BOX_W}" height="${BOX_H}" fill="none" stroke="currentColor"/>
      <text x="${x + BOX_W / 2}" y="${Y + 24}" text-anchor="middle" font-size="16" fill="currentColor">${label}</text>
      <text x="${x + BOX_W / 2}" y="${Y + 46}" text-anchor="middle" font-size="18" font-weight="bold" fill="currentColor">${value}</text>`;
}

function arrow(x1: number, x2: number, label: string): string {
  const mid = Y + BOX_H / 2;
  return `
      <line x1="${x1}" y1="${mid}" x2="${x2 - 8}" y2="${mid}" stroke="currentColor" marker-end="url(#users-arrow)"/>
      <text x="${(x1 + x2) / 2}" y="${mid - 8}" text-anchor="middle" font-size="11" fill="currentColor">${label}</text>`;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function usersDrag(state: Readonly<GameState>): { freeBand: number; drag: number } | null {
  const drag = state.stockDrags.find((d) => d.stock === "users");
  if (!drag) return null;
  return { freeBand: drag.freeBand, drag: 1 - stockDragMultiplier(state, drag.target === "all" ? "finish" : drag.target) };
}

export function usersLoopSvg(state: Readonly<GameState>, _content: GameContent): string {
  const contentWidth = 3 * BOX_W + 2 * GAP;
  const x0 = (VIEW_W - contentWidth) / 2;
  const xRep = x0;
  const xUsers = x0 + BOX_W + GAP;
  const xPay = x0 + 2 * (BOX_W + GAP);

  const acquire = `acquire ${state.userAcquireFlow.toFixed(1)}/day`;
  const churn = `${state.userChurnFlow.toFixed(1)}/day`;
  const income = `$${state.userIncomeFlow.toFixed(1)}/day`;

  const drag = usersDrag(state);
  const dragLabel = drag
    ? drag.drag > 0
      ? `support drag −${(drag.drag * 100).toFixed(0)}% delivery (free band ${drag.freeBand})`
      : `support drag 0% (free band ${drag.freeBand})`
    : "";

  // Balancing leak under the Users stock — same dashed U as Delivery's debt regen.
  const loopY = Y + BOX_H + 40;
  const churnLeft = xUsers + BOX_W * 0.28;
  const churnRight = xUsers + BOX_W * 0.72;
  const churnArc = `
    <path d="M ${churnRight} ${Y + BOX_H} V ${loopY} H ${churnLeft} V ${Y + BOX_H + 8}" fill="none" stroke="currentColor" stroke-dasharray="4 3" marker-end="url(#users-arrow)"/>
    <text x="${xUsers + BOX_W / 2}" y="${loopY - 6}" text-anchor="middle" font-size="11" fill="currentColor">churn ${churn}</text>`;

  const dragLine = dragLabel
    ? `<text x="10" y="${VIEW_H - 28}" font-size="11" fill="currentColor">${dragLabel}</text>`
    : "";

  return `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="100%" role="img" aria-label="User loop">
      ${DEFS}
      ${box(xRep, "Reputation", fmt(state.stocks.reputation))}
      ${arrow(xRep + BOX_W, xUsers, acquire)}
      ${box(xUsers, "Users", fmt(state.stocks.users))}
      ${arrow(xUsers + BOX_W, xPay, income)}
      ${box(xPay, "User income", income.replace("/day", ""))}
      ${churnArc}
      ${dragLine}
      <text x="10" y="${VIEW_H - 10}" font-size="12" fill="currentColor">${USERS_LOOP_CAPTION}</text>
    </svg>`;
}
