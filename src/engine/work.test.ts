import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { applyEffects } from "./effects";
import { parseStartConfig, parseChallenges, parseProjects } from "./content";
import { challengesJson, projectsJson, startJson } from "./loadShippedContent";
import { attachInjectedWork, committedWork, isPipelineStock, surplusGrewWhileInFlight, surplusWork, unshippedWork, workLedgerIssues } from "./work";
import type { GameContent, GameState } from "./types";

function testContent(): GameContent {
  return { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
}

describe("work ledger (ADR 0009)", () => {
  it("classifies unshipped pipeline stocks and not identity/resource stocks", () => {
    expect(isPipelineStock("backlog")).toBe(true);
    expect(isPipelineStock("inProgress")).toBe(true);
    expect(isPipelineStock("done")).toBe(true);
    expect(isPipelineStock("shipped")).toBe(false);
    expect(isPipelineStock("users")).toBe(false);
    expect(isPipelineStock("budget")).toBe(false);
  });

  it("unshippedWork is Ready + In Progress + Done, not shipped", () => {
    const e = new Engine(testContent());
    const s = e.getState() as GameState;
    expect(unshippedWork(s)).toBe(300);
    expect(committedWork(s)).toBe(300);
    s.stocks.inProgress = 10;
    s.stocks.done = 5;
    s.stocks.backlog = 20;
    s.stocks.shipped = 999;
    expect(unshippedWork(s)).toBe(35);
  });

  it("attachInjectedWork grows the oldest in-flight remaining and no-ops with none", () => {
    const e = new Engine(testContent());
    const s = e.getState() as GameState;
    attachInjectedWork(s, 75);
    expect(s.projects[0]!.remaining).toBe(375);
    s.projects = [];
    attachInjectedWork(s, 10);
    expect(committedWork(s)).toBe(0);
  });

  // The reported bug: Ready (stocks.backlog) hits 0 while ~40 contract
  // points are still finishing in later stages, users still 0, projects
  // panel still showing remaining. Those numbers are the same work; the
  // cockpit Backlog hero metric must keep showing the unshipped total
  // (and remaining) until it actually ships.
  it("Ready can drain while remaining/unshipped/~40 pts of WIP still finish, and users stay 0 until ship-complete", () => {
    const e = new Engine(testContent());
    let readyEmpty = false;
    for (let i = 0; i < 400 && !readyEmpty; i++) {
      e.tick();
      const s = e.getState();
      if (s.stocks.backlog <= 1e-9) readyEmpty = true;
    }
    expect(readyEmpty).toBe(true);
    const atEmpty = e.getState();
    expect(atEmpty.completedProjects).toBe(0);
    expect(atEmpty.stocks.users).toBe(0);
    expect(atEmpty.projects[0]!.remaining).toBeGreaterThan(1);
    expect(unshippedWork(atEmpty)).toBeCloseTo(atEmpty.projects[0]!.remaining, 8);
    expect(atEmpty.stocks.inProgress + atEmpty.stocks.done).toBeCloseTo(atEmpty.projects[0]!.remaining, 8);

    for (let i = 0; i < 400 && atEmpty.completedProjects === 0; i++) {
      e.tick();
    }
    const done = e.getState();
    expect(done.completedProjects).toBe(1);
    expect(done.stocks.users).toBeGreaterThan(0);
    expect(done.projects).toHaveLength(0);
  });

  it("tech-debt refill on an in-flight contract grows remaining (rework delays delivery)", () => {
    const e = new Engine(testContent());
    const s = e.getState() as GameState;
    s.completedProjects = 1; // gate open
    s.stocks.backlog = 0;
    s.stocks.inProgress = 0;
    s.stocks.done = 10;
    s.projects[0]!.remaining = 10; // in sync with the pipeline
    e.tick();
    // Deploy 1: remaining 9, then 0.5 debt attaches onto the same contract.
    expect(e.getState().projects[0]!.remaining).toBeCloseTo(9.5, 10);
    expect(unshippedWork(e.getState())).toBeCloseTo(9.5, 10);
  });

  it("scope creep on an in-flight project grows remaining, so extra work delays completion", () => {
    const c = testContent();
    c.start.initialProject.sizePoints = 4;
    c.start.stocks.backlog = 4;
    const baseline = new Engine(c);
    const crept = new Engine(structuredClone(c));
    applyEffects(crept.getState() as GameState, [{ type: "addToStock", stock: "backlog", value: 4 }], "scope");
    expect(crept.getState().projects[0]!.remaining).toBe(8);
    expect(unshippedWork(crept.getState())).toBe(8);

    let baseDay = 0;
    let creepDay = 0;
    for (let d = 1; d <= 40; d++) {
      baseline.tick();
      crept.tick();
      if (baseDay === 0 && baseline.getState().completedProjects >= 1) baseDay = d;
      if (creepDay === 0 && crept.getState().completedProjects >= 1) creepDay = d;
    }
    expect(baseDay).toBeGreaterThan(0);
    expect(creepDay).toBeGreaterThan(baseDay);
  });

  it("leftover pipeline after a contract does not complete the next project early", () => {
    const c = testContent();
    c.start.initialProject.sizePoints = 2;
    c.start.stocks.backlog = 2;
    const e = new Engine(c);
    for (let i = 0; i < 8; i++) e.tick();
    expect(e.getState().completedProjects).toBe(1);
    const s = e.getState() as GameState;
    s.stocks.backlog = 50;
    s.stocks.inProgress = 0;
    s.stocks.done = 0;
    expect(s.projects).toHaveLength(0);
    e.startProject("gig-plugin");
    const live = e.getState() as GameState;
    live.debtMultiplierBase = 0; // isolate surplus-first from debt refill
    expect(live.projects[0]!.remaining).toBe(450);
    expect(unshippedWork(live)).toBe(500);

    const shippedAtStart = e.getState().stocks.shipped;
    for (let i = 0; i < 200 && e.getState().stocks.shipped - shippedAtStart < 50; i++) e.tick();
    // The 50 leftover points shipped and must not have been credited. The last
    // tick can overshoot surplus by a fraction of one day's deploy (users
    // drag makes deploy < 1), so remaining may drop a hair under 450.
    expect(e.getState().completedProjects).toBe(1);
    expect(e.getState().stocks.shipped - shippedAtStart).toBeGreaterThanOrEqual(50);
    expect(e.getState().projects[0]!.remaining).toBeGreaterThan(449);
  });
});

describe("work ledger vs shipped challenges", () => {
  it("scope-creep addToStock attaches to remaining when a project is in flight", () => {
    const c: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [],
      challenges: parseChallenges(challengesJson),
      projects: [],
    };
    const e = new Engine(c);
    const before = e.getState().projects[0]!.remaining;
    applyEffects(e.getState() as GameState, [{ type: "addToStock", stock: "backlog", value: 75 }], "scope-creep");
    expect(e.getState().stocks.backlog).toBe(375);
    expect(e.getState().projects[0]!.remaining).toBe(before + 75);
  });
});

