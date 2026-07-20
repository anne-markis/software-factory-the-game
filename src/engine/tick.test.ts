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
  it("moves points downstream one stage per day at base rates", () => {
    const e = new Engine(testContent());
    e.tick(); // day 1: pull moves 1 point into inProgress
    let s = e.getState();
    expect(s.stocks.backlog).toBe(1499);
    expect(s.stocks.inProgress).toBe(1);
    expect(s.stocks.shipped).toBe(0);

    e.tick(); // day 2
    e.tick(); // day 3: first point ships (downstream-first prevents same-day pass-through)
    s = e.getState();
    expect(s.stocks.shipped).toBe(1);
    expect(s.pointsPerDay).toBe(1);
  });

  it("shipped points regenerate tech debt into the backlog", () => {
    const e = new Engine(testContent());
    e.tick();
    e.tick();
    e.tick(); // 1 point shipped, debt multiplier 0.5
    const s = e.getState();
    expect(s.stocks.techDebt).toBe(0.5);
    // start backlog 1500, 3 days of pull (-1 each) plus 0.5 debt regen from the 1 shipped point
    expect(s.stocks.backlog).toBe(1497 + 0.5);
  });

  it("pays revenue per shipped point and charges base burn", () => {
    const e = new Engine(testContent());
    e.tick(); // no shipping yet: 10000 - 20 burn (release-7 baseBurnPerDay)
    expect(e.getState().stocks.budget).toBe(9980);
    e.tick();
    e.tick(); // ships 1 point at $17 (initialProject.payoutPerPoint): 10000 - 3*20 burn + 17
    expect(e.getState().stocks.budget).toBe(10000 - 60 + 17);
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
        const finishRate = effectiveRate(before, "finish");
        e.tick();
        const after = e.getState();
        const expectedFinishFlow = Math.min(inProgressBefore, finishRate);
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
});
