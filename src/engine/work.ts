import { hashRoll } from "./rng";
import { PIPELINE_STOCKS, type GameState, type PipelineStock, type StockName } from "./types";

// Single work ledger (ADR 0009). Pipeline stage stocks say *where* unshipped
// work sits; ActiveProject.remaining says *which contract* that work is for.
// Extra inflow (tech-debt refill, scope-creep, any addToStock/scaleStock on a
// pipeline stock) must update remaining when a project is in flight, otherwise
// anonymous bag-points get FIFO-credited as contract progress. With several
// contracts live, that attach hits one remaining (engine-picked), not all.

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

/** Pipeline work not committed to any in-flight remaining (leftover rework). */
export function surplusWork(state: Pick<GameState, "stocks" | "projects">): number {
  return Math.max(0, unshippedWork(state) - committedWork(state));
}

/**
 * Engine-side counting faults. Empty means the ledger is internally consistent.
 * UI surfaces are checked separately (they used to show Ready-stage stock as
 * cockpit Backlog while remaining still sat in later stages).
 */
export function workLedgerIssues(state: Pick<GameState, "stocks" | "projects">): string[] {
  const issues: string[] = [];
  const { backlog, inProgress, done } = state.stocks;
  for (const [name, v] of [
    ["backlog", backlog],
    ["inProgress", inProgress],
    ["done", done],
  ] as const) {
    if (!Number.isFinite(v) || v < -1e-9) issues.push(`${name} is ${v}`);
  }
  for (const p of state.projects) {
    if (!Number.isFinite(p.remaining) || p.remaining < -1e-9) {
      issues.push(`${p.name} remaining is ${p.remaining}`);
    }
  }
  const unshipped = unshippedWork(state);
  const committed = committedWork(state);
  if (committed > unshipped + 1e-6) {
    issues.push(`committed ${committed} exceeds unshipped ${unshipped}`);
  }
  return issues;
}

/**
 * While a contract is in flight, extra pipeline inflow must attach to remaining
 * (surplus stays flat or falls as leftover ships). A rising surplus is the
 * old dual-ledger bug: bag grew, countdown did not.
 */
export function surplusGrewWhileInFlight(
  prev: Pick<GameState, "stocks" | "projects" | "completedProjects">,
  next: Pick<GameState, "stocks" | "projects" | "completedProjects">,
): boolean {
  // Completion tick: the contract left, debt refill may land as leftover, and
  // a follow-on start can pick that leftover up as surplus. That is not the
  // dual-ledger bug (bag grew while the same remaining countdown did not).
  if (next.completedProjects > prev.completedProjects) return false;
  if (prev.projects.length === 0 || next.projects.length === 0) return false;
  return surplusWork(next) > surplusWork(prev) + 1e-6;
}

/**
 * Attach newly injected (or removed) pipeline work to one in-flight remaining.
 * With several contracts live, the pick is arbitrary and deterministic: a
 * hashRoll on (gameSeed, day, committed work, delta) — not the purchase RNG
 * stream, so challenge fire (which must not call rng.next) stays valid. A
 * single in-flight remaining skips the roll so solo-contract tests stay bit-
 * identical. No-ops when nothing is in flight: leftover sits as unattributed
 * surplus and ships first without completing a later contract (see tick.ts).
 * `delta` is the actual clamped stock change, not the requested effect value.
 */
export function attachInjectedWork(state: GameState, delta: number): void {
  const n = state.projects.length;
  if (delta === 0 || n === 0) return;
  const p =
    n === 1
      ? state.projects[0]!
      : state.projects[
          Math.floor(hashRoll(state.gameSeed, state.day, `inject:${committedWork(state)}:${delta}`) * n)
        ]!;
  p.remaining = Math.max(0, p.remaining + delta);
}

/** Remove `amount` from Ready, then In Progress, then Done. */
export function drainUnshippedWork(state: GameState, amount: number): void {
  let left = Math.max(0, amount);
  for (const stock of PIPELINE_STOCKS) {
    if (left <= 1e-12) break;
    const take = Math.min(left, state.stocks[stock]);
    state.stocks[stock] -= take;
    left -= take;
  }
}
