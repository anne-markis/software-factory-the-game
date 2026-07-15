import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { parseStartConfig, parseDecisions, parseChallenges, parseProjects } from "./content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import challengesJson from "../../content/challenges.json";
import projectsJson from "../../content/projects.json";
import type { GameContent, GameState } from "./types";

function fullContent(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: parseChallenges(challengesJson),
    projects: parseProjects(projectsJson),
  };
}

function assertInvariants(s: Readonly<GameState>, day: number): void {
  for (const [name, v] of Object.entries(s.stocks)) {
    expect(v, `stock ${name} at day ${day}`).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(v), `stock ${name} finite at day ${day}`).toBe(true);
  }
  expect(s.pointsPerDay).toBeGreaterThanOrEqual(0);
}

describe("simulation", () => {
  it("idle strategy: 2000 days with full content violates no invariants", () => {
    const e = new Engine(fullContent());
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      assertInvariants(e.getState(), day);
    }
  });

  it("greedy strategy: buy everything affordable each day, invariants hold", () => {
    const content = fullContent();
    const e = new Engine(content);
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      for (const a of e.availableDecisions()) {
        if (a.purchasable && !e.getState().decisions.some((d) => d.defId === a.def.id)) {
          e.applyDecision(a.def.id);
        }
      }
      for (const p of e.availableProjects()) {
        if (p.startable) e.startProject(p.def.id);
      }
      // resolve any pending choice with its first option
      for (const pc of [...e.getState().pendingChoices]) {
        const def = content.challenges.find((c) => c.id === pc.challengeId)!;
        e.resolveChoice(pc.challengeId, def.choice!.options[0].id);
      }
      assertInvariants(e.getState(), day);
    }
    // sanity: the factory actually did something
    expect(e.getState().stocks.shipped).toBeGreaterThan(100);
  });

  it("upgrades matter: test suite reduces tech debt vs idle over 400 days", () => {
    const idle = new Engine(fullContent());
    const invested = new Engine(fullContent());
    invested.applyDecision("test-suite");
    for (let day = 1; day <= 400; day++) {
      idle.tick();
      invested.tick();
      if (day === 10) invested.applyDecision("ci-cd");
    }
    expect(invested.getState().stocks.shipped).toBeGreaterThanOrEqual(idle.getState().stocks.shipped * 0.8);
    expect(invested.getState().stocks.techDebt).toBeLessThan(idle.getState().stocks.techDebt);
  });

  it("stall is reachable and stable: empty content pipeline drains to stall", () => {
    const c = fullContent();
    // Isolate the invariant under test (isStalled reachability) from three
    // confounds that are each real, deliberate engine behavior but would
    // otherwise make a true stall unreachable within a short tick budget:
    //  - challenges.json fires random events (e.g. scope-creep: +200 backlog)
    //    unconditionally, regardless of the player's budget.
    //  - debtMultiplier > 0 regenerates a fraction of every shipped point
    //    back into backlog forever, so backlog+inProgress+done only decays
    //    asymptotically and never hits exact 0 in a realistic tick count.
    //  - decisions.json's basic-dev has a perDay-only cost (no oneTime), and
    //    availability() only checks oneTime affordability (by design: see
    //    decisions.test.ts "payroll failure removes the decision permanently
    //    during tick" - buying beyond your means is allowed, payroll failure
    //    is the insolvency mechanism). That makes basic-dev always
    //    "purchasable" regardless of budget, so isStalled() can never be
    //    true while any decisions are offered.
    // None of these are bugs; they just mean "true stall" cannot be produced
    // from unmodified full content in a short simulation. Zeroing them here
    // isolates the pipeline-drain + project-affordability logic that
    // isStalled() is actually meant to capture.
    c.challenges = [];
    c.decisions = [];
    c.start.debtMultiplier = 0;
    c.start.stocks.backlog = 3;
    c.start.stocks.budget = 10;
    c.start.initialProject.sizePoints = 3;
    // Zero the payout so completing the initial project does not inject
    // cash that would make a project (cheapest upfrontCost $2000) affordable.
    c.start.initialProject.completionBonus = 0;
    c.start.initialProject.payoutPerPoint = 0;

    const e = new Engine(c);
    for (let i = 0; i < 30; i++) e.tick();
    expect(e.isStalled()).toBe(true);

    const before = e.getState().stocks;
    expect(before.budget).toBe(0);
    expect(before.backlog).toBe(0);
    expect(before.inProgress).toBe(0);
    expect(before.done).toBe(0);

    e.tick();
    expect(e.isStalled()).toBe(true);
    const after = e.getState().stocks;
    expect(after.budget).toBe(0);
    expect(after.backlog).toBe(0);
    expect(after.inProgress).toBe(0);
    expect(after.done).toBe(0);
  });
});
