import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { parseStartConfig, parseProjects } from "./content";
import startJson from "../../content/start.json";
import projectsJson from "../../content/projects.json";
import { effectiveRate, contextSwitchTax } from "./modifiers";
import type { GameContent } from "./types";

function content(overrides: Partial<GameContent["start"]["stocks"]> = {}): GameContent {
  const start = parseStartConfig(startJson);
  Object.assign(start.stocks, overrides);
  return { start, decisions: [], challenges: [], projects: parseProjects(projectsJson) };
}

describe("projects", () => {
  it("startProject charges upfront cost and adds points to backlog", () => {
    const e = new Engine(content());
    e.startProject("small-crm");
    const s = e.getState();
    expect(s.stocks.budget).toBe(8000);
    expect(s.stocks.backlog).toBe(8000); // start backlog 3000 + small-crm sizePoints 5000
    expect(s.projects).toHaveLength(2);
  });

  it("applies the context-switch tax with multiple projects in flight", () => {
    const e = new Engine(content());
    expect(contextSwitchTax(e.getState())).toBe(1);
    e.startProject("small-crm");
    expect(contextSwitchTax(e.getState())).toBeCloseTo(0.85);
    expect(effectiveRate(e.getState(), "pull")).toBeCloseTo(0.85);
  });

  it("gates projects on completedProjects and budget", () => {
    const e = new Engine(content());
    expect(() => e.startProject("big-migration")).toThrow(/requires/);
    const poor = new Engine(content({ budget: 100 }));
    expect(() => poor.startProject("small-crm")).toThrow(/afford/);
  });

  it("FIFO attribution completes the oldest project first and pays its bonus", () => {
    const c = content();
    c.start.initialProject.sizePoints = 2;
    c.start.stocks.backlog = 2;
    const e = new Engine(c);
    e.startProject("small-crm"); // backlog now 2 + 5000
    // run until the first 2 shipped points complete the initial project
    for (let i = 0; i < 12; i++) e.tick();
    const s = e.getState();
    expect(s.completedProjects).toBe(1);
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0].defId).toBe("small-crm");
    expect(s.log.some((l) => l.message.includes("Project complete: First Contract"))).toBe(true);
  });

  it("rejects starting a project already in flight", () => {
    const e = new Engine(content());
    e.startProject("small-crm");
    expect(() => e.startProject("small-crm")).toThrow(/already in flight/);
  });

  it("allows restarting a project after completion (current policy: projects are repeatable)", () => {
    const c = content();
    c.start.initialProject.sizePoints = 2;
    c.start.stocks.backlog = 2;
    const e = new Engine(c);
    for (let i = 0; i < 6; i++) e.tick(); // complete the tiny initial project
    expect(e.getState().completedProjects).toBe(1);
    e.startProject("small-crm");
    e.getState().projects.forEach((p) => expect(p.defId).toBe("small-crm"));
  });

  it("isStalled when pipeline is empty and nothing is affordable", () => {
    const c = content({ backlog: 0, budget: 10 });
    const e = new Engine(c);
    expect(e.isStalled()).toBe(true);
    const rich = new Engine(content({ backlog: 0, budget: 5000 }));
    expect(rich.isStalled()).toBe(false); // can afford small-crm
  });
});
