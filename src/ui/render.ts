import type { GameState } from "../engine/types";

export function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function renderStats(state: Readonly<GameState>): string {
  return `
    <div class="stats">
      <span>Day ${state.day}</span>
      <span>Backlog: ${fmt(state.stocks.backlog)}</span>
      <span>In Progress: ${fmt(state.stocks.inProgress)}</span>
      <span>Done: ${fmt(state.stocks.done)}</span>
      <span>Shipped: ${fmt(state.stocks.shipped)}</span>
      <span>Budget: $${fmt(state.stocks.budget)}</span>
      <span>Tech Debt: ${fmt(state.stocks.techDebt)}</span>
      <span>Points/Day: ${fmt(state.pointsPerDay)}</span>
    </div>`;
}
