import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { parseStartConfig, parseProjects } from "./content";
import { projectsJson, startJson } from "./loadShippedContent";
import { effectiveRate, contextSwitchTax } from "./modifiers";
import { applyEffects } from "./effects";
import type { GameContent, GameState, ProjectDef } from "./types";

function content(overrides: Partial<GameContent["start"]["stocks"]> = {}): GameContent {
  const start = parseStartConfig(startJson);
  Object.assign(start.stocks, overrides);
  return { start, decisions: [], challenges: [], projects: parseProjects(projectsJson) };
}

function shrinkStart(c: GameContent, size = 2): void {
  c.start.initialProject.sizePoints = size;
  c.start.stocks.backlog = size;
}

describe("projects", () => {
  it("startProject charges upfront cost and adds points to backlog", () => {
    const e = new Engine(content());
    e.startProject("gig-plugin");
    const s = e.getState();
    expect(s.stocks.budget).toBe(10000); // Studio gigs are $0 upfront
    expect(s.stocks.backlog).toBe(750); // Studio start backlog 300 + plugin 450
    expect(s.projects).toHaveLength(2);
  });

  it("applies the context-switch tax with multiple projects in flight", () => {
    const e = new Engine(content());
    expect(contextSwitchTax(e.getState())).toBe(1);
    e.startProject("gig-bugfix");
    expect(contextSwitchTax(e.getState())).toBeCloseTo(0.85);
    expect(effectiveRate(e.getState(), "pull")).toBeCloseTo(1.7); // base pull 2 x 0.85
    expect(effectiveRate(e.getState(), "finish")).toBeCloseTo(0.85); // base finish 1 x 0.85
  });

  it("gates versions on the prior completed id and paid work on budget", () => {
    const e = new Engine(content());
    expect(() => e.startProject("ship-v1")).toThrow(/requires completed Launch beta/);
    const paid: ProjectDef = {
      id: "paid-gig",
      name: "Paid gig",
      sizePoints: 10,
      upfrontCost: 500,
      payoutPerPoint: 1,
      completionBonus: 0,
      reputationReward: 0,
    };
    const poor = new Engine({ ...content({ budget: 100 }), projects: [paid] });
    expect(() => poor.startProject("paid-gig")).toThrow(/afford/);
  });

  it("FIFO attribution completes the oldest project first and pays its bonus", () => {
    const c = content();
    shrinkStart(c);
    const e = new Engine(c);
    e.startProject("gig-plugin"); // backlog now 2 + 450
    // run until the first 2 shipped points complete the initial project
    for (let i = 0; i < 12; i++) e.tick();
    const s = e.getState();
    expect(s.completedProjects).toBe(1);
    expect(s.completedProjectIds).toEqual(["launch-beta"]);
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0].defId).toBe("gig-plugin");
    expect(s.log.some((l) => l.message.includes("Project complete: Launch beta"))).toBe(true);
  });

  it("rejects starting a project already in flight", () => {
    const e = new Engine(content());
    e.startProject("gig-bugfix");
    expect(() => e.startProject("gig-bugfix")).toThrow(/already in flight/);
  });

  it("allows restarting a repeatable gig after completion", () => {
    const c = content();
    shrinkStart(c);
    const e = new Engine(c);
    for (let i = 0; i < 6; i++) e.tick(); // complete the tiny initial project
    expect(e.getState().completedProjects).toBe(1);
    e.startProject("gig-bugfix");
    e.getState().projects.forEach((p) => expect(p.defId).toBe("gig-bugfix"));
  });

  // Small refactor burns techDebt via completionStockGrants (−50),
  // pays nothing, and stays repeatable (not unique).
  it("Small refactor reduces techDebt by 50 clamped at 0, without budget or reputation, and is repeatable", () => {
    const c = content();
    shrinkStart(c);
    const refactor = c.projects.find((p) => p.id === "small-refactor")!;
    refactor.sizePoints = 2;
    const e = new Engine(c);
    for (let i = 0; i < 6; i++) e.tick(); // complete Launch beta
    expect(e.getState().completedProjects).toBe(1);

    const s = e.getState() as GameState;
    s.stocks.techDebt = 20;
    s.debtMultiplierBase = 0; // isolate grant from tick debt accrual
    const budgetBefore = s.stocks.budget;
    const repBefore = s.stocks.reputation;
    const dayBefore = s.day;

    e.startProject("small-refactor");
    for (let i = 0; i < 20 && e.getState().completedProjects < 2; i++) e.tick();
    expect(e.getState().completedProjects).toBe(2);
    expect(e.getState().completedProjectIds).toContain("small-refactor");
    // 20 + (−50) clamps at 0, not −30.
    expect(e.getState().stocks.techDebt).toBe(0);
    // No payoutPerPoint / completionBonus / reputationReward — only daily burn.
    const days = e.getState().day - dayBefore;
    expect(e.getState().stocks.budget).toBeCloseTo(budgetBefore - 20 * days, 5);
    expect(e.getState().stocks.reputation).toBe(repBefore);

    // Repeatable: startable again after completion (not unique).
    expect(e.availableProjects().find((p) => p.def.id === "small-refactor")!.startable).toBe(true);
    e.startProject("small-refactor");
    expect(e.getState().projects.some((p) => p.defId === "small-refactor")).toBe(true);
  });

  it("unlocks Ship v1 after Launch beta and keeps v2 locked until v1 completes", () => {
    const c = content();
    shrinkStart(c);
    const v1 = c.projects.find((p) => p.id === "ship-v1")!;
    v1.sizePoints = 2;
    const e = new Engine(c);
    expect(e.availableProjects().find((p) => p.def.id === "ship-v1")!.startable).toBe(false);
    for (let i = 0; i < 6; i++) e.tick();
    expect(e.getState().completedProjectIds).toEqual(["launch-beta"]);
    expect(e.availableProjects().find((p) => p.def.id === "ship-v1")!.startable).toBe(true);
    expect(e.availableProjects().find((p) => p.def.id === "ship-v2")!.startable).toBe(false);
    e.startProject("ship-v1");
    (e.getState() as GameState).debtMultiplierBase = 0; // isolate the ladder from debt refill
    for (let i = 0; i < 20 && e.getState().completedProjects < 2; i++) e.tick();
    expect(e.getState().completedProjectIds).toEqual(["launch-beta", "ship-v1"]);
    expect(e.availableProjects().find((p) => p.def.id === "ship-v2")!.startable).toBe(true);
    expect(e.availableProjects().find((p) => p.def.id === "ship-v1")!.reason).toBe("already completed");
    expect(() => e.startProject("ship-v1")).toThrow(/already completed/);
  });

  // Release 17: requiresReputation gates a tier ON TOP OF requiresCompleted
  // and affordability. Company owns the shipped gated tiers (big-migration),
  // so this uses an inline fixture rather than that catalog.
  it("gates a project on requiresReputation: locked below threshold, startable at threshold, re-locked after a reputation loss", () => {
    const fixture: ProjectDef = {
      id: "rep-gated",
      name: "Reputation Gated Contract",
      sizePoints: 1000,
      upfrontCost: 100,
      payoutPerPoint: 10,
      completionBonus: 500,
      reputationReward: 3,
      requiresReputation: 5,
    };
    const c: GameContent = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [fixture] };
    const e = new Engine(c);

    // Not startable at baseline reputation (shipped start.json: 0).
    expect(e.getState().stocks.reputation).toBe(0);
    let entry = e.availableProjects().find((p) => p.def.id === "rep-gated")!;
    expect(entry.startable).toBe(false);
    expect(entry.reason).toBe("requires 5 reputation");
    expect(() => e.startProject("rep-gated")).toThrow(/requires 5 reputation/);

    // Startable once reputation reaches the threshold.
    const s = e.getState() as GameState;
    s.stocks.reputation = 5;
    entry = e.availableProjects().find((p) => p.def.id === "rep-gated")!;
    expect(entry.startable).toBe(true);

    // Re-locked after a reputation loss (applyEffects' addToStock, the same
    // mechanism incident-class challenges use) drops it back below the
    // threshold -- live recompute, no extra mechanism (see
    // projectAvailability). Uses a fresh engine so "already in flight" from
    // starting rep-gated above cannot mask the reputation reason.
    const c2: GameContent = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [fixture] };
    const e2 = new Engine(c2);
    const s2 = e2.getState() as GameState;
    s2.stocks.reputation = 5;
    applyEffects(s2, [{ type: "addToStock", stock: "reputation", value: -5 }], "test");
    expect(e2.getState().stocks.reputation).toBe(0);
    entry = e2.availableProjects().find((p) => p.def.id === "rep-gated")!;
    expect(entry.startable).toBe(false);
    expect(entry.reason).toBe("requires 5 reputation");
  });

  it("isStalled when pipeline is empty and nothing is affordable", () => {
    const empty = content({ backlog: 0, budget: 10 });
    empty.projects = [];
    const e = new Engine(empty);
    expect(e.isStalled()).toBe(true);
    const withGigs = new Engine(content({ backlog: 0, budget: 10 }));
    expect(withGigs.isStalled()).toBe(false); // $0 tiny gigs are the relief valve
  });
});
