import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { loadShippedContent } from "./loadShippedContent";
import {
  eraEntryPredicateMet,
  evaluateNextEraEntry,
  formatEraEntryPredicate,
  nextEraDef,
} from "./eras";
import { shippedEras } from "./loadShippedContent";
import type { GameState } from "./types";

function stateAt(eraId: string, stocks: Partial<GameState["stocks"]> = {}): GameState {
  const e = new Engine(loadShippedContent(eraId));
  const s = e.getState() as GameState;
  Object.assign(s.stocks, stocks);
  return s;
}

describe("era entry predicates", () => {
  it("requires every listed floor on a path (AND)", () => {
    const s = stateAt("studio", { budget: 25000, users: 10 });
    expect(eraEntryPredicateMet(s, { minBudget: 25000 })).toBe(true);
    expect(eraEntryPredicateMet(s, { minBudget: 25000, minUsers: 80 })).toBe(false);
    expect(eraEntryPredicateMet(s, { minUsers: 80 })).toBe(false);
  });

  it("formats a path for the event log and next-goal copy", () => {
    expect(formatEraEntryPredicate({ minBudget: 25000 })).toBe("$25,000 budget");
    expect(formatEraEntryPredicate({ minUsers: 80 })).toBe("80 users");
  });
});

describe("evaluateNextEraEntry", () => {
  const eras = shippedEras();

  it("returns the next catalog rung when any OR path is met", () => {
    const byBudget = evaluateNextEraEntry(stateAt("studio", { budget: 25000 }), eras);
    expect(byBudget?.era.id).toBe("company");
    expect(byBudget?.path).toEqual({ minBudget: 25000 });

    const byUsers = evaluateNextEraEntry(stateAt("studio", { users: 80 }), eras);
    expect(byUsers?.era.id).toBe("company");
    expect(byUsers?.path).toEqual({ minUsers: 80 });
  });

  it("does not skip a rung even if a later era's floors are also met", () => {
    const s = stateAt("studio", { budget: 250000, users: 10000 });
    expect(evaluateNextEraEntry(s, eras)?.era.id).toBe("company");
  });

  it("returns null when still below every path", () => {
    expect(evaluateNextEraEntry(stateAt("studio", { budget: 10000, users: 30 }), eras)).toBeNull();
  });

  it("walks Company → Megacorp on the same predicate shape", () => {
    const hit = evaluateNextEraEntry(stateAt("company", { budget: 250000 }), eras);
    expect(hit?.era.id).toBe("megacorp");
    expect(nextEraDef(eras, "megacorp")).toBeUndefined();
  });
});

describe("Engine era advancement", () => {
  it("stays in Studio when no loader is provided, even if floors are met", () => {
    const e = new Engine(loadShippedContent());
    (e.getState() as GameState).stocks.budget = 25000;
    e.tick();
    expect(e.getState().eraId).toBe("studio");
    expect(e.getContent().eraId).toBe("studio");
  });

  it("advances one rung and reloads the bundle when a loader is provided", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    // Floors are checked after the day's burn (base $20), so the treasury
    // must still clear $25k at end of day — not only at the start of tick.
    (e.getState() as GameState).stocks.budget = 25020;
    e.tick();
    expect(e.getState().eraId).toBe("company");
    expect(e.getContent().eraId).toBe("company");
    expect(e.getContent().decisions.length).toBeGreaterThan(0);
    expect(e.getState().log.some((l) => l.message.includes("Entered Company"))).toBe(true);
  });

  it("does not enter when burn drops the treasury through the floor", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    (e.getState() as GameState).stocks.budget = 25000;
    e.tick();
    expect(e.getState().eraId).toBe("studio");
    expect(e.getState().stocks.budget).toBeLessThan(25000);
  });

  it("does not jump Studio → Megacorp in one tick", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    (e.getState() as GameState).stocks.budget = 250040;
    e.tick();
    expect(e.getState().eraId).toBe("company");
    e.tick();
    expect(e.getState().eraId).toBe("megacorp");
  });

  it("keeps owned Studio monetization paying after Company entry", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    const s = e.getState() as GameState;
    s.completedProjects = 1;
    s.stocks.users = 80;
    s.stocks.budget = 5000;
    e.applyDecision("subscription");
    e.tick();
    expect(e.getState().eraId).toBe("company");
    expect(e.getContent().eraId).toBe("company");
    expect(e.getState().decisions.some((d) => d.defId === "subscription")).toBe(true);
    expect(e.getState().userIncomeFlow).toBeGreaterThan(0);
    e.tick();
    expect(e.getState().eraId).toBe("company");
    expect(e.getState().userIncomeFlow).toBeGreaterThan(0);
  });
});
