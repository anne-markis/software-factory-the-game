import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { loadShippedContent } from "./loadShippedContent";
import { advancePlan, pursueProject, scheduleProjectManagers } from "./projects";
import { activateDueInstances } from "./tick";
import type { AutoSchedulePolicy, GameState } from "./types";

function companyEngine(): Engine {
  const content = loadShippedContent("company");
  content.challenges = [];
  return new Engine(content);
}

function openMainLine(engine: Engine, completed: string[]): void {
  const state = engine.getState() as GameState;
  state.completedProjectIds = completed;
  state.completedProjects = completed.length;
  state.stocks.ideas = 1000;
  state.stocks.budget = 20000;
}

function policy(partial: Partial<AutoSchedulePolicy> = {}): AutoSchedulePolicy {
  return {
    projectIds: ["ship-v1", "ship-vnext"],
    ideaCostFactor: 1,
    cashReserve: 0,
    skipWhenBurnExceedsIncome: false,
    ...partial,
  };
}

function addManager(engine: Engine, instanceId: string, autoSchedule: AutoSchedulePolicy, activeOnDay?: number): void {
  const state = engine.getState() as GameState;
  state.decisions.push({
    instanceId,
    defId: "project-manager",
    human: true,
    autoSchedule,
    ...(activeOnDay !== undefined ? { activeOnDay } : {}),
  });
}

