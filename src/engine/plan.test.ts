import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Engine } from "./engine";
import { parseStartConfig } from "./content";
import { startJson } from "./loadShippedContent";
import { applyEffects } from "./effects";
import { effectiveRate } from "./modifiers";
import { unshippedWork, workLedgerIssues } from "./work";
import type { GameContent, GameState, ProjectDef } from "./types";

function sized(overrides: Partial<ProjectDef> & Pick<ProjectDef, "id" | "name" | "sizePoints">): ProjectDef {
  return {
    upfrontCost: 0,
    payoutPerPoint: 0,
    completionBonus: 0,
    reputationReward: 0,
    ...overrides,
  };
}

function content(projects: ProjectDef[], stockOverrides: Partial<GameContent["start"]["stocks"]> = {}): GameContent {
  const start = parseStartConfig(startJson);
  Object.assign(start.stocks, stockOverrides);
  return { start, decisions: [], challenges: [], projects };
}

const LATE_400 = sized({ id: "late-400", name: "Ship-v1-sized", sizePoints: 400 });
const PEER_A = sized({ id: "plan-a", name: "Plan A", sizePoints: 10 });
const PEER_B = sized({ id: "plan-b", name: "Plan B", sizePoints: 10 });

describe("Pursue, Plan, Cancel, auto-Ready", () => {
  it("Pursue Ship-v1-sized work (400) with Ideas 400: Ideas 0, named Plan item 0/400", () => {
    const e = new Engine(content([LATE_400], { ideas: 400 }));
    const ideasBefore = e.getState().stocks.ideas;
    expect(ideasBefore).toBe(400);
    e.pursueProject("late-400");
    const s = e.getState();
    expect(s.stocks.ideas).toBe(0);
    expect(s.plan).toHaveLength(1);
    expect(s.plan[0]).toMatchObject({ defId: "late-400", name: "Ship-v1-sized", progress: 0, size: 400 });
    expect(s.stocks.plan).toBe(0);
    expect(s.projects.some((p) => p.defId === "late-400")).toBe(false);
    expect(s.stocks.backlog).toBe(300);
  });

  it("then +1 progress per day if it is the only Plan item", () => {
    const e = new Engine(content([LATE_400], { ideas: 400 }));
    e.pursueProject("late-400");
    (e.getState() as GameState).stocks.budget = 0; // freeze delivery so Ready does not move
    e.tick();
    const s = e.getState();
    expect(s.plan).toHaveLength(1);
    expect(s.plan[0]!.progress).toBeCloseTo(1, 10);
    expect(s.plan[0]!.size).toBe(400);
    expect(s.stocks.plan).toBeCloseTo(1, 10);
  });

  it("two Plan items: each gets 0.5/day", () => {
    const e = new Engine(content([PEER_A, PEER_B], { ideas: 400 }));
    e.pursueProject("plan-a");
    e.pursueProject("plan-b");
    (e.getState() as GameState).stocks.budget = 0;
    e.tick();
    const s = e.getState();
    expect(s.plan).toHaveLength(2);
    expect(s.plan[0]!.progress).toBeCloseTo(0.5, 10);
    expect(s.plan[1]!.progress).toBeCloseTo(0.5, 10);
    expect(s.stocks.plan).toBeCloseTo(1, 10);
  });

  it("when progress hits size, the item leaves Plan and appears as in-flight Ready work with remaining = size", () => {
    const tiny = sized({ id: "tiny-plan", name: "Tiny plan", sizePoints: 2, completionBonus: 50, reputationReward: 1 });
    const e = new Engine(content([tiny], { ideas: 2 }));
    const backlogBefore = e.getState().stocks.backlog;
    const ideasWallet = 17;
    e.pursueProject("tiny-plan");
    const s0 = e.getState() as GameState;
    s0.stocks.ideas = ideasWallet; // leftover Ideas stay in the wallet
    s0.stocks.budget = 0;
    e.tick();
    expect(e.getState().plan[0]!.progress).toBeCloseTo(1, 10);
    e.tick();
    const s = e.getState();
    expect(s.plan).toHaveLength(0);
    expect(s.plan.find((p) => p.defId === "tiny-plan")).toBeUndefined();
    expect(s.stocks.plan).toBe(0);
    const ready = s.projects.find((p) => p.defId === "tiny-plan");
    expect(ready).toBeDefined();
    expect(ready!.remaining).toBe(2);
    expect(ready!.name).toBe("Tiny plan");
    expect(ready!.completionBonus).toBe(50);
    expect(s.stocks.backlog).toBeCloseTo(backlogBefore + 2, 10);
    expect(s.stocks.ideas).toBeCloseTo(ideasWallet + 0.5 + 0.5, 10); // discover still fills
    expect(workLedgerIssues(s)).toEqual([]);
    expect(unshippedWork(s)).toBeCloseTo(backlogBefore + 2, 10);
  });

  it("Cancel: that item gone, progress not added to Ideas, other Plan items untouched", () => {
    const e = new Engine(content([PEER_A, PEER_B], { ideas: 400 }));
    e.pursueProject("plan-a");
    e.pursueProject("plan-b");
    const s0 = e.getState() as GameState;
    s0.stocks.budget = 0;
    s0.stocks.ideas = 40; // leftover wallet
    e.tick();
    e.tick();
    expect(e.getState().plan[0]!.progress).toBeCloseTo(1, 10);
    expect(e.getState().plan[1]!.progress).toBeCloseTo(1, 10);
    const ideasBeforeCancel = e.getState().stocks.ideas;
    const bBefore = e.getState().plan.find((p) => p.defId === "plan-b")!;
    e.cancelPlan("plan-a");
    const s = e.getState();
    expect(s.plan.map((p) => p.defId)).toEqual(["plan-b"]);
    expect(s.plan[0]!.progress).toBeCloseTo(bBefore.progress, 10);
    expect(s.stocks.ideas).toBe(ideasBeforeCancel);
    expect(s.stocks.plan).toBeCloseTo(bBefore.progress, 10);
    expect(s.projects.some((p) => p.defId === "plan-a")).toBe(false);
  });

  it("Start still writes Ready immediately and does not spend Ideas", () => {
    const gig = sized({
      id: "early-gig",
      name: "Early gig",
      sizePoints: 10,
      upfrontCost: 0,
      payoutPerPoint: 8,
      completionBonus: 20,
      reputationReward: 1,
    });
    const e = new Engine(content([gig], { ideas: 100 }));
    const backlogBefore = e.getState().stocks.backlog;
    e.startProject("early-gig");
    const s = e.getState();
    expect(s.stocks.ideas).toBe(100);
    expect(s.plan).toHaveLength(0);
    expect(s.stocks.plan).toBe(0);
    expect(s.stocks.backlog).toBe(backlogBefore + 10);
    expect(s.projects.some((p) => p.defId === "early-gig" && p.remaining === 10)).toBe(true);
  });

  it("Pursue with Ideas < size fails (no spend, no Plan row)", () => {
    const e = new Engine(content([LATE_400], { ideas: 399 }));
    const before = structuredClone(e.getState());
    expect(() => e.pursueProject("late-400")).toThrow(/ideas/i);
    const s = e.getState();
    expect(s.stocks.ideas).toBe(399);
    expect(s.plan).toEqual([]);
    expect(s.stocks.plan).toBe(0);
    expect(s.stocks.budget).toBe(before.stocks.budget);
    expect(s.projects.map((p) => p.defId)).toEqual(before.projects.map((p) => p.defId));
  });

  it("Pursue spends money upfrontCost at the same moment Start would, and fails without spend if budget is short", () => {
    const paid = sized({ id: "paid-plan", name: "Paid plan", sizePoints: 10, upfrontCost: 500 });
    const poor = new Engine(content([paid], { ideas: 100, budget: 100 }));
    expect(() => poor.pursueProject("paid-plan")).toThrow(/afford/i);
    expect(poor.getState().stocks.ideas).toBe(100);
    expect(poor.getState().stocks.budget).toBe(100);
    expect(poor.getState().plan).toEqual([]);

    const rich = new Engine(content([paid], { ideas: 100, budget: 1000 }));
    rich.pursueProject("paid-plan");
    expect(rich.getState().stocks.ideas).toBe(90);
    expect(rich.getState().stocks.budget).toBe(500);
    expect(rich.getState().plan).toHaveLength(1);
  });

  it("Cancel is not Abandon: pipeline remaining stays, and Abandon does not drop Plan items", () => {
    const e = new Engine(content([PEER_A], { ideas: 100 }));
    e.pursueProject("plan-a");
    const s0 = e.getState() as GameState;
    s0.stocks.budget = 0;
    e.tick();
    const planProgress = e.getState().plan[0]!.progress;
    const unshipped = unshippedWork(e.getState());
    const remaining = e.getState().projects[0]!.remaining;

    e.cancelPlan("plan-a");
    expect(e.getState().plan).toEqual([]);
    expect(unshippedWork(e.getState())).toBe(unshipped);
    expect(e.getState().projects[0]!.remaining).toBe(remaining);
    expect(e.getState().projects[0]!.defId).toBe("launch-beta");

    const e2 = new Engine(content([PEER_A], { ideas: 100 }));
    e2.pursueProject("plan-a");
    (e2.getState() as GameState).stocks.budget = 0;
    e2.tick();
    e2.abandonProject("launch-beta");
    expect(e2.getState().projects).toHaveLength(0);
    expect(e2.getState().plan).toHaveLength(1);
    expect(e2.getState().plan[0]!.progress).toBeCloseTo(planProgress, 10);
  });

  it("empty Plan still has capacity 1/day unused", () => {
    const e = new Engine(content([]));
    expect(e.getState().plan).toEqual([]);
    expect(effectiveRate(e.getState(), "plan")).toBe(1);
    e.tick();
    expect(e.getState().plan).toEqual([]);
    expect(e.getState().stocks.plan).toBe(0);
    expect(effectiveRate(e.getState(), "plan")).toBe(1);
  });

  it("discover modifiers do not raise plan; an add-to-plan modifier does", () => {
    const e = new Engine(content([LATE_400], { ideas: 400 }));
    e.pursueProject("late-400");
    const s = e.getState() as GameState;
    s.stocks.budget = 0;
    applyEffects(s, [{ type: "modifyRate", target: "discover", op: "add", value: 1.5 }], "discover-card");
    expect(effectiveRate(s, "plan")).toBe(1);
    e.tick();
    expect(e.getState().plan[0]!.progress).toBeCloseTo(1, 10);

    applyEffects(e.getState() as GameState, [{ type: "modifyRate", target: "plan", op: "add", value: 1 }], "plan-card");
    expect(effectiveRate(e.getState(), "plan")).toBeCloseTo(2, 10);
    e.tick();
    expect(e.getState().plan[0]!.progress).toBeCloseTo(3, 10);
  });

  it("does not branch on eraId when filling Plan", () => {
    const src = readFileSync(join(__dirname, "tick.ts"), "utf-8");
    expect(src).not.toMatch(/\beraId\b/);

    const studio = new Engine(content([LATE_400], { ideas: 400 }));
    studio.pursueProject("late-400");
    (studio.getState() as GameState).stocks.budget = 0;
    const other = new Engine(content([LATE_400], { ideas: 400 }));
    other.pursueProject("late-400");
    (other.getState() as GameState).stocks.budget = 0;
    (other.getState() as GameState).eraId = "company";
    studio.tick();
    other.tick();
    expect(other.getState().plan[0]!.progress).toBeCloseTo(studio.getState().plan[0]!.progress, 10);
    expect(other.getState().plan[0]!.progress).toBeCloseTo(1, 10);
  });

  it("keeps filling Plan while delivery is frozen at $0", () => {
    const e = new Engine(content([LATE_400], { ideas: 400 }));
    e.pursueProject("late-400");
    (e.getState() as GameState).stocks.budget = 0;
    const backlog = e.getState().stocks.backlog;
    e.tick();
    expect(e.getState().stocks.backlog).toBe(backlog);
    expect(e.getState().plan[0]!.progress).toBeCloseTo(1, 10);
  });

  it("rejects a second Pursue of the same name and Start of a Plan item", () => {
    const e = new Engine(content([LATE_400], { ideas: 800 }));
    e.pursueProject("late-400");
    expect(() => e.pursueProject("late-400")).toThrow(/already in plan/i);
    expect(() => e.startProject("late-400")).toThrow(/already in plan/i);
    expect(e.getState().plan).toHaveLength(1);
    expect(e.getState().stocks.ideas).toBe(400);
  });

  it("throws when cancelling a name that is not in Plan", () => {
    const e = new Engine(content([PEER_A]));
    expect(() => e.cancelPlan("plan-a")).toThrow(/not in plan/i);
  });
});
