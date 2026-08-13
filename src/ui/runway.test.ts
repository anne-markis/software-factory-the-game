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
    // The lean Studio shop has no flat-incomePerDay card left (issue #89 cut
    // support-retainer; subscription scales with users instead), so the flat
    // branch is pinned against a fixture card bolted onto shipped content.
    c.decisions = [
      ...c.decisions,
      {
        id: "retainer",
        name: "Support retainer",
        description: "r",
        category: "earn-income",
        cost: {},
        incomePerDay: 8,
        effects: [],
        removable: true,
        unique: true,
      },
    ];
    const e = new Engine(c);
    e.applyDecision("basic-dev"); // perDay 7
    e.applyDecision("retainer"); // incomePerDay 8
    // 20 base + 7 payroll - 8 income
    expect(netRecurringBurnPerDay(e.getState(), c)).toBe(19);
  });

  // Studio spine (issue #88): subscription income scales with the users stock,
  // so runway reflects the user-driven recurring revenue at the current level.
  it("subtracts subscription incomeFromStock at the current users level", () => {
    const c = content();
    const e = new Engine(c);
    e.applyDecision("subscription"); // incomeFromStock users * 0.75
    const s = e.getState() as import("../engine/types").GameState;
    s.stocks.users = 0;
    expect(netRecurringBurnPerDay(e.getState(), c)).toBe(20); // 0 users -> no income yet
    s.stocks.users = 100;
    // 20 base burn - (100 users * 0.75) = 20 - 75 = -55 (net income)
    expect(netRecurringBurnPerDay(e.getState(), c)).toBe(-55);
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
    e.applyDecision("subscription"); // recurring income, no payroll
    const s = e.getState() as import("../engine/types").GameState;
    s.stocks.users = 40; // 40 users x $0.75 = $30/day
    expect(netRecurringBurnPerDay(e.getState(), c)).toBe(-30);
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
