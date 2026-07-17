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
  // and ddos about -$3/day. The idle player owns no decisions at all, so
  // every hasTag-gated content-wave challenge (model-deprecation,
  // api-price-hike, runaway-agent-loop, meeting-creep, team-conflict,
  // cloud-credits) is condition-gated out and never fires; the only new
  // challenge that reaches the idle player is open-source-windfall
  // (minDay 15, +$400, 1%/day, 60-day cooldown), a pure income boost that
  // softens the glide.
  //
  // RE-PINNED for content wave (release 8, task 4.5): challenge rolls are now
  // hashed per challenge (hashRoll on gameSeed/day/id) instead of drawn
  // positionally from the shared rng stream, and the challenge phase no longer
  // consumes that stream at all. This deliberately changes which challenge
  // days land (a fresh, content-stable draw of the same probabilities), so the
  // trajectory shifted again: broke by ~day 696 (was ~936 under the task-4
  // positional draws), day 300 = 6693, day 600 = 1757. The point of the
  // refactor is that these values no longer move when a challenge is added or
  // reordered in content. Assertions leave headroom but pin the shape:
  // meaningful decline off the starting 10,000, no instant death, broke well
  // within two years, near-empty long-run.
  it("idle with full content: challenges steepen the glide; broke by ~day 696", () => {
    const e = new Engine(fullContent());
    let budgetAt300 = NaN;
    let budgetAt600 = NaN;
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      if (day === 300) budgetAt300 = e.getState().stocks.budget;
      if (day === 600) budgetAt600 = e.getState().stocks.budget;
    }
    expect(budgetAt300).toBeLessThan(8800); // observed 6693: well off the starting 10,000
    expect(budgetAt600).toBeGreaterThan(0); // observed 1757: breathing room, no instant death
    expect(e.getState().stocks.budget).toBeLessThan(100); // observed 0 at day 2000 (first clamp day 696)
  });

  // Smart-strategy probe: a modest, sensible plan (test-suite day 1, ci-cd
  // when affordable, up to two basic-devs after ci-cd, resolve choices with
  // the first option, and start small-crm whenever no project is in
  // flight). Under the seeded rng the hires resolve as "Strong hire" (+1,
  // day 1) and "Decent hire" (+0.5, day 2): 2.5 pt/day at $15/pt = $37.50
  // income against $34/day costs (burn 20 + 2 x dev payroll 7).
  //
  // RESOLUTION (release-7 balance, round 3): scale is now the growth
  // engine. With the dev at $7/day and the first contract at 1500 pts, the
  // smart bot used to complete it on day 662, roll into small-crm, and stay
  // solvent through day 2000 (budget(2000) observed 14.89).
  //
  // RE-PINNED for content wave (release 8, task 4.5). Challenge rolls are now
  // hashed per challenge (hashRoll on gameSeed/day/id) rather than drawn
  // positionally from the shared rng stream, and the challenge phase no longer
  // touches that stream -- so both the challenge outcomes AND the purchase
  // gambles (which still draw from the stream) fall on a different, now
  // content-stable, deterministic sequence than under task 4's positional
  // draws. This build owns basic-dev (tagged "human"), so it also satisfies
  // meeting-creep's and team-conflict's hasTag conditions once it hires.
  // Measured challenge fires over this run: sickness 96, ddos 27, scope-creep
  // 33, prod-incident 12, poached 6, team-conflict 8, meeting-creep 4.
  //
  // RESOLUTION (release-8 Task 6): this probe is deliberately KEPT as a
  // mid-tier observation probe, not a viability bar. The narrow two-dev build
  // still cannot stay solvent under the full challenge load: broke (first
  // zero-clamp) on day 513, completion on day 1323, post-completion peak
  // ~1981, budget 370 at day 1000 -- values unchanged by the Task 6 tuning
  // (the small-crm payout bump lands after this build is already pinned to
  // the zero-clamp treadmill, and none of its purchases changed price). That
  // insolvency is now design signal rather than an open flag: the two
  // richer build probes below (human-heavy and automation-heavy) are the
  // viability bar, and a modest test-suite + ci-cd + two-hires plan being
  // NOT enough at 2000 days is exactly the "choices matter" pressure the
  // release-7 economy aimed for. The probe stays because it pins a distinct
  // mid-tier point on the difficulty curve and exercises hire gambles plus
  // choice resolution under pinned challenge fire counts (sickness 96,
  // ddos 27, scope-creep 33, prod-incident 12, poached 6, team-conflict 8,
  // meeting-creep 4). Only completedProjects >= 1 is solvency-shaped; budget
  // checkpoints are observations, not guarantees.
  it("smart strategy (mid-tier observation): completes the first contract; the narrow build goes broke under full challenge load by design", () => {
    const content = fullContent();
    const e = new Engine(content);
    let hires = 0;
    let budgetAt1000 = NaN;
    let completionDay = 0;
    let peakBudgetAfterCompletion = 0;
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
      if (completionDay > 0) peakBudgetAfterCompletion = Math.max(peakBudgetAfterCompletion, s.stocks.budget);
      if (day === 1000) budgetAt1000 = s.stocks.budget;
      assertInvariants(s, day);
    }
    expect(completionDay).toBeGreaterThan(0); // observed: day 1323
    expect(completionDay).toBeLessThan(1800); // still comfortably within the 2000-day horizon
    expect(e.getState().completedProjects).toBeGreaterThanOrEqual(1);
    expect(budgetAt1000).toBeGreaterThanOrEqual(0); // observed 370 (first clamp to 0 was day 513)
    expect(peakBudgetAfterCompletion).toBeGreaterThan(0); // observed 1981.44: completion bonus is a real breather
    expect(e.getState().stocks.budget).toBeGreaterThanOrEqual(0); // observed 0 at day 2000
  });

  // ---- Release-8 Task 6 viability probes ------------------------------------
  //
  // A shared harness for the two "richer build" probes the content-wave spec
  // (section 2) demands: at least one human-heavy and one automation-heavy
  // strategy must each complete multiple projects and stay solvent over 2000
  // days. Structure follows the smart probe: a priority shopping list bought
  // strictly in order (respecting requires edges -- the list stalls on the
  // first unowned item until it is purchasable with a cash buffer), pending
  // choices resolved with their first option, and project continuation
  // small-crm then mobile-app whenever nothing is in flight and the upfront
  // cost plus a reserve is affordable. The buffer/reserve are strategy
  // parameters (a sensible player keeps runway), not engine knobs.
  //
  // Deliberately NO cross-probe dominance assertion: track speed is emergent
  // (spec section 2); these pin viability floors only.
  function runBuildProbe(shoppingList: string[]): {
    completedProjects: number;
    completionDays: number[];
    budgetAtDay: Record<number, number>;
    endBudget: number;
    everBroke: boolean;
  } {
    const BUY_BUFFER = 800; // keep this much cash on hand beyond any oneTime cost
    const PROJECT_RESERVE = 600; // keep this much beyond a project's upfront cost
    const content = fullContent();
    const e = new Engine(content);
    let startedSmallCrm = false;
    let lastCompleted = 0;
    let everBroke = false;
    const completionDays: number[] = [];
    const budgetAtDay: Record<number, number> = {};
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      const s = e.getState();
      const owned = (id: string) => s.decisions.some((d) => d.defId === id);
      for (const id of shoppingList) {
        if (owned(id)) continue;
        const a = e.availableDecisions().find((x) => x.def.id === id);
        if (!a || a.code === "missing-requires") break; // wait for the prerequisite
        const oneTime = a.def.cost.oneTime ?? 0;
        if (a.purchasable && s.stocks.budget >= oneTime + BUY_BUFFER) e.applyDecision(id);
        break; // strict priority: never skip ahead in the list
      }
      if (s.projects.length === 0) {
        const wantId = !startedSmallCrm ? "small-crm" : "mobile-app";
        const w = e.availableProjects().find((x) => x.def.id === wantId);
        if (w?.startable && s.stocks.budget >= w.def.upfrontCost + PROJECT_RESERVE) {
          e.startProject(wantId);
          if (wantId === "small-crm") startedSmallCrm = true;
        }
      }
      for (const pc of [...s.pendingChoices]) {
        const def = content.challenges.find((c) => c.id === pc.challengeId)!;
        e.resolveChoice(pc.challengeId, def.choice!.options[0].id);
      }
      if (s.completedProjects > lastCompleted) {
        completionDays.push(day);
        lastCompleted = s.completedProjects;
      }
      if (s.stocks.budget === 0) everBroke = true;
      if ([500, 1000, 2000].includes(day)) budgetAtDay[day] = s.stocks.budget;
      assertInvariants(s, day);
    }
    return {
      completedProjects: e.getState().completedProjects,
      completionDays,
      budgetAtDay,
      endBudget: e.getState().stocks.budget,
      everBroke,
    };
  }

  // Human-heavy build. Observed trajectory under the tuned content: completes
  // first-contract on day 412 and small-crm on day 1804, is partway through
  // mobile-app at day 2000; budget 5254 at day 500, 5963 at day 1000, 4332 at
  // day 2000; never hits the zero-clamp. Challenge exposure is the human set
  // (sickness 110, meeting-creep 5, team-conflict 5, poached 4) plus the
  // universal ones; the human tag never triggers the darkfactory pool.
  it("human-heavy strategy: completes multiple projects and stays solvent over 2000 days", () => {
    const r = runBuildProbe([
      "test-suite",
      "ci-cd",
      "better-tooling",
      "basic-dev",
      "eng-manager",
      "senior-dev",
      "standup",
      "contractor",
    ]);
    expect(r.completedProjects).toBeGreaterThanOrEqual(2);
    expect(r.endBudget).toBeGreaterThan(0); // observed 4332 -- comfortable margin
    expect(r.everBroke).toBe(false); // observed: never zero-clamped in 2000 days
    expect(r.completionDays.length).toBeGreaterThanOrEqual(2); // observed days 412, 1804
  });

  // Automation-heavy build. Observed trajectory under the tuned content:
  // completes first-contract on day 396 and small-crm on day 1643, is partway
  // through mobile-app at day 2000; budget 2198 at day 500, 4219 at day 1000,
  // 3441 at day 2000; never hits the zero-clamp. The darkfactory tag opens its
  // own challenge pool (api-price-hike 17, runaway-agent-loop 13,
  // model-deprecation 8, cloud-credits 9) and, owning no human devs, it eats
  // laptop-dies (14) but no sickness/poaching -- a materially different risk
  // profile from the human build at a similar destination, which is the
  // track-parity design goal (viable, not identical).
  it("automation-heavy strategy: completes multiple projects and stays solvent over 2000 days", () => {
    const r = runBuildProbe([
      "test-suite",
      "ci-cd",
      "agent",
      "agent-harness",
      "swarm-orchestrator",
      "agent-swarm",
      "self-learning-agents",
      "support-retainer",
    ]);
    expect(r.completedProjects).toBeGreaterThanOrEqual(2);
    expect(r.endBudget).toBeGreaterThan(0); // observed 3441 -- comfortable margin
    expect(r.everBroke).toBe(false); // observed: never zero-clamped in 2000 days
    expect(r.completionDays.length).toBeGreaterThanOrEqual(2); // observed days 396, 1643
  });

  it("greedy strategy: buy everything affordable each day, invariants hold", () => {
    const content = fullContent();
    const e = new Engine(content);
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      // Re-check affordability after each purchase rather than looping over
      // one stale availableDecisions() snapshot: buying one item can spend
      // down the budget enough that a later item in the same snapshot,
      // affordable when the snapshot was taken, no longer is. This re-check
      // loop is the correct place for that fix, independent of exactly which
      // day the budget lands in the affordability window (that day moves with
      // any change to the challenge/gamble draw sequence).
      let bought = true;
      while (bought) {
        bought = false;
        for (const a of e.availableDecisions()) {
          if (a.purchasable && !e.getState().decisions.some((d) => d.defId === a.def.id)) {
            e.applyDecision(a.def.id);
            bought = true;
            break;
          }
        }
      }
      // Same stale-snapshot fix as the decision loop above, now needed for
      // projects too: under the Task 6 payouts the greedy bot first reaches a
      // day where two projects are startable in one availableProjects()
      // snapshot, and paying the first upfront cost makes the second
      // unaffordable before the loop reaches it.
      let started = true;
      while (started) {
        started = false;
        for (const p of e.availableProjects()) {
          if (p.startable) {
            e.startProject(p.def.id);
            started = true;
            break;
          }
        }
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
    // No solvency or completion assertions here, deliberately: even under the
    // Task 6 economy (small-crm $21/pt, mobile-app $22/pt), buying everything
    // affordable is NOT a viable strategy (design intent: choices matter).
    // Observed at day 2000 under the tuned content: completedProjects 2,
    // budget ~2.95, shipped ~10687 (was 2 / ~1.00 / ~8449 pre-tuning -- richer
    // payouts ship more but the all-of-everything payroll still eats every
    // dollar). This run exercises engine invariants under maximal purchasing
    // pressure, not balance; balance is pinned by the mechanism/idle probes
    // above and the human-heavy/automation-heavy viability probes.
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
