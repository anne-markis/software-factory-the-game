import { describe, it, expect } from "vitest";
import { parseStartConfig, parseDecisions } from "../engine/content";
import { decisionsJson, startJson } from "../engine/loadShippedContent";
import { Engine } from "../engine/engine";
import type { GameContent, GameState } from "../engine/types";
import { activateDueInstances } from "../engine/tick";
import { budgetRunwayDays, netRecurringBurnPerDay, RUNWAY_WARN_DAYS } from "./runway";

function content(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: [],
    projects: [{ id: "ktlo", name: "Keep the lights on", permanent: true, basePerDay: 0.5, perDay: 20 }],
  };
}

describe("netRecurringBurnPerDay", () => {
  it("is KTLO cash alone on a fresh game", () => {
    const e = new Engine(content());
    expect(netRecurringBurnPerDay(e.getState(), content())).toBe(30);
  });

  it("adds owned perDay upkeep and subtracts incomePerDay", () => {
    const c = content();
    // The lean Studio shop has no flat-incomePerDay card left (cut support-retainer; subscription scales with users instead), so the flat
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
    e.applyDecision("basic-dev"); // perDay 438 after they start
    const s = e.getState() as GameState;
    for (const inst of s.decisions) {
      if (inst.activeOnDay !== undefined) inst.activeOnDay = s.day;
    }
    activateDueInstances(s, c);
    e.applyDecision("retainer"); // incomePerDay 8
    // 20 KTLO + 10 granted product + 35 hire surcharge + 438 payroll - 8 income
    expect(netRecurringBurnPerDay(e.getState(), c)).toBe(495);
    e.applyDecision("agent");
    // Founder + the active hire: the agent's $4/day is charged twice.
    expect(netRecurringBurnPerDay(e.getState(), c)).toBe(503);
  });

  // Studio spine: subscription income scales with the users stock,
  // so runway reflects the user-driven recurring revenue at the current level.
  it("subtracts subscription incomeFromStock at the current users level", () => {
    const c = content();
    const e = new Engine(c);
    e.applyDecision("subscription"); // incomeFromStock users * 0.75
    const s = e.getState() as import("../engine/types").GameState;
    s.stocks.users = 0;
    // 0 users -> no income yet. Base $20 + granted product $10 + plan $15.
    expect(netRecurringBurnPerDay(e.getState(), c)).toBe(45);
    s.stocks.users = 100;
    // 45 KTLO - (100 users * 0.75) = -30. This fixture has no hosting bands.
    expect(netRecurringBurnPerDay(e.getState(), c)).toBe(-30);
  });
});

describe("budgetRunwayDays", () => {
  it("returns floor(budget / burn) while burning", () => {
    const c = content();
    const e = new Engine(c);
    const state = e.getState();
    state.stocks.budget = 250;
    // burn 30 → 8 days
    expect(budgetRunwayDays(state, c)).toBe(8);
    expect(8).toBeLessThanOrEqual(RUNWAY_WARN_DAYS);
  });

  it("returns null when net burn is not positive", () => {
    const c = content();
    c.projects = [];
    const e = new Engine(c);
    e.applyDecision("subscription"); // recurring income, no payroll
    const s = e.getState() as import("../engine/types").GameState;
    s.stocks.users = 40; // $30/day income, minus plan $15 and granted product $10 (no base project)
    expect(netRecurringBurnPerDay(e.getState(), c)).toBe(-5);
    expect(budgetRunwayDays(e.getState(), c)).toBeNull();
  });

  it("fresh start budget is well above the warn threshold", () => {
    const c = content();
    const e = new Engine(c);
    const days = budgetRunwayDays(e.getState(), c);
    expect(days).toBe(833); // 25000 / 30
    expect(days!).toBeGreaterThan(RUNWAY_WARN_DAYS);
  });
});
