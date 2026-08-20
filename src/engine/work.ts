import { PIPELINE_STOCKS, type GameState, type PipelineStock, type StockName } from "./types";

// Single work ledger (ADR 0009). Pipeline stage stocks say *where* unshipped
// work sits; ActiveProject.remaining says *which contract* that work is for.
// Extra inflow (tech-debt refill, scope-creep, any addToStock/scaleStock on a
// pipeline stock) must update remaining when a project is in flight, otherwise
// anonymous bag-points get FIFO-credited as contract progress.

export function isPipelineStock(stock: StockName): stock is PipelineStock {
  return (PIPELINE_STOCKS as readonly string[]).includes(stock);
}

/** Unshipped factory work: Ready + In Progress + Done. */
export function unshippedWork(state: Pick<GameState, "stocks">): number {
  return state.stocks.backlog + state.stocks.inProgress + state.stocks.done;
}

/** Contract points still owed across in-flight projects. */
export function committedWork(state: Pick<GameState, "projects">): number {
  return state.projects.reduce((sum, p) => sum + p.remaining, 0);
}

/**
 * Attach newly injected (or removed) pipeline work to the oldest in-flight
 * project. No-ops when nothing is in flight: leftover sits as unattributed
 * surplus and ships first without completing a later contract (see tick.ts).
 * `delta` is the actual clamped stock change, not the requested effect value.
 */
export function attachInjectedWork(state: GameState, delta: number): void {
  if (delta === 0 || state.projects.length === 0) return;
  const p = state.projects[0];
  p.remaining = Math.max(0, p.remaining + delta);
}