describe("work ledger conservation across every mutation path", () => {
  it("flags leftover bag growth while in flight (scope/debt without attach) and stranded remaining", () => {
    const e = new Engine(testContent());
    const s = e.getState() as GameState;
    const before = { stocks: { ...s.stocks }, projects: [{ ...s.projects[0]! }], completedProjects: s.completedProjects };
    s.stocks.backlog += 75; // bag only, no attachInjectedWork
    expect(workLedgerIssues(s)).toEqual([]); // leftover is legal between contracts; not while in flight
    expect(surplusWork(s)).toBe(75);
    expect(surplusGrewWhileInFlight(before, s)).toBe(true);

    s.stocks.backlog = 0;
    s.stocks.inProgress = 0;
    s.stocks.done = 0;
    expect(workLedgerIssues(s).some((m) => m.includes("exceeds unshipped"))).toBe(true);
  });

  it("addToStock/scaleStock on each pipeline stage keep remaining in lockstep; shipped does not", () => {
    for (const stock of ["backlog", "inProgress", "done"] as const) {
      const e = new Engine(testContent());
      const before = e.getState().projects[0]!.remaining;
      applyEffects(e.getState() as GameState, [{ type: "addToStock", stock, value: 10 }], "inj");
      expect(workLedgerIssues(e.getState())).toEqual([]);
      expect(e.getState().projects[0]!.remaining).toBe(before + 10);
      expect(surplusWork(e.getState())).toBe(0);
    }
    const shipped = new Engine(testContent());
    const rem = shipped.getState().projects[0]!.remaining;
    applyEffects(shipped.getState() as GameState, [{ type: "addToStock", stock: "shipped", value: 10 }], "inj");
    expect(shipped.getState().projects[0]!.remaining).toBe(rem);
    expect(unshippedWork(shipped.getState())).toBe(300);

    const scaled = new Engine(testContent());
    applyEffects(scaled.getState() as GameState, [{ type: "scaleStock", stock: "backlog", factor: 2 }], "inj");
    expect(scaled.getState().projects[0]!.remaining).toBe(600);
    expect(unshippedWork(scaled.getState())).toBe(600);
    expect(workLedgerIssues(scaled.getState())).toEqual([]);
  });

  it("pull/finish move work between stages without changing unshipped or remaining", () => {
    const e = new Engine(testContent());
    e.tick(); // pull 2, no ship yet
    const s = e.getState();
    expect(s.stocks.backlog).toBe(298);
    expect(s.stocks.inProgress).toBe(2);
    expect(unshippedWork(s)).toBe(300);
    expect(s.projects[0]!.remaining).toBe(300);
    expect(workLedgerIssues(s)).toEqual([]);
  });

  it("each idle tick until beta completion keeps surplus at 0 and ledger clean", () => {
    const e = new Engine(testContent());
    let prev = e.getState();
    for (let i = 0; i < 400 && e.getState().completedProjects === 0; i++) {
      const before = {
        stocks: { ...prev.stocks },
        projects: prev.projects.map((p) => ({ ...p })),
        completedProjects: prev.completedProjects,
      };
      e.tick();
      const s = e.getState();
      expect(workLedgerIssues(s), `day ${s.day}`).toEqual([]);
      expect(surplusGrewWhileInFlight(before, s), `day ${s.day}`).toBe(false);
      if (s.completedProjects === 0) {
        expect(surplusWork(s)).toBeCloseTo(0, 8);
        expect(unshippedWork(s)).toBeCloseTo(s.projects[0]!.remaining, 8);
      }
      prev = s;
    }
    expect(e.getState().completedProjects).toBe(1);
  });

  it("startProject does not change surplus (new remaining matches new Ready points)", () => {
    const c = testContent();
    c.start.initialProject.sizePoints = 2;
    c.start.stocks.backlog = 2;
    const e = new Engine(c);
    for (let i = 0; i < 8; i++) e.tick();
    const s = e.getState() as GameState;
    s.stocks.backlog = 0;
    s.stocks.inProgress = 0;
    s.stocks.done = 0;
    const surplusBefore = surplusWork(s);
    e.startProject("gig-plugin");
    expect(surplusWork(e.getState())).toBeCloseTo(surplusBefore, 8);
    expect(workLedgerIssues(e.getState())).toEqual([]);
  });
});
