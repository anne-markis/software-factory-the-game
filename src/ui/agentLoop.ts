import type { GameContent, GameState } from "../engine/types";
import { instanceIsActive } from "../engine/roster";

const BOX_W = 150;
const BOX_H = 60;
const GAP = 60;
const Y = 30;
const VIEW_W = 860;
const VIEW_H = 160;

const DEFS = `<defs><marker id="agent-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`;

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
      <line x1="${x1}" y1="${mid}" x2="${x2 - 8}" y2="${mid}" stroke="currentColor" marker-end="url(#agent-arrow)"${dash}/>
      <text x="${(x1 + x2) / 2}" y="${mid - 8}" text-anchor="middle" font-size="11" fill="currentColor">${label}</text>`;
}

function humanCounts(state: Readonly<GameState>): { active: number; joining: number } {
  let active = 1;
  let joining = 0;
  for (const inst of state.decisions) {
    if (!inst.human) continue;
    if (instanceIsActive(inst, state.day)) active += 1;
    else joining += 1;
  }
  return { active, joining };
}

function agentCount(state: Readonly<GameState>): number {
  let n = 0;
  for (const inst of state.decisions) {
    if (inst.agent && instanceIsActive(inst, state.day)) n += 1;
  }
  return n;
}

export function agentLoopSvg(state: Readonly<GameState>, _content: GameContent): string {
  const contentWidth = 3 * BOX_W + 2 * GAP;
  const x0 = (VIEW_W - contentWidth) / 2;
  const xHumans = x0;
  const xOver = x0 + BOX_W + GAP;
  const xAgents = x0 + 2 * (BOX_W + GAP);

  const watch = `${state.oversightWatch.toFixed(1)}/day`;
  const off = state.oversightOffPolicy;
  const policy = off <= 0.02 ? "in policy" : `off policy ${(off * 100).toFixed(0)}%`;
  const { active, joining } = humanCounts(state);
  const humans = joining > 0 ? `${active} (+${joining} join)` : String(active);

  const loopY = Y + BOX_H + 40;
  const left = xOver + BOX_W * 0.28;
  const right = xOver + BOX_W * 0.72;
  const leak = state.oversightLeak;
  const leakLabel = leak > 0 ? `fleet −${leak.toFixed(1)}/day` : "fleet 0/day";
  const leakPath = `
    <path d="M ${right} ${Y + BOX_H} V ${loopY} H ${left} V ${Y + BOX_H + 8}" fill="none" stroke="currentColor" stroke-dasharray="4 3" marker-end="url(#agent-arrow)"/>
    <text x="${xOver + BOX_W / 2}" y="${loopY - 6}" text-anchor="middle" font-size="11" fill="currentColor">${leakLabel}</text>`;

  return `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="100%" role="img" aria-label="Agent loop">
      ${DEFS}
      ${box(xHumans, "Humans", humans)}
      ${arrow(xHumans + BOX_W, xOver, watch, true)}
      ${box(xOver, "Oversight", state.stocks.oversight.toFixed(0))}
      ${arrow(xOver + BOX_W, xAgents, policy, true)}
      ${box(xAgents, "Agents", String(agentCount(state)))}
      ${leakPath}
    </svg>`;
}
