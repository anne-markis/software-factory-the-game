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

  // Release-7 idle-drain mechanism probe. The structural requirement: doing
  // nothing must lose money on NET, not merely be exposed to challenge
  // events. With baseBurnPerDay 20 and the first contract at $15/pt on the
  // 1 pt/day idle throughput, steady idle cashflow is 15 - 20 = -$5/day.
  // Challenges are stripped here to pin that mechanism in isolation (the
  // full-content trajectory is probed separately below).
  //
  // Exact arithmetic (all integer flows, so toBe is safe): the first point
  // ships on day 3, so while the 1500-pt contract is in flight (2 <= d < 1502):
  //   budget(d) = 10000 - 20d + 15(d - 2) = 9970 - 5d
  // Day 1000: 4970. Day 1500: 2470. The 1500th point ships on day 1502:
  // 2465 (day 1501) + 15 payout + 2000 completion bonus - 20 burn = 4460.
  // After that the contract is gone, payouts stop, and the drain steepens
  // to the full -$20/day: budget(d) = 4460 - 20(d - 1502), so day 1700 =
  // 500, day 1724 = 20, and day 1725 is the first zero-clamp; it stays 0
  // through day 2000. The backlog never runs dry in this window (1500
  // start, net drain 0.5/day after debt regen: 748 left at completion).
  it("idle mechanism: -$5/day glide, completion bonus blip at day 1502, then -$20/day to zero", () => {
    const c = fullContent();
    c.challenges = [];
    const e = new Engine(c);
    const at: Record<number, number> = {};
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      if ([1000, 1500, 1502, 1700, 1724].includes(day)) at[day] = e.getState().stocks.budget;
    }
    expect(at[1000]).toBe(4970); // 9970 - 5 * 1000
    expect(at[1500]).toBe(2470); // 9970 - 5 * 1500
    expect(at[1502]).toBe(4460); // completion: 2465 + 15 + 2000 - 20
    expect(at[1700]).toBe(500); // 4460 - 20 * 198
    expect(at[1724]).toBe(20); // 4460 - 20 * 222
    expect(e.getState().stocks.budget).toBe(0); // clamped from day 1725 on
  });

  // Full-content idle probe: same do-nothing player, challenges on. Events
  // steepen the mechanism's -$5/day: laptop-dies (-$400 at 1%/day, gated on
  // zero human devs -- exactly the idle player) adds about -$4/day expected
  // and ddos about -$3/day, roughly tripling the glide slope. The rng is
  // seeded, so the trajectory is deterministic; observed: day 200 = 7552,
  // day 300 = 6393, day 600 = 2234, first zero-clamp at day 716. Challenge
  // slowdowns delay the 1500-pt completion to day 1518; its +$2000 bonus
  // is a brief blip that the -$20/day post-contract burn erases by roughly
  // day 1620, so the budget is back to 0 at day 2000. Assertions leave
  // headroom but pin the shape: meaningful decline, no instant death
  // (still solvent at day 600), broke within two years, near-empty long-run.
  it("idle with full content: challenges steepen the glide; broke by ~day 716", () => {
    const e = new Engine(fullContent());
    let budgetAt300 = NaN;
    let budgetAt600 = NaN;
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      if (day === 300) budgetAt300 = e.getState().stocks.budget;
      if (day === 600) budgetAt600 = e.getState().stocks.budget;
    }
    expect(budgetAt300).toBeLessThan(8000); // observed 6393: well off the starting 10,000
    expect(budgetAt600).toBeGreaterThan(0); // observed 2234: breathing room, no instant death
    expect(e.getState().stocks.budget).toBeLessThan(100); // observed 0 at day 2000 (first clamp day 716)
  });

  // Smart-strategy probe: a modest, sensible plan (test-suite day 1, ci-cd
  // when affordable, up to two basic-devs after ci-cd, resolve choices with
  // the first option, and start small-crm whenever no project is in
  // flight). Under the seeded rng the hires resolve as "Strong hire" (+1,
  // day 1) and "Decent hire" (+0.5, day 2): 2.5 pt/day at $15/pt = $37.50
  // income against $34/day costs (burn 20 + 2 x dev payroll 7).
  //
  // RESOLUTION (release-7 balance, round 3): scale is now the growth
  // engine. Earlier rounds had a marginal dev costing $10/day against $15
  // of marginal income, leaving zero gross margin at 2 pt/day; challenge
  // drains (sickness, poached, ddos, prod incidents) always won and the
  // 3000-pt first contract outlasted solvency (broke day 792, zero
  // completions). With the dev at $7/day and the first contract at 1500
  // pts, the smart bot completes it on day 662 (observed), rolls straight
  // into small-crm at $18/pt (2.5 x 18 = $45/day vs $34 costs), and stays
  // solvent through day 2000 -- while the idle player still goes broke at
  // day 716 (probe above). Observed trajectory: day 500 = 5043, day 1000 =
  // 2306, day 2000 = 14.89. Note the margin at day 2000 is thin and the
  // late game is lumpy (a brief zero-clamp at day 1785 recovers on
  // small-crm income; payroll survives because income is credited before
  // payroll each tick). Long-run cashflow is still slightly negative net
  // of challenge drains, so budget(2000) > budget(1000) does NOT hold;
  // treat any content change that flips the solvency assertion as a real
  // balance regression, not test noise.
  it("smart strategy: completes the first contract and stays solvent through day 2000", () => {
    const content = fullContent();
    const e = new Engine(content);
    let hires = 0;
    let budgetAt1000 = NaN;
    let completionDay = 0;
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      const s = e.getState();
      const owned = (id: string) => s.decisions.some((d) => d.defId === id);
      if (!owned("test-suite") && s.stocks.budget >= 500) e.applyDecision("test-suite");
      if (owned("test-suite") && !owned("ci-cd") && s.stocks.budget >= 750) e.applyDecision("ci-cd");
      if (owned("ci-cd") && hires < 2) {
        e.applyDecision("basic-dev");
        hires += 1;
      }
      // Continuation: keep income flowing once the current contract is done.
      if (s.projects.length === 0) {
        const crm = e.availableProjects().find((p) => p.def.id === "small-crm");
        if (crm?.startable) e.startProject("small-crm");
      }
      for (const pc of [...s.pendingChoices]) {
        const def = content.challenges.find((c) => c.id === pc.challengeId)!;
        e.resolveChoice(pc.challengeId, def.choice!.options[0].id);
      }
      if (completionDay === 0 && s.completedProjects >= 1) completionDay = day;
      if (day === 1000) budgetAt1000 = s.stocks.budget;
      assertInvariants(s, day);
    }
    expect(completionDay).toBeGreaterThan(0); // observed: day 662
    expect(completionDay).toBeLessThan(1000); // well before the idle-glide horizon
    expect(e.getState().completedProjects).toBeGreaterThanOrEqual(1);
    expect(budgetAt1000).toBeGreaterThan(1000); // observed 2306: mid-game cushion
    expect(e.getState().stocks.budget).toBeGreaterThan(0); // observed 14.89 at day 2000
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
    // No solvency or completion assertions here, deliberately: under the
    // release-7 economy, buying everything affordable is NOT a viable
    // strategy (design intent: choices matter). Observed at day 2000:
    // completedProjects 0, budget ~1.36, shipped ~2696. This run exercises
    // engine invariants under maximal purchasing pressure, not balance;
    // balance is pinned by the mechanism/idle/smart probes above.
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
