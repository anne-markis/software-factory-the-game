import type { GameState, RateId } from "../engine/types";
import { effectiveRate, effectiveDebtMultiplier } from "../engine/modifiers";

const STAGES: { key: "backlog" | "inProgress" | "done" | "shipped"; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "inProgress", label: "In Progress" },
  { key: "done", label: "Done" },
  { key: "shipped", label: "Shipped" },
];
const RATES: RateId[] = ["pull", "finish", "deploy"];

export function loopDiagramSvg(state: Readonly<GameState>): string {
  const boxW = 150;
  const boxH = 60;
  const gap = 60;
  const y = 30;
  const boxes = STAGES.map((stage, i) => {
    const x = 10 + i * (boxW + gap);
    const value = state.stocks[stage.key].toLocaleString("en-US", { maximumFractionDigits: 1 });
    return `
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" fill="none" stroke="currentColor"/>
      <text x="${x + boxW / 2}" y="${y + 24}" text-anchor="middle" font-size="13">${stage.label}</text>
      <text x="${x + boxW / 2}" y="${y + 46}" text-anchor="middle" font-size="15" font-weight="bold">${value}</text>`;
  }).join("");

  const arrows = RATES.map((rate, i) => {
    const x1 = 10 + boxW + i * (boxW + gap);
    const x2 = x1 + gap;
    const mid = y + boxH / 2;
    const value = effectiveRate(state, rate).toFixed(1);
    return `
      <line x1="${x1}" y1="${mid}" x2="${x2 - 8}" y2="${mid}" stroke="currentColor" marker-end="url(#arrow)"/>
      <text x="${(x1 + x2) / 2}" y="${mid - 8}" text-anchor="middle" font-size="11">${value}/day</text>`;
  }).join("");

  // tech debt regeneration: shipped back to backlog underneath
  const debt = effectiveDebtMultiplier(state).toFixed(1);
  const startX = 10 + 3 * (boxW + gap) + boxW / 2;
  const endX = 10 + boxW / 2;
  const loopY = y + boxH + 40;
  const regen = `
    <path d="M ${startX} ${y + boxH} V ${loopY} H ${endX} V ${y + boxH + 8}" fill="none" stroke="currentColor" stroke-dasharray="4 3" marker-end="url(#arrow)"/>
    <text x="${(startX + endX) / 2}" y="${loopY - 6}" text-anchor="middle" font-size="11">debt +${debt}/pt</text>`;

  return `
    <svg viewBox="0 0 860 170" width="100%" role="img" aria-label="Delivery loop">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>
      ${boxes}${arrows}${regen}
    </svg>`;
}
