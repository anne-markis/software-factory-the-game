import { describe, it, expect } from "vitest";
import { parseStartConfig, parseDecisions } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import { Engine } from "../engine/engine";
import type { GameContent } from "../engine/types";
import { budgetRunwayDays, netRecurringBurnPerDay, RUNWAY_WARN_DAYS } from "./runway";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("netRecurringBurnPerDay", () => {
  it("is base burn alone on a fresh game", () => {
    const e = new Engine(content());
    expect(netRecurringBurnPerDay(e.getState(), content())).toBe(20);
  });

  it("adds owned perDay upkeep and subtracts incomePerDay", () => {
    const c = content();
    const e = new Engine(c);
    e.applyDecision("basic-dev"); // perDay 7
    e.applyDecision("support-retainer"); // incomePerDay 8
    // 20 base + 7 payroll - 8 income
    expect(netRecurringBurnPerDay(e.getState(), c)).toBe(19);
  });
});

describe("budgetRunwayDays", () => {
  it("returns floor(budget / burn) while burning", () => {
    const c = content();
    const e = new Engine(c);
    const state = e.getState();
    state.stocks.budget = 250;
    // burn 20 → 12 days
    expect(budgetRunwayDays(state, c)).toBe(12);
    expect(12).toBeLessThanOrEqual(RUNWAY_WARN_DAYS);
  });

  it("returns null when net burn is not positive", () => {
    const c = content();
    c.start.baseBurnPerDay = 0;
    const e = new Engine(c);
    e.applyDecision("support-retainer"); // income 8, no payroll
    expect(netRecurringBurnPerDay(e.getState(), c)).toBe(-8);
    expect(budgetRunwayDays(e.getState(), c)).toBeNull();
  });

  it("fresh start budget is well above the warn threshold", () => {
    const c = content();
    const e = new Engine(c);
    const days = budgetRunwayDays(e.getState(), c);
    expect(days).toBe(500); // 10000 / 20
    expect(days!).toBeGreaterThan(RUNWAY_WARN_DAYS);
  });
});
