import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Engine } from "./engine";
import { parseStartConfig, parseDecisions } from "./content";
import { decisionsJson, loadShippedContent, startJson } from "./loadShippedContent";
import { INCOME_HISTORY_DAYS, PROJECT_DISPLAY_GRAIN, dailyExpenseSplit } from "./tick";
import { applyEffects } from "./effects";
import { effectiveRate } from "./modifiers";
import { unshippedWork, surplusWork } from "./work";
import type { GameContent, GameState, ProjectDef } from "./types";

export function testContent(): GameContent {
  return { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] };
}

// Real decisions (for ci-cd/test-suite), no challenges/projects so the
// continuous-deploy probes below are isolated from random events.
function ciCdContent(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("tick", () => {
  it("moves work at finish speed into In Review and keeps In Progress at founder capacity", () => {
    const e = new Engine(testContent());
    e.tick(); // day 1: finish 1 into In Review, seat 1 from Ready
    let s = e.getState();
    expect(s.stocks.backlog).toBe(298);
    expect(s.stocks.inProgress).toBe(1);
    expect(s.stocks.inReview).toBe(1);
    expect(s.stocks.done).toBe(0);
    expect(s.stocks.shipped).toBe(0);

    e.tick(); // day 2: review 1 into Done
    s = e.getState();
    expect(s.stocks.shipped).toBe(0);
    expect(s.pointsPerDay).toBe(0);
    expect(s.stocks.inReview).toBe(1);
    expect(s.stocks.done).toBe(1);
    expect(s.stocks.backlog).toBe(297);
    expect(s.stocks.inProgress).toBe(1);

    e.tick(); // day 3: first point ships
    s = e.getState();
    expect(s.stocks.shipped).toBe(1);
    expect(s.pointsPerDay).toBe(1);
    expect(s.stocks.done).toBe(1);
    expect(s.stocks.inReview).toBe(1);
  });

  it("persists realized pull/finish/review flow", () => {
    const e = new Engine(testContent());
    e.tick();
    let s = e.getState();
    expect(s.pullFlow).toBe(2);
    expect(s.finishFlow).toBe(1);
    expect(s.reviewFlow).toBe(0);
    expect(s.pointsPerDay).toBe(0);

    e.tick();
    s = e.getState();
    expect(s.pullFlow).toBe(1);
    expect(s.finishFlow).toBe(1);
    expect(s.reviewFlow).toBe(1);
    expect(s.pointsPerDay).toBe(0);
  });

  // Studio spine (AC2): tech debt STILL accrues before the first
  // project completes, but it does NOT refill the backlog yet -- the Launch
  // beta gets a clean 300-point burndown. First ship is day 3 (In Review lag).
  it("shipped points grow tech debt but do NOT refill the backlog before the first project completes", () => {
    const e = new Engine(testContent());
    e.tick();
    e.tick();
    e.tick(); // one point shipped (first ship is day 3), debt multiplier 0.5
    const s = e.getState();
    expect(s.stocks.techDebt).toBe(0.5);
    expect(s.completedProjects).toBe(0);
    expect(s.stocks.backlog).toBe(296);
  });

  // Once the first project has completed the debt->backlog refill turns on, so
  // a shipped point grows both techDebt and backlog again (the reinforcing
  // rework loop for every project after the beta). Isolated via the mutable
  // escape hatch: an empty backlog (no pull) and a done stock to ship, so the
  // only backlog change is the debt refill itself.
  it("refills the backlog with debt gain once completedProjects >= 1 (gate flips on)", () => {
    const gated = new Engine(testContent());
    const g = gated.getState() as GameState;
    g.stocks.backlog = 0;
    g.stocks.inProgress = 0;
    g.stocks.done = 10;
    g.completedProjects = 0; // gate closed
    gated.tick();
    expect(gated.getState().stocks.techDebt).toBeCloseTo(0.5, 10); // debt still accrues
    expect(gated.getState().stocks.backlog).toBe(0); // ...but no refill while gate is closed

    const open = new Engine(testContent());
    const o = open.getState() as GameState;
    o.stocks.backlog = 0;
    o.stocks.inProgress = 0;
    o.stocks.done = 10;
    o.completedProjects = 1; // gate open
    open.tick();
    expect(open.getState().stocks.backlog).toBeCloseTo(0.5, 10); // debt gain refilled the backlog
  });

  // Studio spine: the Launch beta is a $0-ish client fiction --
  // payoutPerPoint is 0 (money comes from the completion bonus + users
  // monetization, not per-point client revenue), so shipping a beta point pays
  // nothing and the budget is pure base-burn drawdown until completion.
  it("pays revenue per shipped point and charges base burn (Launch beta pays $0/pt)", () => {
    const e = new Engine(testContent());
    e.tick(); // no shipping yet: 10000 - 20 burn (release-7 baseBurnPerDay)
    expect(e.getState().stocks.budget).toBe(9980);
    e.tick();
    e.tick(); // ships 1 point at $0 (launch-beta payoutPerPoint): 10000 - 3*20 burn + 0
    expect(e.getState().stocks.budget).toBe(10000 - 60 + 0);
  });

  // Release 17: reputation is paid at the same completion point as the
  // budget bonus (attributeShipped's completion branch), from
  // ActiveProject.reputationReward (seeded from initialProject.reputationReward
  // for the starting project). Shrinks the initial project to complete fast,
  // matching the existing completion tests' pattern (see projects.test.ts).
  it("earns reputation on project completion, alongside the completion bonus", () => {
    const content = testContent();
    content.start.initialProject.sizePoints = 2;
    content.start.stocks.backlog = 2;
    const e = new Engine(content);
    expect(e.getState().stocks.reputation).toBe(0); // shipped start.json baseline
    for (let i = 0; i < 6; i++) e.tick(); // completes the tiny initial project
    const s = e.getState();
    expect(s.completedProjects).toBe(1);
    expect(s.stocks.reputation).toBe(content.start.initialProject.reputationReward);
    expect(s.log.some((l) => l.message.includes("reputation"))).toBe(true);
  });

  it("does nothing while paused", () => {
    const e = new Engine(testContent());
    e.pause();
    e.tick();
    expect(e.getState().day).toBe(0);
    e.resume();
    e.tick();
    expect(e.getState().day).toBe(1);
  });

  it("clamps flows so stocks never go negative", () => {
    const content = testContent();
    content.start.stocks.backlog = 0;
    const e = new Engine(content);
    for (let i = 0; i < 10; i++) e.tick();
    const s = e.getState();
    expect(s.stocks.backlog).toBeGreaterThanOrEqual(0);
    expect(s.stocks.inProgress).toBeGreaterThanOrEqual(0);
    expect(s.stocks.done).toBeGreaterThanOrEqual(0);
  });

  it("resumes deterministically from a saved state snapshot", () => {
    const a = new Engine(testContent());
    for (let i = 0; i < 5; i++) a.tick();
    const snapshot = structuredClone(a.getState()) as GameState;
    const b = new Engine(testContent(), snapshot);
    // Both engines resume from the same rngState, so their rng sequences
    // (and therefore all downstream state) must match tick for tick.
    for (let i = 0; i < 10; i++) {
      a.tick();
      b.tick();
    }
    expect(b.getState()).toEqual(a.getState());
  });

  // Studio spine: the users economy. Users stay 0 until the Launch
  // beta completes (its completionStockGrants add +30), organic acquisition is
  // gated on the first completion, and monetization decisions read the stock.
  describe("Studio users economy", () => {
    it("users stay 0 until the beta completes, then grant +30 and $800, and organic acquisition turns on", () => {
      const content = testContent(); // start.json: launch-beta, +30 users, +$800
      content.start.initialProject.sizePoints = 2;
      content.start.stocks.backlog = 2;
      const e = new Engine(content);

      // AC1: users are pinned at 0 for every tick before completion, even
      // though the organic stockFlow exists -- its minCompletedProjects gate
      // keeps it off until the beta ships.
      let completed = false;
      let budgetBeforeCompletion = 0;
      for (let i = 0; i < 20 && !completed; i++) {
        budgetBeforeCompletion = e.getState().stocks.budget;
        const usersBefore = e.getState().stocks.users;
        e.tick();
        const s = e.getState();
        if (s.completedProjects >= 1) {
          completed = true;
          // The completion tick grants +30 users and then runs one organic
          // day (grossGain 1.5 + reputation 1 * 0.1 = 1.6, churn 30 * 0.01 =
          // 0.3): 30 + 1.6 - 0.3 = 31.3.
          expect(s.stocks.users).toBeCloseTo(31.3, 5);
          expect(s.stocks.budget).toBeCloseTo(budgetBeforeCompletion - 20 + 800, 5); // +$800 bonus, -$20 burn
          expect(s.log.some((l) => l.message.includes("+30 users"))).toBe(true);
        } else {
          expect(usersBefore).toBe(0);
          expect(s.stocks.users).toBe(0);
        }
      }
      expect(completed).toBe(true);

      // Organic acquisition keeps growing users after launch (toward the ~160
      // steady state: 1.6/day gain vs 1% churn).
      const afterCompletion = e.getState().stocks.users;
      e.tick();
      expect(e.getState().stocks.users).toBeGreaterThan(afterCompletion);
    });

    it("in-flight version stockFlowMods do not apply; completed ones raise acquire off the churn cap", () => {
      const content = testContent();
      content.start.debtMultiplier = 0;
      const v1: ProjectDef = {
        id: "ship-v1",
        name: "Ship v1",
        sizePoints: 1,
        upfrontCost: 0,
        payoutPerPoint: 0,
        completionBonus: 0,
        reputationReward: 2,
        unique: true,
        completionStockGrants: [{ stock: "users", amount: 20 }],
        stockFlowMods: [{ stock: "users", acquirePerDayDelta: 1 }],
      };
      content.projects = [v1];
      const e = new Engine(content);
      const s = e.getState() as GameState;
      s.completedProjects = 1;
      s.completedProjectIds = ["launch-beta"];
      s.stocks.users = 160;
      s.stocks.reputation = 1;
      s.stocks.backlog = 0;
      s.stocks.inProgress = 0;
      s.stocks.done = 0;
      s.projects = [];

      e.tick();
      expect(e.getState().userAcquireFlow).toBeCloseTo(1.6, 5);
      expect(e.getState().userAcquireFlow - e.getState().userChurnFlow).toBeCloseTo(0, 1);

      s.projects = [
        {
          defId: "ship-v1",
          name: "Ship v1",
          remaining: 10,
          payoutPerPoint: 0,
          completionBonus: 0,
          reputationReward: 2,
          completionStockGrants: [{ stock: "users", amount: 20 }],
        },
      ];
      e.tick();
      expect(e.getState().completedProjectIds.includes("ship-v1")).toBe(false);
      expect(e.getState().userAcquireFlow).toBeCloseTo(1.6, 5);

      // Remaining must equal the Done pile so surplus does not eat ship credit.
      s.projects[0]!.remaining = 0.5;
      s.stocks.done = 0.5;
      e.tick();
      expect(e.getState().completedProjectIds).toContain("ship-v1");
      const after = e.getState();
      expect(after.stocks.reputation).toBe(3);
      expect(after.userAcquireFlow).toBeCloseTo(2.8, 5);
      expect(after.userAcquireFlow - after.userChurnFlow).toBeGreaterThan(0.5);

      const usersAtV1 = after.stocks.users;
      e.tick();
      expect(e.getState().stocks.users).toBeGreaterThan(usersAtV1);
    });

    it("later version lumps still grant users and stack another acquire nudge", () => {
      const content = testContent();
      content.start.debtMultiplier = 0;
      content.projects = [
        {
          id: "ship-v1",
          name: "Ship v1",
          sizePoints: 1,
          upfrontCost: 0,
          payoutPerPoint: 0,
          completionBonus: 0,
          reputationReward: 2,
          unique: true,
          completionStockGrants: [{ stock: "users", amount: 20 }],
          stockFlowMods: [{ stock: "users", acquirePerDayDelta: 1 }],
        },
        {
          id: "ship-v2",
          name: "Ship v2",
          sizePoints: 1,
          upfrontCost: 0,
          payoutPerPoint: 0,
          completionBonus: 0,
          reputationReward: 2,
          unique: true,
          requiresCompletedId: "ship-v1",
          completionStockGrants: [{ stock: "users", amount: 25 }],
          stockFlowMods: [{ stock: "users", acquirePerDayDelta: 1 }],
        },
      ];
      const e = new Engine(content);
      const s = e.getState() as GameState;
      s.completedProjects = 2;
      s.completedProjectIds = ["launch-beta", "ship-v1"];
      s.stocks.users = 180;
      s.stocks.reputation = 3;
      s.stocks.backlog = 0;
      s.stocks.inProgress = 0;
      s.stocks.done = 0.5;
      s.projects = [
        {
          defId: "ship-v2",
          name: "Ship v2",
          remaining: 0.5,
          payoutPerPoint: 0,
          completionBonus: 0,
          reputationReward: 2,
          completionStockGrants: [{ stock: "users", amount: 25 }],
        },
      ];

      const usersBeforeV2 = s.stocks.users;
      e.tick();
      const afterV2 = e.getState();
      expect(afterV2.completedProjectIds).toContain("ship-v2");
      expect(afterV2.stocks.users).toBeGreaterThan(usersBeforeV2 + 20);
      expect(afterV2.userAcquireFlow).toBeCloseTo(4.0, 5);
      expect(afterV2.userAcquireFlow - afterV2.userChurnFlow).toBeGreaterThan(0.5);
    });

    it("organic user acquire reads reputation but does not spend it", () => {
      const content = testContent();
      const e = new Engine(content);
      const s = e.getState() as GameState;
      s.completedProjects = 1;
      s.projects = [];
      s.stocks.backlog = 0;
      s.stocks.inProgress = 0;
      s.stocks.done = 0;
      s.stocks.reputation = 50;
      s.stocks.users = 100;
      e.tick();
      expect(e.getState().stocks.reputation).toBe(50);
      expect(e.getState().userAcquireFlow).toBeCloseTo(6.5, 5); // 1.5 + 50 × 0.1
    });

    it("completed v1–v5 at 0 reputation acquire at 6.5/day", () => {
      // Screenshot pin: Company idle after the product line, reputation 0,
      // organic 1.5 plus five version acquire nudges, no reputation term.
      const content = loadShippedContent("company");
      content.challenges = [];
      const e = new Engine(content);
      const s = e.getState() as GameState;
      s.completedProjects = 6;
      s.completedProjectIds = ["launch-beta", "ship-v1", "ship-v2", "ship-v3", "ship-v4", "ship-v5"];
      s.projects = [];
      s.plan = [];
      s.stocks.backlog = 0;
      s.stocks.inProgress = 0;
      s.stocks.done = 0;
      s.stocks.reputation = 0;
      s.stocks.users = 625.1;
      e.tick();
      expect(e.getState().stocks.reputation).toBe(0);
      expect(e.getState().userAcquireFlow).toBeCloseTo(6.5, 5);
    });

    it("subscription incomeFromStock scales income with the users stock", () => {
      const content = ciCdContent(); // real decisions incl. subscription
      content.start.stocks.backlog = 0; // no shipping revenue to muddy the probe
      const withSub = new Engine(content);
      const withoutSub = new Engine(content);
      withSub.applyDecision("subscription"); // -$500 oneTime
      for (const e of [withSub, withoutSub]) {
        (e.getState() as GameState).stocks.users = 100;
      }
      const subBudgetBefore = withSub.getState().stocks.budget;
      const noSubBudgetBefore = withoutSub.getState().stocks.budget;
      withSub.tick();
      withoutSub.tick();
      const subDelta = withSub.getState().stocks.budget - subBudgetBefore;
      const noSubDelta = withoutSub.getState().stocks.budget - noSubBudgetBefore;
      // The only difference is the subscription's incomeFromStock: 100 users *
      // $0.75/user/day = $75/day on top of whatever the no-sub engine did.
      expect(subDelta - noSubDelta).toBeCloseTo(75, 5);
      const day = withSub.getState().incomeByDay.at(-1);
      expect(day?.recurring).toBeCloseTo(75, 5);
      expect(day?.burst).toBe(0);
      expect(withSub.getState().log.some((l) => /\$/.test(l.message) && /burst|income|subscription/i.test(l.message))).toBe(false);
    });

    it("subscription earns nothing at zero users (useless until launch)", () => {
      const content = ciCdContent();
      content.start.stocks.backlog = 0;
      const e = new Engine(content);
      e.applyDecision("subscription");
      const before = e.getState().stocks.budget; // users still 0
      e.tick();
      // Pure base burn, no stock income: 0 users * 0.75 = 0.
      expect(e.getState().stocks.budget).toBe(before - content.start.baseBurnPerDay);
    });

    it("one-time-product consumes no RNG and pays nothing while users are 0", () => {
      const content = ciCdContent();
      content.start.stocks.backlog = 0;
      const withOtp = new Engine(content);
      const withoutOtp = new Engine(content);
      withOtp.applyDecision("one-time-product");
      expect(withOtp.getState().rngState).toBe(withoutOtp.getState().rngState);

      for (let i = 0; i < 50; i++) {
        const before = withOtp.getState().stocks.budget;
        withOtp.tick();
        withoutOtp.tick();
        expect(withOtp.getState().stocks.users).toBe(0);
        expect(withOtp.getState().userIncomeFlow).toBe(0);
        expect(withOtp.getState().stocks.budget).toBe(before - content.start.baseBurnPerDay);
        expect(withOtp.getState().log.some((l) => l.message.includes("product sale burst"))).toBe(false);
        expect(withOtp.getState().incomeByDay.at(-1)?.burst).toBe(0);
        expect(withOtp.getState().rngState).toBe(withoutOtp.getState().rngState);
      }
    });

    it("one-time-product burstFromStock is per-user sales, not an all-or-nothing lump", () => {
      const content = ciCdContent();
      content.start.stocks.backlog = 0;
      const e = new Engine(content);
      e.applyDecision("one-time-product");
      const sale = 1.2;
      const users = 100;
      let daysWithSales = 0;
      let totalBurst = 0;
      const seenAmounts = new Set<number>();
      for (let i = 0; i < 300; i++) {
        (e.getState() as GameState).stocks.users = users;
        e.tick();
        const burst = e.getState().incomeByDay.at(-1)?.burst ?? 0;
        totalBurst += burst;
        if (burst > 0) {
          daysWithSales += 1;
          seenAmounts.add(Number(burst.toFixed(5)));
          expect(burst / sale).toBeCloseTo(Math.round(burst / sale), 5);
          expect(burst).toBeLessThanOrEqual(users * sale + 1e-9);
        }
      }
      // Independent 8% rolls: almost every day has at least one sale
      // (P(none) = 0.92^100), and receipts are k × $1.20, not a single $120 lump.
      expect(daysWithSales).toBeGreaterThan(250);
      expect(seenAmounts.size).toBeGreaterThan(1);
      expect(seenAmounts.has(120)).toBe(false);
      expect(totalBurst / 300).toBeCloseTo(users * 0.08 * sale, 0);
      expect(e.getState().log.some((l) => l.message.includes("product sale burst"))).toBe(false);
    });

    it("one-time-product still pays occasional sales when the user base is small", () => {
      const content = ciCdContent();
      content.start.stocks.backlog = 0;
      const e = new Engine(content);
      e.applyDecision("one-time-product");
      let daysWithSales = 0;
      let maxBurst = 0;
      for (let i = 0; i < 400; i++) {
        (e.getState() as GameState).stocks.users = 3;
        e.tick();
        const burst = e.getState().incomeByDay.at(-1)?.burst ?? 0;
        if (burst > 0) daysWithSales += 1;
        maxBurst = Math.max(maxBurst, burst);
      }
      // 3 users × 8%: most days are quiet, but some sales still land, and a
      // hit is 1–3 add-ons ($1.20–$3.60), not a $3.60 company-wide lump every time.
      expect(daysWithSales).toBeGreaterThan(20);
      expect(daysWithSales).toBeLessThan(200);
      expect(maxBurst).toBeLessThanOrEqual(3 * 1.2 + 1e-9);
    });

    it("caps incomeByDay at INCOME_HISTORY_DAYS", () => {
      const e = new Engine(testContent());
      for (let i = 0; i < INCOME_HISTORY_DAYS + 5; i++) e.tick();
      const days = e.getState().incomeByDay;
      expect(days).toHaveLength(INCOME_HISTORY_DAYS);
      expect(days[0]!.day).toBe(e.getState().day - INCOME_HISTORY_DAYS + 1);
      expect(days.at(-1)!.day).toBe(e.getState().day);
    });

    it("splits expenses into human, agent copies, and misc (shop floor plus other perDay)", () => {
      const content = ciCdContent();
      const e = new Engine(content);
      expect(dailyExpenseSplit(e.getState(), content)).toEqual({ human: 0, agents: 0, misc: 20 });
      e.applyDecision("basic-dev");
      e.applyDecision("agent");
      e.applyDecision("agent");
      e.applyDecision("agent-harness");
      expect(dailyExpenseSplit(e.getState(), content)).toEqual({ human: 438, agents: 8, misc: 25 });
    });

    it("records expensesByDay on tick and caps it with income history", () => {
      const content = ciCdContent();
      const e = new Engine(content);
      e.applyDecision("agent");
      e.tick();
      expect(e.getState().expensesByDay.at(-1)).toEqual({ day: 1, human: 0, agents: 4, misc: 20 });
      for (let i = 0; i < INCOME_HISTORY_DAYS + 2; i++) e.tick();
      const days = e.getState().expensesByDay;
      expect(days).toHaveLength(INCOME_HISTORY_DAYS);
      expect(days.at(-1)!.day).toBe(e.getState().day);
    });
  });

  describe("continuous deploy (ci-cd owned)", () => {
    it("ships the entire done stock every tick once active, so done never queues beyond the current tick's review output", () => {
      const content = ciCdContent();
      const e = new Engine(content);
      e.applyDecision("test-suite");
      e.applyDecision("ci-cd");
      for (let day = 1; day <= 20; day++) {
        const before = e.getState();
        const inReviewBefore = before.stocks.inReview;
        const doneBefore = before.stocks.done;
        const shippedBefore = before.stocks.shipped;
        e.tick();
        const after = e.getState();
        const expectedReviewFlow = Math.min(inReviewBefore, effectiveRate(after, "review"));
        const expectedFinishFlow = Math.min(
          before.stocks.inProgress + before.stocks.backlog,
          effectiveRate(after, "finish"),
        );
        expect(after.stocks.shipped, `day ${day}`).toBeCloseTo(shippedBefore + doneBefore, 10);
        expect(after.stocks.done, `day ${day}`).toBeCloseTo(expectedReviewFlow, 10);
        expect(after.stocks.inReview, `day ${day}`).toBeCloseTo(inReviewBefore - expectedReviewFlow + expectedFinishFlow, 10);
      }
    });

    // Pins the exact same-tick ordering for a done stock that already had
    // work queued up before continuous deploy's first tick under it (e.g.
    // work that finished the same day ci-cd was bought, before it flows
    // through as "owned at tick time"). Manufactures that state directly
    // via the mutable escape hatch (getState()'s Readonly is shallow and
    // compile-time only -- see engine.ts) rather than deriving it from many
    // ticks, to isolate the ordering guarantee from unrelated arithmetic.
    it("ships a pre-existing done stock in full immediately; that same tick's review output waits until next tick", () => {
      const content = ciCdContent();
      const e = new Engine(content);
      e.applyDecision("test-suite"); // budget 10000 -> 9500
      e.applyDecision("ci-cd"); // budget 9500 -> 8750
      const state = e.getState() as GameState;
      state.stocks.done = 5;
      state.stocks.inReview = 1000;
      state.stocks.inProgress = 1000; // guarantee finishFlow is rate-limited, not stock-limited
      const shippedBefore = state.stocks.shipped;

      e.tick(); // day 1: both temp slowdowns still active (expire day 6 and day 2)
      const s = e.getState();
      // reviewRate this tick: base 1.0 * test-suite's 0.5 * ci-cd's 0.5 = 0.25.
      expect(s.stocks.shipped - shippedBefore).toBe(5);
      expect(s.stocks.done).toBe(0.25); // this tick's review output only -- not shipped this tick
      expect(s.stocks.inReview).toBeCloseTo(1000 - 0.25 + 0.25, 10); // reviewed 0.25, finished 0.25
      expect(s.pointsPerDay).toBe(5);
    });
  });

  // Release 15 deploy-bottleneck rework: dev/contractor hires boost pull and
  // finish only, no longer deploy. So a strong human build without ci-cd
  // outruns its own deploy stage -- Done piles up and shipping stays pinned at
  // the base deploy rate -- and ci-cd (continuous deploy) becomes the scaling
  // unlock. Injects a "strong dev" (pull+finish +2 each, rates 3/3/1) directly
  // via the mutable-state escape hatch so the probe is isolated from gamble rng
  // and purchase-time setup slowdowns.
  describe("review bottleneck without a review card", () => {
    function injectStrongDev(e: Engine): GameState {
      const s = e.getState() as GameState;
      s.decisions.push({ instanceId: "inst-dev", defId: "basic-dev" });
      s.modifiers.push(
        { id: "m-pull", source: "inst-dev", target: "pull", op: "add", value: 2 },
        { id: "m-fin", source: "inst-dev", target: "finish", op: "add", value: 2 },
      );
      return s;
    }

    it("caps shipping at the base review rate while In Review piles up when no review card exists", () => {
      const e = new Engine(ciCdContent());
      injectStrongDev(e); // rates: pull 3, finish 3, review 1, deploy 1
      for (let i = 0; i < 5; i++) e.tick(); // warm the pipeline
      const reviewStart = e.getState().stocks.inReview;
      let shippedDelta = 0;
      for (let i = 0; i < 10; i++) {
        const before = e.getState().stocks.shipped;
        e.tick();
        shippedDelta += e.getState().stocks.shipped - before;
        expect(e.getState().pointsPerDay).toBeCloseTo(1, 10); // review-then-deploy bound at 1/day
      }
      const s = e.getState();
      expect(shippedDelta).toBeCloseTo(10, 10);
      expect(s.stocks.inReview).toBeGreaterThan(reviewStart + 15);
    });

    it("still ships at the review rate once ci-cd is owned (Done drops; In Review stays)", () => {
      const e = new Engine(ciCdContent());
      const s = injectStrongDev(e);
      s.decisions.push({ instanceId: "inst-cicd", defId: "ci-cd" });
      for (let i = 0; i < 6; i++) e.tick();
      for (let i = 0; i < 5; i++) {
        e.tick();
        expect(e.getState().pointsPerDay).toBeCloseTo(1, 10); // tracks review, not finish
      }
      expect(e.getState().stocks.done).toBeCloseTo(1, 10); // latest tick's review output waits for CD
    });

    it("orchestration plus ci-cd ships above founder review", () => {
      const e = new Engine(ciCdContent());
      const s = injectStrongDev(e);
      s.decisions.push({ instanceId: "inst-cicd", defId: "ci-cd" });
      s.decisions.push({ instanceId: "inst-orch", defId: "agent-orchestration" });
      s.modifiers.push({ id: "m-rev", source: "inst-orch", target: "review", op: "mul", value: 1.45 });
      expect(effectiveRate(e.getState(), "review")).toBeCloseTo(1.45, 5);
      for (let i = 0; i < 6; i++) e.tick();
      for (let i = 0; i < 5; i++) {
        e.tick();
        expect(e.getState().pointsPerDay).toBeCloseTo(1.45, 10);
      }
    });
  });

  describe("invisible remaining does not delay completion grants", () => {
    function inFlightRefactor(remaining: number): GameState["projects"][number] {
      return {
        defId: "small-refactor",
        name: "Small refactor",
        remaining,
        payoutPerPoint: 0,
        completionBonus: 0,
        reputationReward: 0,
        completionStockGrants: [{ stock: "techDebt", amount: -50 }],
      };
    }

    function seedInvisibleTail(e: Engine, remaining: number, stage: "backlog" | "inReview" | "done" = "backlog"): GameState {
      const s = e.getState() as GameState;
      s.completedProjects = 1;
      s.completedProjectIds = ["launch-beta"];
      s.projects = [inFlightRefactor(remaining)];
      s.stocks.backlog = 0;
      s.stocks.inProgress = 0;
      s.stocks.inReview = 0;
      s.stocks.done = 0;
      s.stocks[stage] = remaining;
      s.stocks.techDebt = 251.5;
      s.debtMultiplierBase = 0.2;
      return s;
    }

    it("snap-completes remaining below the 1-decimal display grain on the next tick", () => {
      const e = new Engine(testContent());
      seedInvisibleTail(e, 0.04, "backlog");
      const unshippedBefore = unshippedWork(e.getState());
      e.tick();
      const after = e.getState();
      expect(after.completedProjectIds).toContain("small-refactor");
      expect(after.projects).toHaveLength(0);
      // No ship this tick: grant only, no debt refill.
      expect(after.stocks.techDebt).toBeCloseTo(201.5, 8);
      // Crumbs stay in the pipe as surplus (Ready emptied into In Review this tick).
      expect(unshippedWork(after)).toBeCloseTo(unshippedBefore, 8);
      expect(surplusWork(after)).toBeCloseTo(unshippedWork(after), 8);
    });

    it(`keeps remaining at the grain (${PROJECT_DISPLAY_GRAIN}), which the UI paints as 0.1`, () => {
      const e = new Engine(testContent());
      seedInvisibleTail(e, PROJECT_DISPLAY_GRAIN, "backlog");
      e.tick();
      const after = e.getState();
      expect(after.completedProjectIds).not.toContain("small-refactor");
      expect(after.projects).toHaveLength(1);
      expect(after.projects[0]!.remaining).toBeCloseTo(PROJECT_DISPLAY_GRAIN, 10);
      expect(after.stocks.techDebt).toBeCloseTo(251.5, 8);
    });

    it("does not wait for crumbs to walk review and deploy before paying the grant", () => {
      const e = new Engine(testContent());
      seedInvisibleTail(e, 0.04, "backlog");
      e.tick();
      expect(e.getState().completedProjectIds).toContain("small-refactor");
      expect(e.getState().stocks.inReview).toBeCloseTo(0.04, 8);
      expect(e.getState().stocks.done).toBe(0);
      expect(e.getState().pointsPerDay).toBe(0);
    });

    it("does not pay leftover payoutPerPoint for snapped crumbs", () => {
      const e = new Engine(testContent());
      const s = seedInvisibleTail(e, 0.04, "backlog");
      s.projects[0]!.payoutPerPoint = 18;
      const budgetBefore = s.stocks.budget;
      e.tick();
      const after = e.getState();
      expect(after.completedProjectIds).toContain("small-refactor");
      expect(after.stocks.budget).toBeCloseTo(budgetBefore - after.baseBurnPerDay, 8);
    });

    it("lets debt attach lift remaining back over the grain instead of snapping", () => {
      const e = new Engine(testContent());
      const s = e.getState() as GameState;
      s.completedProjects = 1;
      s.completedProjectIds = ["launch-beta"];
      s.projects = [inFlightRefactor(1.04)];
      s.stocks.backlog = 0;
      s.stocks.inProgress = 0;
      s.stocks.inReview = 0;
      s.stocks.done = 1;
      s.stocks.techDebt = 100;
      s.debtMultiplierBase = 0.5;
      e.tick();
      const after = e.getState();
      // Ship 1 → remaining 0.04, then +0.5 debt attach → 0.54, still visible.
      expect(after.completedProjectIds).not.toContain("small-refactor");
      expect(after.projects[0]!.remaining).toBeCloseTo(0.54, 8);
    });
  });

  // chargeUpkeep used to clamp budget to 0 against baseBurnPerDay
  // BEFORE crediting income, instead of netting burn against income in the
  // same step. Once budget had already been driven to 0, that clamp threw away
  // the burn deficit entirely, so any owned income decision got added on top
  // of a clean 0 with nothing left to net against -- turning insolvency into a
  // permanent, risk-free income stream instead of the intended steady 0.
  // Probed here with the subscription card at 10 users ($7.50/day, well under the $20/day burn); lean shop dropped support-retainer, the
  // flat-incomePerDay card this test used to buy, and the netting is the same
  // for either income shape.
  describe("insolvency does not monetize owned income decisions", () => {
    it("stabilizes budget at 0, not at the income amount, once burn has driven the player insolvent", () => {
      const content = ciCdContent();
      // No pipeline flow at all, so no shipped-point revenue can leak into
      // budget and contaminate the probe: this isolates chargeUpkeep's
      // burn-vs-income netting from attributeShipped entirely.
      content.start.stocks.backlog = 0;
      const e = new Engine(content);
      e.applyDecision("subscription"); // $0.75/user/day, no perDay payroll cost
      const state = e.getState() as GameState;
      state.stocks.users = 10; // income 7.5/day, below the 20/day burn
      state.stocks.budget = 0; // manufacture insolvency directly, matching this file's other escape-hatch tests

      for (let day = 1; day <= 5; day++) {
        e.tick();
        // Buggy code stabilizes at the income amount (7.5) from day 1 onward;
        // the fix must keep netting burn (20) against income (7.5) before the
        // zero-floor clamp, so budget stays pinned at 0.
        expect(e.getState().stocks.budget, `day ${day}`).toBe(0);
      }
    });
  });

  // Budget is clamped at 0; insolvency used to leave pull/finish/deploy
  // running, so cockpit Backlog and in-flight remaining kept burning down
  // while the wallet showed $0. Freeze delivery for any tick that starts
  // already at 0. Day, income netting, and payroll failure still run.
  // Work resumes on the next tick after budget is positive again.
  describe("delivery freezes while budget is 0", () => {
    it("does not pull, finish, or deploy, and does not burn down remaining", () => {
      const e = new Engine(testContent());
      const s = e.getState() as GameState;
      s.stocks.budget = 0;
      const remainingBefore = s.projects[0]!.remaining;
      expect(e.isDeliveryFrozen()).toBe(true);

      e.tick();
      e.tick();
      e.tick();

      const after = e.getState();
      expect(after.day).toBe(3);
      expect(after.stocks.budget).toBe(0);
      expect(after.stocks.backlog).toBe(300);
      expect(after.stocks.inProgress).toBe(0);
      expect(after.stocks.inReview).toBe(0);
      expect(after.stocks.done).toBe(0);
      expect(after.stocks.shipped).toBe(0);
      expect(after.pointsPerDay).toBe(0);
      expect(after.pullFlow).toBe(0);
      expect(after.finishFlow).toBe(0);
      expect(after.reviewFlow).toBe(0);
      expect(after.projects[0]!.remaining).toBe(remainingBefore);
    });

    it("leaves work already in In Progress, In Review, and Done unmoved", () => {
      const e = new Engine(testContent());
      const s = e.getState() as GameState;
      s.stocks.budget = 0;
      s.stocks.backlog = 10;
      s.stocks.inProgress = 8;
      s.stocks.inReview = 4;
      s.stocks.done = 5;
      s.projects[0]!.remaining = 27;

      e.tick();

      const after = e.getState();
      expect(after.stocks.backlog).toBe(10);
      expect(after.stocks.inProgress).toBe(8);
      expect(after.stocks.inReview).toBe(4);
      expect(after.stocks.done).toBe(5);
      expect(after.stocks.shipped).toBe(0);
      expect(after.projects[0]!.remaining).toBe(27);
    });

    it("resumes pipeline flow once budget is positive again", () => {
      const e = new Engine(testContent());
      (e.getState() as GameState).stocks.budget = 0;
      e.tick();
      expect(e.getState().stocks.backlog).toBe(300);

      (e.getState() as GameState).stocks.budget = 10000;
      e.tick();
      expect(e.getState().stocks.backlog).toBe(298);
      expect(e.getState().stocks.inProgress).toBe(1);
    });

    it("still removes unpaid payroll while delivery is frozen", () => {
      const c = ciCdContent();
      c.start.stocks.budget = 0;
      const e = new Engine(c);
      e.applyDecision("basic-dev");
      expect(e.getState().decisions).toHaveLength(1);

      e.tick();

      expect(e.getState().decisions).toHaveLength(0);
      expect(e.getState().stocks.backlog).toBe(300);
      expect(e.getState().log.some((l) => l.message.includes("Payroll failed"))).toBe(true);
    });

    it("does not dump Done through continuous deploy while budget is 0", () => {
      const e = new Engine(ciCdContent());
      const s = e.getState() as GameState;
      s.stocks.budget = 0;
      s.stocks.backlog = 0;
      s.stocks.inProgress = 0;
      s.stocks.done = 10;
      s.projects[0]!.remaining = 10;
      s.decisions.push({ instanceId: "inst-cicd", defId: "ci-cd" });

      e.tick();

      expect(e.getState().stocks.done).toBe(10);
      expect(e.getState().stocks.shipped).toBe(0);
      expect(e.getState().pointsPerDay).toBe(0);
      expect(e.getState().projects[0]!.remaining).toBe(10);
    });
  });

  // Ideas stock + discover faucet: a pile that starts at 100 and fills
  // from day 0 so late offers are not free. Ideas is a stock, not a
  // pipeline stage; tech-debt regen still refills Ready.
  describe("Ideas stock and discover faucet", () => {
    it("seeds Ideas at 100 on day 0", () => {
      const e = new Engine(testContent());
      expect(e.getState().day).toBe(0);
      expect(e.getState().stocks.ideas).toBe(100);
      expect(e.getState().baseRates.discover).toBe(0.5);
    });

    it("after 10 days with no other modifiers, Ideas is 105", () => {
      const e = new Engine(testContent());
      for (let i = 0; i < 10; i++) e.tick();
      expect(e.getState().day).toBe(10);
      expect(e.getState().stocks.ideas).toBeCloseTo(105, 10);
    });

    it("does not scale discover with reputation, users, or shipped points", () => {
      const boosted = new Engine(testContent());
      const baseline = new Engine(testContent());
      const s = boosted.getState() as GameState;
      s.stocks.reputation = 70;
      s.stocks.users = 500;
      s.stocks.shipped = 10_000;
      for (let i = 0; i < 10; i++) {
        boosted.tick();
        baseline.tick();
      }
      expect(boosted.getState().stocks.ideas).toBeCloseTo(baseline.getState().stocks.ideas, 10);
      expect(boosted.getState().stocks.ideas).toBeCloseTo(105, 10);
    });

    it("an add-to-discover modifier raises the faucet", () => {
      const e = new Engine(testContent());
      applyEffects(e.getState() as GameState, [{ type: "modifyRate", target: "discover", op: "add", value: 1.5 }], "stub-card");
      expect(effectiveRate(e.getState(), "discover")).toBeCloseTo(2.0, 10);
      for (let i = 0; i < 10; i++) e.tick();
      // 100 + (0.5 + 1.5) * 10
      expect(e.getState().stocks.ideas).toBeCloseTo(120, 10);
    });

    it("buying hack day grants 50 Ideas, slows delivery 70% for one felt day, and does not raise discover or plan", () => {
      const e = new Engine(ciCdContent());
      expect(effectiveRate(e.getState(), "pull")).toBe(2);
      expect(effectiveRate(e.getState(), "discover")).toBeCloseTo(0.5, 10);
      expect(effectiveRate(e.getState(), "plan")).toBe(1);
      e.applyDecision("hack-day");
      expect(e.getState().stocks.ideas).toBe(150);
      expect(effectiveRate(e.getState(), "pull")).toBeCloseTo(0.6, 10); // 2 * 0.3
      expect(effectiveRate(e.getState(), "finish")).toBeCloseTo(0.3, 10);
      expect(effectiveRate(e.getState(), "review")).toBeCloseTo(0.3, 10);
      expect(effectiveRate(e.getState(), "deploy")).toBeCloseTo(0.3, 10);
      expect(effectiveRate(e.getState(), "discover")).toBeCloseTo(0.5, 10);
      expect(effectiveRate(e.getState(), "plan")).toBe(1);
      e.tick(); // felt day: still slowed
      expect(e.getState().day).toBe(1);
      expect(effectiveRate(e.getState(), "pull")).toBeCloseTo(0.6, 10);
      expect(e.getState().stocks.ideas).toBeCloseTo(150.5, 10);
      e.tick(); // durationDays 2 expires at the start of day 2
      expect(e.getState().day).toBe(2);
      expect(effectiveRate(e.getState(), "pull")).toBe(2);
      expect(effectiveRate(e.getState(), "discover")).toBeCloseTo(0.5, 10);
      expect(effectiveRate(e.getState(), "plan")).toBe(1);
    });

    it("buying user interviews grants 200 Ideas without changing delivery, discover, or plan", () => {
      const e = new Engine(ciCdContent());
      const pull = effectiveRate(e.getState(), "pull");
      const discover = effectiveRate(e.getState(), "discover");
      const plan = effectiveRate(e.getState(), "plan");
      e.applyDecision("user-interviews");
      expect(e.getState().stocks.ideas).toBe(300);
      expect(e.getState().stocks.budget).toBe(9000);
      expect(effectiveRate(e.getState(), "pull")).toBe(pull);
      expect(effectiveRate(e.getState(), "discover")).toBe(discover);
      expect(effectiveRate(e.getState(), "plan")).toBe(plan);
    });

    it("does not branch on eraId", () => {
      const src = readFileSync(join(__dirname, "tick.ts"), "utf-8");
      expect(src).not.toMatch(/\beraId\b/);

      const studio = new Engine(testContent());
      const otherEra = new Engine(testContent());
      (otherEra.getState() as GameState).eraId = "company";
      for (let i = 0; i < 10; i++) {
        studio.tick();
        otherEra.tick();
      }
      expect(otherEra.getState().stocks.ideas).toBeCloseTo(studio.getState().stocks.ideas, 10);
      expect(otherEra.getState().stocks.ideas).toBeCloseTo(105, 10);
    });

    it("clamps Ideas at 0 like other stocks", () => {
      const e = new Engine(testContent());
      const s = e.getState() as GameState;
      s.stocks.ideas = 0;
      applyEffects(s, [{ type: "modifyRate", target: "discover", op: "add", value: -5 }], "drain");
      e.tick();
      expect(e.getState().stocks.ideas).toBe(0);
    });

    it("tech-debt regen still refills Ready, not Ideas", () => {
      const e = new Engine(testContent());
      const s = e.getState() as GameState;
      s.completedProjects = 1;
      s.stocks.backlog = 0;
      s.stocks.inProgress = 0;
      s.stocks.done = 10;
      s.stocks.ideas = 100;
      e.tick();
      // Deploy 1 of the 10 Done; debt multiplier 0.5 -> 0.5 refilled into Ready.
      expect(e.getState().stocks.backlog).toBeCloseTo(0.5, 10);
      expect(e.getState().stocks.ideas).toBeCloseTo(100.5, 10);
    });

    it("keeps filling Ideas while delivery is frozen at $0", () => {
      const e = new Engine(testContent());
      (e.getState() as GameState).stocks.budget = 0;
      e.tick();
      expect(e.getState().stocks.backlog).toBe(300);
      expect(e.getState().stocks.ideas).toBeCloseTo(100.5, 10);
    });
  });
});
