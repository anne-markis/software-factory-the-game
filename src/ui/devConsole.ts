import type { Engine } from "../engine/engine";
import type { GameState } from "../engine/types";
import { unshippedWork, workLedgerIssues } from "../engine/work";

export type StoryPointStage = "ready" | "inProgress" | "done";

const STAGE_STOCK: Record<StoryPointStage, "backlog" | "inProgress" | "done"> = {
  ready: "backlog",
  inProgress: "inProgress",
  done: "done",
};

export const DEV_CONSOLE_HELP = `Software Factory cheats (this tab’s console)

  sf.help()
  sf.era()                       // current era id (studio / company / megacorp)
  sf.budget()                    // current $
  sf.budget(50000)               // set $
  sf.points()                    // unshipped story points (cockpit Backlog)
  sf.points(40)                  // set oldest contract + Ready queue to 40
  sf.points(40, "inProgress")    // same, but park them in In Progress (WIP bubble)
  sf.points(40, "done")          // park them in Done
  sf.peek()                      // era + stocks + in-flight remaining

Story-point cheats keep the work ledger in sync (Ready/IP/Done + project remaining).`;

function requireAmount(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite number >= 0 (got ${String(value)})`);
  }
}

function live(engine: Engine): GameState {
  // Same mutable escape hatch tests use: getState() is a live reference;
  // Readonly is compile-time only. Cheats write then re-render + save.
  return engine.getState() as GameState;
}

/** Set budget. Clamped at 0 like every other stock write. */
export function setBudget(state: GameState, value: number): void {
  requireAmount(value, "budget");
  state.stocks.budget = value;
}

/**
 * Set unshipped story points. Oldest in-flight remaining becomes `value`;
 * later contracts keep their remaining and sit in the same stage so FIFO
 * still adds up. No in-flight project → leftover pipeline only.
 */
export function setStoryPoints(state: GameState, value: number, stage: StoryPointStage = "ready"): void {
  requireAmount(value, "story points");
  if (!(stage in STAGE_STOCK)) {
    throw new Error(`stage must be ready, inProgress, or done (got ${String(stage)})`);
  }
  const others = state.projects.slice(1).reduce((sum, p) => sum + p.remaining, 0);
  if (state.projects[0]) state.projects[0].remaining = value;
  const total = value + others;
  state.stocks.backlog = 0;
  state.stocks.inProgress = 0;
  state.stocks.done = 0;
  state.stocks[STAGE_STOCK[stage]] = total;
  const issues = workLedgerIssues(state);
  if (issues.length > 0) throw new Error(`story-point cheat left a broken ledger: ${issues.join("; ")}`);
}

export interface CheatPeek {
  day: number;
  era: string;
  budget: number;
  unshipped: number;
  ready: number;
  inProgress: number;
  done: number;
  shipped: number;
  users: number;
  remaining: { name: string; points: number }[];
}

export function peekCheats(state: Pick<GameState, "day" | "eraId" | "stocks" | "projects">): CheatPeek {
  return {
    day: state.day,
    era: state.eraId,
    budget: state.stocks.budget,
    unshipped: unshippedWork(state),
    ready: state.stocks.backlog,
    inProgress: state.stocks.inProgress,
    done: state.stocks.done,
    shipped: state.stocks.shipped,
    users: state.stocks.users,
    remaining: state.projects.map((p) => ({ name: p.name, points: p.remaining })),
  };
}

export interface DevCheats {
  help(): string;
  era(): string;
  budget(value?: number): number;
  points(value?: number, stage?: StoryPointStage): number;
  peek(): CheatPeek;
}

export interface DevConsoleHost {
  engine: Engine;
  render(): void;
  save(): void;
}

declare global {
  interface Window {
    sf?: DevCheats;
  }
}

/**
 * Hang `sf` on `window` for the browser DevTools console. Returns an
 * uninstall function (Vite HMR dispose).
 */
export function installDevConsole(host: DevConsoleHost): () => void {
  const commit = (): void => {
    host.render();
    host.save();
  };

  const api: DevCheats = {
    help() {
      console.info(DEV_CONSOLE_HELP);
      return DEV_CONSOLE_HELP;
    },
    era() {
      return live(host.engine).eraId;
    },
    budget(value?: number) {
      const state = live(host.engine);
      if (value !== undefined) {
        setBudget(state, value);
        commit();
        console.info(`sf.budget → $${state.stocks.budget}`);
      }
      return state.stocks.budget;
    },
    points(value?: number, stage: StoryPointStage = "ready") {
      const state = live(host.engine);
      if (value !== undefined) {
        setStoryPoints(state, value, stage);
        commit();
        console.info(`sf.points → ${unshippedWork(state)} unshipped (${stage})`);
      }
      return unshippedWork(state);
    },
    peek() {
      const snap = peekCheats(live(host.engine));
      console.info(snap);
      return snap;
    },
  };

  window.sf = api;
  console.info("Software Factory cheats ready — type sf.help() in this console.");

  return () => {
    if (window.sf === api) delete window.sf;
  };
}
