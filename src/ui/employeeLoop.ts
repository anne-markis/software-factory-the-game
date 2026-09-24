import type { GameContent, GameState } from "../engine/types";
import { instanceIsActive } from "../engine/roster";

const BOX_W = 150;
const BOX_H = 60;
const GAP = 60;
const Y = 30;
const VIEW_W = 860;
const VIEW_H = 160;

const DEFS = `<defs><marker id="employee-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`;

function box(x: number, label: string, value: string): string {
  return `
      <rect x="${x}" y="${Y}" width="${BOX_W}" height="${BOX_H}" fill="none" stroke="currentColor"/>
      <text x="${x + BOX_W / 2}" y="${Y + 24}" text-anchor="middle" font-size="16" fill="currentColor">${label}</text>
      <text x="${x + BOX_W / 2}" y="${Y + 46}" text-anchor="middle" font-size="18" font-weight="bold" fill="currentColor">${value}</text>`;
}

function arrow(x1: number, x2: number, label: string, coupling = false): string {
  const mid = Y + BOX_H / 2;
  const dash = coupling ? ' stroke-dasharray="4 3" data-coupling="true"' : "";
  return `
      <line x1="${x1}" y1="${mid}" x2="${x2 - 8}" y2="${mid}" stroke="currentColor" marker-end="url(#employee-arrow)"${dash}/>
      <text x="${(x1 + x2) / 2}" y="${mid - 8}" text-anchor="middle" font-size="11" fill="currentColor">${label}</text>`;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function employeeCounts(state: Readonly<GameState>): { active: number; joining: number } {
  let active = 0;
  let joining = 0;
  for (const inst of state.decisions) {
    if (!inst.human) continue;
    if (instanceIsActive(inst, state.day)) active += 1;
    else joining += 1;
  }
  return { active, joining };
}

export function employeeLoopSvg(state: Readonly<GameState>, _content: GameContent): string {
  const contentWidth = 3 * BOX_W + 2 * GAP;
  const x0 = (VIEW_W - contentWidth) / 2;
  const xRep = x0;
  const xMorale = x0 + BOX_W + GAP;
  const xEmp = x0 + 2 * (BOX_W + GAP);

  const pride = `${state.moralePrideFlow.toFixed(1)}/day`;
  const quit = `${pct(state.employeeQuitRate)}/day`;
  const { active, joining } = employeeCounts(state);
  const headcount = joining > 0 ? `${active} (+${joining} join)` : String(active);

  const loopY = Y + BOX_H + 40;
  const left = xMorale + BOX_W * 0.28;
  const right = xMorale + BOX_W * 0.72;
  const overload = state.moraleOverloadFlow;
  const leakLabel = overload > 0 ? `oversight −${overload.toFixed(1)}/day` : "oversight 0/day";
  const leak = `
    <path d="M ${right} ${Y + BOX_H} V ${loopY} H ${left} V ${Y + BOX_H + 8}" fill="none" stroke="currentColor" stroke-dasharray="4 3" marker-end="url(#employee-arrow)"/>
    <text x="${xMorale + BOX_W / 2}" y="${loopY - 6}" text-anchor="middle" font-size="11" fill="currentColor">${leakLabel}</text>`;

  return `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="100%" role="img" aria-label="Employee loop">
      ${DEFS}
      ${box(xRep, "Reputation", fmt(state.stocks.reputation))}
      ${arrow(xRep + BOX_W, xMorale, pride, true)}
      ${box(xMorale, "Morale", fmt(state.stocks.morale))}
      ${arrow(xMorale + BOX_W, xEmp, `quit ${quit}`, true)}
      ${box(xEmp, "Employees", headcount)}
      ${leak}
    </svg>`;
}
