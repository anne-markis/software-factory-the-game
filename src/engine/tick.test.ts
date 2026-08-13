import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { parseStartConfig, parseDecisions } from "./content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import { effectiveRate } from "./modifiers";
import type { GameContent, GameState } from "./types";

export function testContent(): GameContent {
  return { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] };
}

// Real decisions (for ci-cd/test-suite), no challenges/projects so the
// continuous-deploy probes below are isolated from random events.
function ciCdContent(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("tick", () => {
  // Base rates are pull 2, finish 1, deploy 1 (issue #89 gave pull headroom so
  // the finish-side agent ladder has a stage to feed), so the stages do NOT move
  // in lockstep: pull runs at twice the pace the rest of the line can absorb and
  // In Progress grows, which is the loop diagram's "growing box marks the
  // bottleneck" telling the player where to spend.
  it("moves points downstream at base rates, with pull outrunning finish", () => {
    const e = new Engine(testContent());
    e.tick(); // day 1: pull moves 2 points into inProgress
    let s = e.getState();
    expect(s.stocks.backlog).toBe(298); // Studio start backlog 300
    expect(s.stocks.inProgress).toBe(2);
    expect(s.stocks.shipped).toBe(0);

    e.tick(); // day 2: finish moves its first point to done
    e.tick(); // day 3: first point ships (downstream-first prevents same-day pass-through)
    s = e.getState();
    expect(s.stocks.shipped).toBe(1);
    expect(s.pointsPerDay).toBe(1); // throughput is the slowest stage, not pull
    // Pull has put 6 points in; finish has only pulled 2 of them through, so the
    // surplus sits in In Progress.
    expect(s.stocks.backlog).toBe(294);
    expect(s.stocks.inProgress).toBe(4);
    expect(s.stocks.done).toBe(1);
  });

  // Issue #9: pullFlow/finishFlow mirror pointsPerDay's realized-flow
  // semantics (capped by the stock actually available that tick, not the
  // stage's uncapped rate) for the other two stages, so the loop diagram and
  // in-progress panel can show what actually moved instead of raw capacity.
  it("persists realized pull/finish flow, capped by the stock actually available that tick", () => {
    const e = new Engine(testContent());
    e.tick(); // day 1: the backlog is plentiful, so pull saturates its 2.0/day
    // capacity; but inProgress/done both started at 0, so finish and deploy
    // had nothing to move yet -- their realized flow is genuinely 0.
    let s = e.getState();
    expect(s.pullFlow).toBe(2);
    expect(s.finishFlow).toBe(0);
    expect(s.pointsPerDay).toBe(0);

    e.tick(); // day 2: the points pulled on day 1 are now in inProgress, so finish
    // has something to move -- capped at its own 1.0/day, not the 2 waiting.
    s = e.getState();
    expect(s.pullFlow).toBe(2);
    expect(s.finishFlow).toBe(1);
  });

  // Studio spine (issue #88, AC2): tech debt STILL accrues before the first
  // project completes, but it does NOT refill the backlog yet -- the Launch
  // beta gets a clean 300-point burndown. So after 3 ticks the shipped point
  // grows techDebt by 0.5 but the backlog is pure pull drawdown (300 - 6 at the
  // 2.0/day base pull), with no debt added back (completedProjects is still 0).
  it("shipped points grow tech debt but do NOT refill the backlog before the first project completes", () => {
    const e = new Engine(testContent());
    e.tick();
    e.tick();
    e.tick(); // 1 point shipped, debt multiplier 0.5
    const s = e.getState();
    expect(s.stocks.techDebt).toBe(0.5); // debt accrues pre-launch
    expect(s.completedProjects).toBe(0); // the 300-pt beta is nowhere near done
    expect(s.stocks.backlog).toBe(294); // 300 - 6 pulled; NO debt refill yet (the gate)
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

  // Studio spine (issue #88): the Launch beta is a $0-ish client fiction --
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
  // matching the existing FIFO-completion tests' pattern (see projects.test.ts).
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

  // Studio spine (issue #88): the users economy. Users stay 0 until the Launch
  // beta completes (its completionStockGrants add +30), organic acquisition is
  // gated on the first completion, and monetization decisions read the stock.
  describe("Studio users economy (issue #88)", () => {
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

    it("one-time-product burstFromStock produces probabilistic income scaled by users", () => {
      const content = ciCdContent();
      content.start.stocks.backlog = 0;
      const e = new Engine(content);
      e.applyDecision("one-time-product");
      (e.getState() as GameState).stocks.users = 100; // burst = 100 * 1.2 = $120 on a hit
      let bursts = 0;
      for (let i = 0; i < 300; i++) {
        (e.getState() as GameState).stocks.users = 100; // hold users flat to isolate the burst
        const before = e.getState().stocks.budget;
        e.tick();
        // A burst day nets +$120 income - $20 burn = +$100; a quiet day is -$20.
        if (e.getState().stocks.budget > before) bursts += 1;
      }
      // At probabilityPerDay 0.08 over 300 days, expect ~24 bursts; assert some
      // fired and that the burst was logged.
      expect(bursts).toBeGreaterThan(5);
      expect(e.getState().log.some((l) => l.message.includes("product sale burst"))).toBe(true);
    });
  });

  describe("continuous deploy (ci-cd owned)", () => {
    it("ships the entire done stock every tick once active, so done never queues beyond the current tick's finish output", () => {
      const content = ciCdContent();
      const e = new Engine(content);
      e.applyDecision("test-suite");
      e.applyDecision("ci-cd");
      // Runs through both temporary setup slowdowns (test-suite expires day
      // 6, ci-cd's expires day 2) and into the settled, unmodified-rate
      // regime, checking the invariant holds throughout, not just at steady
      // state. effectiveRate is an independent oracle here (it is exercised
      // directly elsewhere) for what finishRate/pullRate are -- unaffected
      // by this feature -- so the only thing genuinely under test is
      // tick.ts's continuous-deploy branch: shippedFlow == the pre-tick
      // done stock (ignoring deployRate), and this same tick's finish
      // output is NOT included in that same ship (it lands in done, to
      // ship next tick instead).
      for (let day = 1; day <= 20; day++) {
        const before = e.getState();
        const inProgressBefore = before.stocks.inProgress;
        const doneBefore = before.stocks.done;
        const shippedBefore = before.stocks.shipped;
        e.tick();
        const after = e.getState();
        // The finish rate is read AFTER the tick: expired modifiers are pruned
        // at the START of a tick (the day increments first), so the post-tick
        // modifier set is the one this tick actually ran on, while the pre-tick
        // set still holds a modifier expiring on this very day. Nothing else
        // moves the rate here -- debt stays far below freeDebt and there are no
        // projects, so no drag is in play.
        const expectedFinishFlow = Math.min(inProgressBefore, effectiveRate(after, "finish"));
        expect(after.stocks.shipped, `day ${day}`).toBeCloseTo(shippedBefore + doneBefore, 10);
        expect(after.stocks.done, `day ${day}`).toBeCloseTo(expectedFinishFlow, 10);
      }
    });

    // Pins the exact same-tick ordering for a done stock that already had
    // work queued up before continuous deploy's first tick under it (e.g.
    // work that finished the same day ci-cd was bought, before it flows
    // through as "owned at tick time"). Manufactures that state directly
    // via the mutable escape hatch (getState()'s Readonly is shallow and
    // compile-time only -- see engine.ts) rather than deriving it from many
    // ticks, to isolate the ordering guarantee from unrelated arithmetic.
    it("ships a pre-existing done stock in full immediately; that same tick's finish output waits until next tick", () => {
      const content = ciCdContent();
      const e = new Engine(content);
      e.applyDecision("test-suite"); // budget 10000 -> 9500
      e.applyDecision("ci-cd"); // budget 9500 -> 8750
      const state = e.getState() as GameState;
      state.stocks.done = 5;
      state.stocks.inProgress = 1000; // guarantee finishFlow is rate-limited, not stock-limited
      const shippedBefore = state.stocks.shipped;

      e.tick(); // day 1: both temp slowdowns still active (expire day 6 and day 2)
      const s = e.getState();
      // finishRate this tick: base 1.0 * test-suite's 0.5 (mul, expires day
      // 6) * ci-cd's temporary 0.5 setup slowdown (mul, expires day 2) = 0.25.
      expect(s.stocks.shipped - shippedBefore).toBe(5); // the entire pre-existing done stock, exactly
      expect(s.stocks.done).toBe(0.25); // this tick's finish output only -- not shipped this tick
      expect(s.pointsPerDay).toBe(5); // pointsPerDay reads shippedFlow, not finishFlow
    });
  });

  // Release 15 deploy-bottleneck rework: dev/contractor hires boost pull and
  // finish only, no longer deploy. So a strong human build without ci-cd
  // outruns its own deploy stage -- Done piles up and shipping stays pinned at
  // the base deploy rate -- and ci-cd (continuous deploy) becomes the scaling
  // unlock. Injects a "strong dev" (pull+finish +2 each, rates 3/3/1) directly
  // via the mutable-state escape hatch so the probe is isolated from gamble rng
  // and purchase-time setup slowdowns.
  describe("deploy bottleneck without ci-cd (Release 15 rework)", () => {
    function injectStrongDev(e: Engine): GameState {
      const s = e.getState() as GameState;
      s.decisions.push({ instanceId: "inst-dev", defId: "basic-dev" });
      s.modifiers.push(
        { id: "m-pull", source: "inst-dev", target: "pull", op: "add", value: 2 },
        { id: "m-fin", source: "inst-dev", target: "finish", op: "add", value: 2 },
      );
      return s;
    }

    it("caps shipping at the base deploy rate while Done piles up when ci-cd is not owned", () => {
      const e = new Engine(ciCdContent());
      injectStrongDev(e); // rates: pull 3, finish 3, deploy 1
      for (let i = 0; i < 5; i++) e.tick(); // warm the pipeline
      const doneStart = e.getState().stocks.done;
      let shippedDelta = 0;
      for (let i = 0; i < 10; i++) {
        const before = e.getState().stocks.shipped;
        e.tick();
        shippedDelta += e.getState().stocks.shipped - before;
        expect(e.getState().pointsPerDay).toBeCloseTo(1, 10); // deploy-bound at base 1/day
      }
      const s = e.getState();
      expect(shippedDelta).toBeCloseTo(10, 10); // ~1 pt/day over the window
      // finish 3 vs ship 1 => Done grows ~2/day; it strictly piled up.
      expect(s.stocks.done).toBeGreaterThan(doneStart + 15);
    });

    it("ships at the finish rate once ci-cd (continuous deploy) is owned", () => {
      const e = new Engine(ciCdContent());
      const s = injectStrongDev(e);
      s.decisions.push({ instanceId: "inst-cicd", defId: "ci-cd" }); // continuousDeploy active
      for (let i = 0; i < 6; i++) e.tick(); // warm up
      for (let i = 0; i < 5; i++) {
        e.tick();
        expect(e.getState().pointsPerDay).toBeCloseTo(3, 10); // tracks finish, not the deploy cap
      }
      expect(e.getState().stocks.done).toBeCloseTo(3, 10); // only the latest tick's finish output waits
    });
  });

  // Issue #13: chargeUpkeep used to clamp budget to 0 against baseBurnPerDay
  // BEFORE crediting income, instead of netting burn against income in the
  // same step. Once budget had already been driven to 0, that clamp threw away
  // the burn deficit entirely, so any owned income decision got added on top
  // of a clean 0 with nothing left to net against -- turning insolvency into a
  // permanent, risk-free income stream instead of the intended steady 0.
  // Probed here with the subscription card at 10 users ($7.50/day, well under
  // the $20/day burn); issue #89's lean shop dropped support-retainer, the
  // flat-incomePerDay card this test used to buy, and the netting is the same
  // for either income shape.
  describe("insolvency does not monetize owned income decisions (issue #13)", () => {
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
});
