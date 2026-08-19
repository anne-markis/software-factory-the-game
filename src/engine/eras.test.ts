import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { loadShippedContent, shippedEras } from "./loadShippedContent";
import {
  eraEntryPredicateMet,
  evaluateNextEraEntry,
  formatEraEntryPredicate,
  nextEraDef,
} from "./eras";
import type { GameState } from "./types";

const COMPANY_BUDGET = 1_000_000;
const MEGACORP_BUDGET = 5_000_000;
/** Floors are checked after the day's $20 base burn. */
const COMPANY_CLEAR = COMPANY_BUDGET + 20;
const MEGACORP_CLEAR = MEGACORP_BUDGET + 40;

function stateAt(eraId: string, stocks: Partial<GameState["stocks"]> = {}): GameState {
  const e = new Engine(loadShippedContent(eraId));
  const s = e.getState() as GameState;
  Object.assign(s.stocks, stocks);
  return s;
}

describe("era entry predicates", () => {
  it("requires every listed floor on a path (AND)", () => {
    const s = stateAt("studio", { budget: COMPANY_BUDGET, users: 10 });
    expect(eraEntryPredicateMet(s, { minBudget: COMPANY_BUDGET })).toBe(true);
    expect(eraEntryPredicateMet(s, { minBudget: COMPANY_BUDGET, minUsers: 80 })).toBe(false);
    expect(eraEntryPredicateMet(s, { minUsers: 80 })).toBe(false);
  });

  it("formats a path for the event log and next-goal copy", () => {
    expect(formatEraEntryPredicate({ minBudget: COMPANY_BUDGET })).toBe("$1,000,000 budget");
    expect(formatEraEntryPredicate({ minUsers: 10000 })).toBe("10,000 users");
  });
});

describe("evaluateNextEraEntry", () => {
  const eras = shippedEras();

  it("returns Company when the $1M budget floor is met", () => {
    const hit = evaluateNextEraEntry(stateAt("studio", { budget: COMPANY_BUDGET }), eras);
    expect(hit?.era.id).toBe("company");
    expect(hit?.path).toEqual({ minBudget: COMPANY_BUDGET });
    expect(hit?.era.silentEntry).toBe(true);
  });

  it("does not treat the old 80-user path as Company entry", () => {
    expect(evaluateNextEraEntry(stateAt("studio", { users: 80 }), eras)).toBeNull();
  });

  it("does not skip a rung even if a later era's floors are also met", () => {
    const s = stateAt("studio", { budget: MEGACORP_BUDGET, users: 10000 });
    expect(evaluateNextEraEntry(s, eras)?.era.id).toBe("company");
  });

  it("returns null when still below every path", () => {
    expect(evaluateNextEraEntry(stateAt("studio", { budget: 10_000, users: 30 }), eras)).toBeNull();
  });

  it("walks Company → Megacorp on budget or users", () => {
    const byBudget = evaluateNextEraEntry(stateAt("company", { budget: MEGACORP_BUDGET }), eras);
    expect(byBudget?.era.id).toBe("megacorp");
    const byUsers = evaluateNextEraEntry(stateAt("company", { users: 10000 }), eras);
    expect(byUsers?.era.id).toBe("megacorp");
    expect(nextEraDef(eras, "megacorp")).toBeUndefined();
  });
});

describe("Engine era advancement", () => {
  it("stays in Studio when no loader is provided, even if floors are met", () => {
    const e = new Engine(loadShippedContent());
    (e.getState() as GameState).stocks.budget = COMPANY_CLEAR;
    e.tick();
    expect(e.getState().eraId).toBe("studio");
    expect(e.getContent().eraId).toBe("studio");
  });

  it("advances to Company without an Events log line", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    (e.getState() as GameState).stocks.budget = COMPANY_CLEAR;
    e.tick();
    expect(e.getState().eraId).toBe("company");
    expect(e.getContent().eraId).toBe("company");
    expect(e.getContent().decisions.length).toBeGreaterThan(0);
    expect(e.getState().log.some((l) => /entered company/i.test(l.message))).toBe(false);
  });

  it("does not enter when burn drops the treasury through the floor", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    (e.getState() as GameState).stocks.budget = COMPANY_BUDGET;
    e.tick();
    expect(e.getState().eraId).toBe("studio");
    expect(e.getState().stocks.budget).toBeLessThan(COMPANY_BUDGET);
  });

  it("does not jump Studio → Megacorp in one tick", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    (e.getState() as GameState).stocks.budget = MEGACORP_CLEAR;
    e.tick();
    expect(e.getState().eraId).toBe("company");
    e.tick();
    expect(e.getState().eraId).toBe("megacorp");
    expect(e.getState().log.some((l) => l.message.includes("Entered Megacorp"))).toBe(true);
  });

  it("keeps owned Studio monetization paying after Company entry", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    const s = e.getState() as GameState;
    s.completedProjects = 1;
    s.stocks.users = 80;
    e.applyDecision("subscription");
    s.stocks.budget = COMPANY_CLEAR;
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