describe("project manager auto-schedule", () => {
  it("waits for ideas, then pursues Ship v1 at the tier's idea cost", () => {
    const engine = companyEngine();
    openMainLine(engine, ["launch-beta"]);
    (engine.getState() as GameState).stocks.ideas = 50;
    addManager(engine, "pm-1", policy({ ideaCostFactor: 0.5 }));
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    expect(engine.getState().plan).toEqual([]);

    (engine.getState() as GameState).stocks.ideas = 100;
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    expect(engine.getState().plan.map((item) => item.defId)).toEqual(["ship-v1"]);
    expect(engine.getState().plan[0]?.scheduledBy).toBe("pm-1");
    expect(engine.getState().stocks.ideas).toBe(0);
  });

  it("holds every queued copy through Ready and does not exceed the era cap", () => {
    const engine = companyEngine();
    openMainLine(engine, ["launch-beta", "ship-v1"]);
    addManager(engine, "pm-1", policy());
    const state = engine.getState() as GameState;
    scheduleProjectManagers(state, engine.getContent());
    expect(state.plan).toHaveLength(2);
    expect(state.plan.every((item) => item.defId === "ship-vnext" && item.scheduledBy === "pm-1")).toBe(true);
    for (const item of state.plan) item.progress = item.size - 0.5;
    advancePlan(state, engine.getContent());
    expect(state.plan).toEqual([]);
    expect(state.projects.filter((project) => project.defId === "ship-vnext" && project.scheduledBy === "pm-1")).toHaveLength(2);
    const ideas = state.stocks.ideas;
    scheduleProjectManagers(state, engine.getContent());
    expect(state.plan).toEqual([]);
    expect(state.stocks.ideas).toBe(ideas);
  });

  it("one manager fills the Company cap and a second adds no feature", () => {
    const engine = companyEngine();
    openMainLine(engine, ["launch-beta", "ship-v1"]);
    addManager(engine, "pm-1", policy());
    addManager(engine, "pm-2", policy());
    addManager(engine, "pm-3", policy());
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    const queued = engine.getState().plan;
    expect(queued).toHaveLength(2);
    expect(queued.every((item) => item.scheduledBy === "pm-1" && item.defId === "ship-vnext")).toBe(true);
  });

  it("one manager fills Megacorp's three parallel copies", () => {
    const content = loadShippedContent("megacorp");
    content.challenges = [];
    const engine = new Engine(content);
    openMainLine(engine, ["launch-beta", "ship-v1"]);
    addManager(engine, "pm-1", policy());
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    const queued = engine.getState().plan;
    expect(queued).toHaveLength(3);
    expect(queued.every((item) => item.scheduledBy === "pm-1" && item.defId === "ship-vnext")).toBe(true);
  });

  it("stops when the next copy is unaffordable and fills it on a later call", () => {
    const engine = companyEngine();
    openMainLine(engine, ["launch-beta", "ship-v1"]);
    (engine.getState() as GameState).stocks.ideas = 200;
    addManager(engine, "pm-1", policy());
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    expect(engine.getState().plan).toHaveLength(1);
    expect(engine.getState().stocks.ideas).toBe(0);

    (engine.getState() as GameState).stocks.ideas = 200;
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    expect(engine.getState().plan).toHaveLength(2);
    expect(engine.getState().plan.every((item) => item.scheduledBy === "pm-1")).toBe(true);
  });

  it("a second manager fills a slot the first could not afford", () => {
    const engine = companyEngine();
    openMainLine(engine, ["launch-beta", "ship-v1"]);
    (engine.getState() as GameState).stocks.ideas = 300;
    addManager(engine, "pm-1", policy({ ideaCostFactor: 1 }));
    addManager(engine, "pm-2", policy({ ideaCostFactor: 0.5 }));
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    expect(engine.getState().plan.map((item) => item.scheduledBy)).toEqual(["pm-1", "pm-2"]);
    expect(engine.getState().stocks.ideas).toBe(0);
  });

  it("leaves room for a player-started copy instead of exceeding the era cap", () => {
    const engine = companyEngine();
    openMainLine(engine, ["launch-beta", "ship-v1"]);
    const state = engine.getState() as GameState;
    pursueProject(state, engine.getContent(), "ship-vnext");
    addManager(engine, "pm-1", policy());
    scheduleProjectManagers(state, engine.getContent());
    expect(state.plan).toHaveLength(2);
    expect(state.plan.filter((item) => item.scheduledBy === "pm-1")).toHaveLength(1);
  });

  it("does not exceed Studio's single parallel copy", () => {
    const content = loadShippedContent();
    content.challenges = [];
    const engine = new Engine(content);
    openMainLine(engine, ["launch-beta", "ship-v1"]);
    addManager(engine, "pm-1", policy());
    addManager(engine, "pm-2", policy());
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    expect(engine.getState().plan.map((item) => item.scheduledBy)).toEqual(["pm-1"]);
  });

  it("a cautious hire waits while burn exceeds income; a disaster hire does not", () => {
    const engine = companyEngine();
    openMainLine(engine, ["launch-beta"]);
    addManager(engine, "careful", policy({ skipWhenBurnExceedsIncome: true, cashReserve: 0 }));
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    expect(engine.getState().plan).toEqual([]);

    addManager(engine, "disaster", policy({ skipWhenBurnExceedsIncome: false, ideaCostFactor: 2 }));
    const before = engine.getState().stocks.ideas;
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    expect(engine.getState().plan.map((item) => item.scheduledBy)).toEqual(["disaster"]);
    expect(engine.getState().stocks.ideas).toBe(before - 400);
  });

  it("refuses to spend below the cash reserve", () => {
    const engine = companyEngine();
    openMainLine(engine, ["launch-beta"]);
    (engine.getState() as GameState).stocks.budget = 4999;
    addManager(engine, "pm-1", policy({ cashReserve: 5000 }));
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    expect(engine.getState().plan).toEqual([]);
    (engine.getState() as GameState).stocks.budget = 5000;
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    expect(engine.getState().plan).toHaveLength(1);
  });

  it("does not schedule before the hire starts, and firing them leaves the queue", () => {
    const engine = companyEngine();
    openMainLine(engine, ["launch-beta"]);
    addManager(engine, "pm-1", policy(), engine.getState().day + 14);
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    expect(engine.getState().plan).toEqual([]);

    (engine.getState() as GameState).decisions.find((d) => d.instanceId === "pm-1")!.activeOnDay = engine.getState().day;
    scheduleProjectManagers(engine.getState() as GameState, engine.getContent());
    expect(engine.getState().plan).toHaveLength(1);
    engine.removeDecision("pm-1");
    expect(engine.getState().plan).toHaveLength(1);
    expect(engine.getState().plan[0]?.scheduledBy).toBe("pm-1");
  });

  it("records the rolled policy when the hire starts", () => {
    const engine = companyEngine();
    engine.applyDecision("project-manager");
    const pending = engine.getState().decisions.find((d) => d.defId === "project-manager")!;
    expect(pending.autoSchedule).toBeUndefined();
    expect(pending.gambleLabel).toBeTruthy();
    const state = engine.getState() as GameState;
    pending.activeOnDay = state.day;
    activateDueInstances(state, engine.getContent());
    expect(pending.autoSchedule?.projectIds).toEqual(["ship-v1", "ship-vnext"]);
    expect(pending.autoSchedule?.skipWhenBurnExceedsIncome).toBe(pending.gambleLabel !== "Disaster hire");
  });
});
