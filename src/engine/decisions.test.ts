import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { decisionTargetsExactRate } from "./decisions";
import { parseStartConfig, parseDecisions } from "./content";
import { decisionsJson, startJson } from "./loadShippedContent";
import { effectiveRate, effectiveDebtMultiplier } from "./modifiers";
import { activateDueInstances } from "./tick";
import type { GameContent, GameState } from "./types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

function settleHires(e: Engine): void {
  const s = e.getState() as GameState;
  for (const inst of s.decisions) {
    if (inst.activeOnDay !== undefined && inst.activeOnDay > s.day) inst.activeOnDay = s.day;
  }
  activateDueInstances(s, e.getContent());
}

describe("decisions", () => {
  it("charges one-time cost and applies effects", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    const s = e.getState();
    expect(s.stocks.budget).toBe(24500);
    // test-suite's setup slowdown halves every rate: base pull 2 -> 1, finish 1 -> 0.5.
    expect(effectiveRate(s, "pull")).toBe(1);
    expect(effectiveRate(s, "finish")).toBe(0.5);
    expect(effectiveDebtMultiplier(s)).toBe(0.1);
  });

  it("enforces requires and affordability", () => {
    const e = new Engine(content());
    expect(() => e.applyDecision("ci-cd")).toThrow(/requires/);
    const poor = content();
    poor.start.stocks.budget = 100;
    const e2 = new Engine(poor);
    expect(() => e2.applyDecision("test-suite")).toThrow(/afford/);
  });

  it("resolves gambles deterministically from the seeded rng", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const s0 = e.getState();
    expect(s0.decisions).toHaveLength(1);
    expect(s0.decisions[0].gambleLabel).toBeDefined();
    expect(s0.modifiers.filter((m) => m.source === s0.decisions[0].instanceId)).toHaveLength(0);
    settleHires(e);
    const s = e.getState();
    // Hire writes two gambled modifiers: finish and review. The seat is
    // DecisionDef.capacity, not a modifier. Morale is addToStock, not a modifier.
    const mods = s.modifiers.filter((m) => m.source === s.decisions[0].instanceId);
    expect(mods).toHaveLength(2);
    expect(mods.some((m) => m.target === "review" && [0.7, 0.4, 0.1].includes(m.value))).toBe(true);
    const finish = mods.find((m) => m.target === "finish")!;
    expect([1.0, 0.5, -0.5, -1.0]).toContain(finish.value);
  });

  it("uses the synergy variant when the synergy decision is owned", () => {
    // Shipped Studio content has no synergies any more (replaced the agent/harness synergy with global multipliers), so the engine's
    // purchase-time synergy selection is pinned against a fixture instead.
    const c = content();
    c.decisions = [
      { id: "provider", name: "Provider", description: "p", category: "tame-debt", cost: {}, effects: [], removable: true, unique: true },
      {
        id: "worker", name: "Worker", description: "w", category: "ship-faster", cost: {}, removable: true,
        effects: [{ type: "modifyDebtMultiplier", op: "mul", value: 1.2 }],
        synergies: [{ ifOwned: "provider", effects: [{ type: "modifyDebtMultiplier", op: "mul", value: 1.1 }] }],
      },
    ];
    const e = new Engine(c);
    e.applyDecision("worker"); // base: debt mul 1.2
    e.applyDecision("provider");
    e.applyDecision("worker"); // synergy: debt mul 1.1
    const s = e.getState();
    const debtMods = s.modifiers.filter((m) => m.target === "debtMultiplier").map((m) => m.value).sort();
    expect(debtMods).toEqual([1.1, 1.2]);
    // The applied variant is recorded on the instance that got it, and only on
    // that one: the first worker predates the provider, so it kept the base
    // effects (see archetypes.ts's debt mitigation check).
    const workers = s.decisions.filter((d) => d.defId === "worker");
    expect(workers.map((d) => d.appliedSynergyIfOwned)).toEqual([undefined, "provider"]);
    expect(s.decisions.find((d) => d.defId === "provider")!.appliedSynergyIfOwned).toBeUndefined();
  });

  it("stacks agents linearly: N copies are worth N times one copy", () => {
    const e = new Engine(content());
    const base = effectiveRate(e.getState(), "finish");
    e.applyDecision("agent");
    e.applyDecision("agent");
    e.applyDecision("agent");
    const s = e.getState();
    // agent is not unique, so three instances coexist -- each with its own
    // +0.2 finish and +0.04 debt-multiplier modifier.
    expect(s.decisions.filter((d) => d.defId === "agent")).toHaveLength(3);
    expect(effectiveRate(s, "finish")).toBeCloseTo(base + 0.6);
    // debtMultiplier: base 0.2 + 3 x 0.04
    expect(effectiveDebtMultiplier(s)).toBeCloseTo(0.32);
    // Other rates are untouched: agents write code, they do not run releases.
    expect(effectiveRate(s, "deploy")).toBeCloseTo(base);
  });

  it("human headcount amplifies owned agents live, in either buy order", () => {
    const start = parseStartConfig(startJson);
    const mixed: GameContent = {
      start,
      decisions: parseDecisions([
        {
          id: "basic-dev",
          name: "Hire",
          description: "h",
          category: "ship-faster",
          human: true,
          capacity: 1,
          cost: {},
          effects: [],
          removable: true,
        },
        {
          id: "agent",
          name: "Agent",
          description: "a",
          category: "ship-faster",
          cost: {},
          effects: [{ type: "modifyRate", target: "finish", op: "add", value: 0.2, scaleFromHumansPer: 0.1 }],
          removable: true,
        },
      ]),
      challenges: [],
      projects: [],
    };
    const agentFirst = new Engine(mixed);
    agentFirst.applyDecision("agent");
    expect(effectiveRate(agentFirst.getState(), "finish")).toBeCloseTo(1.2, 10);
    agentFirst.applyDecision("basic-dev");
    expect(effectiveRate(agentFirst.getState(), "finish")).toBeCloseTo(1.22, 10);

    const hireFirst = new Engine(mixed);
    hireFirst.applyDecision("basic-dev");
    hireFirst.applyDecision("agent");
    expect(effectiveRate(hireFirst.getState(), "finish")).toBeCloseTo(1.22, 10);

    const hireId = agentFirst.getState().decisions.find((d) => d.defId === "basic-dev")!.instanceId;
    agentFirst.removeDecision(hireId);
    expect(effectiveRate(agentFirst.getState(), "finish")).toBeCloseTo(1.2, 10);
  });

  it("harness and orchestration multiply every agent, including ones bought before them", () => {
    const e = new Engine(content());
    e.applyDecision("agent");
    e.applyDecision("agent");
    e.applyDecision("agent-harness");
    e.applyDecision("agent-orchestration");
    const s = e.getState();
    // finish: (1 base + 2 x 0.2) x 1.25 x 1.45
    expect(effectiveRate(s, "finish")).toBeCloseTo(1.4 * 1.25 * 1.45);
    // debt: (0.2 base + 2 x 0.04) x 0.7 x 0.55 -- the pair more than cancels
    // the debt two agents add, which is the point of buying them.
    expect(effectiveDebtMultiplier(s)).toBeCloseTo(0.28 * 0.7 * 0.55);
    expect(effectiveDebtMultiplier(s)).toBeLessThan(0.2); // below the un-agented base
  });

  it("gates agent-orchestration on owning at least two agents (requiresCounts)", () => {
    const e = new Engine(content());
    // No agents: the reason spells the count out, since "requires Add coding
    // agent" would read as satisfied to a player who owns one.
    expect(() => e.applyDecision("agent-orchestration")).toThrow(/requires 2x Add coding agent/);
    e.applyDecision("agent");
    expect(() => e.applyDecision("agent-orchestration")).toThrow(/requires 2x Add coding agent/);
    expect(
      e.availableDecisions().find((a) => a.def.id === "agent-orchestration")!,
    ).toMatchObject({ purchasable: false, code: "missing-requires" });
    e.applyDecision("agent");
    expect(e.availableDecisions().find((a) => a.def.id === "agent-orchestration")!.purchasable).toBe(true);
    expect(() => e.applyDecision("agent-orchestration")).not.toThrow();
    // Still unique despite the count gate.
    expect(() => e.applyDecision("agent-orchestration")).toThrow(/already owned/);
  });

  it("re-locks a count gate when an owned instance is removed", () => {
    const e = new Engine(content());
    e.applyDecision("agent");
    e.applyDecision("agent");
    expect(e.availableDecisions().find((a) => a.def.id === "agent-orchestration")!.purchasable).toBe(true);
    e.removeDecision(e.getState().decisions[0].instanceId);
    const entry = e.availableDecisions().find((a) => a.def.id === "agent-orchestration")!;
    expect(entry.purchasable).toBe(false);
    expect(entry.code).toBe("missing-requires");
  });

  it("removeDecision drops effects and upkeep", () => {
    const e = new Engine(content());
    e.applyDecision("agent");
    const inst = e.getState().decisions[0];
    e.removeDecision(inst.instanceId);
    const s = e.getState();
    expect(s.decisions).toHaveLength(0);
    expect(s.modifiers.filter((m) => m.source === inst.instanceId)).toHaveLength(0);
  });

  it("rejects a second purchase of a unique decision", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    expect(() => e.applyDecision("test-suite")).toThrow(/already owned/);
    const s = e.getState();
    const instances = s.decisions.filter((d) => d.defId === "test-suite");
    expect(instances).toHaveLength(1);
    const debtMods = s.modifiers.filter(
      (m) => m.target === "debtMultiplier" && m.source === instances[0].instanceId,
    );
    expect(debtMods).toHaveLength(1);
  });

  it("removeDecision rejects non-removable decisions", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    const inst = e.getState().decisions[0];
    expect(() => e.removeDecision(inst.instanceId)).toThrow(/cannot be removed/);
  });

  it("applyDecision rejects unknown decision ids", () => {
    const e = new Engine(content());
    expect(() => e.applyDecision("nope")).toThrow(/Unknown decision/);
  });

  it("removeDecision rejects unknown instance ids", () => {
    const e = new Engine(content());
    expect(() => e.removeDecision("inst-999")).toThrow(/Unknown instance/);
  });

  it("swaps in a synergy's gamble table when its provider is owned", () => {
    // Fixture-based since Studio content ships no synergies (the eng-manager odds-tightener left with the org ladder). Both engines share
    // seed 20260714, whose second gamble roll is 0.8411 (observed): the base
    // table (0.5/0.5) lands in "Bad" and the tightened one (0.9/0.1) in "Good".
    const withProvider = () => {
      const c = content();
      c.decisions = [
        { id: "manager", name: "Manager", description: "m", category: "prevent-trouble", cost: {}, effects: [], removable: true, unique: true },
        {
          id: "hire", name: "Hire", description: "h", category: "ship-faster", cost: {}, effects: [], removable: true,
          gamble: [
            { probability: 0.5, label: "Good", effects: [{ type: "modifyRate", target: "finish", op: "add", value: 1 }] },
            { probability: 0.5, label: "Bad", effects: [{ type: "modifyRate", target: "finish", op: "add", value: -1 }] },
          ],
          synergies: [
            {
              ifOwned: "manager",
              gamble: [
                { probability: 0.9, label: "Good", effects: [{ type: "modifyRate", target: "finish", op: "add", value: 1 }] },
                { probability: 0.1, label: "Bad", effects: [{ type: "modifyRate", target: "finish", op: "add", value: -1 }] },
              ],
            },
          ],
        },
      ];
      return c;
    };

    const tightened = new Engine(withProvider());
    tightened.applyDecision("hire"); // roll 1
    tightened.applyDecision("manager"); // no gamble: no rng draw
    tightened.applyDecision("hire"); // roll 2 against the tightened table
    const sA = tightened.getState();
    const secondHire = sA.decisions.filter((d) => d.defId === "hire")[1];
    expect(secondHire.gambleLabel).toBe("Good");
    expect(secondHire.appliedSynergyIfOwned).toBe("manager");

    const control = new Engine(withProvider());
    control.applyDecision("hire"); // roll 1
    control.applyDecision("hire"); // roll 2 against the base table
    const sB = control.getState();
    expect(sB.decisions[1].gambleLabel).toBe("Bad");
    expect(sB.decisions[1].appliedSynergyIfOwned).toBeUndefined();
  });

  it("ci-cd requires the test suite first", () => {
    const e = new Engine(content());
    expect(() => e.applyDecision("ci-cd")).toThrow(/requires Add test suite/);
  });

  it("offers hack day and user interviews on day 0, repeatable, without unlocking CI/CD or harness", () => {
    const e = new Engine(content());
    const byId = Object.fromEntries(e.availableDecisions().map((a) => [a.def.id, a]));

    expect(byId["hack-day"]!.purchasable).toBe(true);
    expect(byId["hack-day"]!.code).toBeUndefined();
    expect(byId["user-interviews"]!.purchasable).toBe(true);
    expect(byId["user-interviews"]!.code).toBeUndefined();
    // Agent harness / CI/CD hide rules are unchanged.
    expect(byId["ci-cd"]).toMatchObject({ purchasable: false, code: "missing-requires" });
    expect(byId["agent-harness"]).toMatchObject({ purchasable: false, code: "missing-requires" });
    expect(byId["agent-orchestration"]).toMatchObject({ purchasable: false, code: "missing-requires" });

    e.applyDecision("hack-day");
    expect(e.getState().stocks.ideas).toBe(150);
    expect(e.availableDecisions().find((a) => a.def.id === "hack-day")!.purchasable).toBe(true);
    expect(() => e.applyDecision("hack-day")).not.toThrow();
    expect(e.getState().stocks.ideas).toBe(200);
    e.applyDecision("user-interviews");
    expect(e.getState().stocks.ideas).toBe(400);
    expect(e.availableDecisions().find((a) => a.def.id === "user-interviews")!.purchasable).toBe(true);
    e.applyDecision("user-interviews");
    expect(e.getState().stocks.ideas).toBe(600);
    expect(e.availableDecisions().find((a) => a.def.id === "ci-cd")).toMatchObject({
      purchasable: false,
      code: "missing-requires",
    });
    expect(e.availableDecisions().find((a) => a.def.id === "agent-harness")).toMatchObject({
      purchasable: false,
      code: "missing-requires",
    });
  });

  it("the agent ladder is not human, so payroll-loss and human gates ignore it", () => {
    const defs = parseDecisions(decisionsJson);
    expect(defs.filter((d) => d.human === true).map((d) => d.id)).toEqual(["basic-dev"]);
    for (const id of ["agent", "agent-harness", "agent-orchestration", "agent-ci-review"]) {
      expect(defs.find((d) => d.id === id)!.human).not.toBe(true);
    }
  });

  it("payroll failure removes the decision permanently during tick", () => {
    const c = content();
    const e = new Engine(c);
    e.applyDecision("basic-dev");
    settleHires(e);
    const s = e.getState() as GameState;
    s.stocks.budget = 30;
    e.tick();
    expect(e.getState().decisions).toHaveLength(0);
    expect(e.getState().log.some((l) => l.message.includes("Payroll failed"))).toBe(true);
  });

  it("classifies review cards by exact modifyRate target, not all", () => {
    const defs = parseDecisions(decisionsJson);
    const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
    expect(decisionTargetsExactRate(byId["agent-orchestration"]!, "review")).toBe(true);
    expect(decisionTargetsExactRate(byId["agent-orchestration"]!, "finish")).toBe(true);
    expect(decisionTargetsExactRate(byId["agent-orchestration"]!, "plan")).toBe(true);
    expect(decisionTargetsExactRate(byId["agent"]!, "review")).toBe(true);
    expect(decisionTargetsExactRate(byId["agent"]!, "finish")).toBe(true);
    expect(decisionTargetsExactRate(byId["agent"]!, "plan")).toBe(true);
    expect(decisionTargetsExactRate(byId["agent-harness"]!, "plan")).toBe(true);
    expect(decisionTargetsExactRate(byId["agent-ci-review"]!, "plan")).toBe(false);
    expect(decisionTargetsExactRate(byId["basic-dev"]!, "review")).toBe(true);
    expect(decisionTargetsExactRate(byId["agent-ci-review"]!, "review")).toBe(true);
    expect(decisionTargetsExactRate(byId["agent-ci-review"]!, "finish")).toBe(false);
    expect(decisionTargetsExactRate(byId["agent-harness"]!, "review")).toBe(false);
    expect(decisionTargetsExactRate(byId["hack-day"]!, "review")).toBe(false);
  });

  it("agents add plan like finish, and harness and orchestration multiply it", () => {
    const e = new Engine(content());
    expect(effectiveRate(e.getState(), "plan")).toBe(1);
    e.applyDecision("agent");
    expect(effectiveRate(e.getState(), "plan")).toBeCloseTo(1.2, 10);
    e.applyDecision("agent");
    e.applyDecision("agent-harness");
    e.applyDecision("agent-orchestration");
    // plan: (1 + 2 x 0.2) x 1.25 x 1.45. Pull and discover stay put.
    expect(effectiveRate(e.getState(), "plan")).toBeCloseTo(1.4 * 1.25 * 1.45, 10);
    expect(effectiveRate(e.getState(), "pull")).toBe(2);
    expect(effectiveRate(e.getState(), "discover")).toBeCloseTo(0.5, 10);
    e.applyDecision("basic-dev");
    settleHires(e);
    // One human scales each agent's plan add by 1.1: (1 + 2 x 0.22) x 1.25 x 1.45.
    expect(effectiveRate(e.getState(), "plan")).toBeCloseTo(1.44 * 1.25 * 1.45, 10);
  });

  it("orchestration raises review as well as finish", () => {
    const e = new Engine(content());
    e.applyDecision("agent");
    e.applyDecision("agent");
    const finishBefore = effectiveRate(e.getState(), "finish");
    const debtBefore = effectiveDebtMultiplier(e.getState());
    e.applyDecision("agent-orchestration");
    expect(effectiveRate(e.getState(), "review")).toBeCloseTo(1.1 * 1.45, 5);
    expect(effectiveRate(e.getState(), "finish")).toBeCloseTo(finishBefore * 1.45, 5);
    expect(effectiveDebtMultiplier(e.getState())).toBeCloseTo(debtBefore * 0.55, 5);
  });

  it("a hire gambles review between 0.1 and 0.7; agents add less review than finish", () => {
    const e = new Engine(content());
    expect(effectiveRate(e.getState(), "review")).toBe(1);
    e.applyDecision("basic-dev");
    settleHires(e);
    const hireReview = effectiveRate(e.getState(), "review") - 1;
    expect([0.7, 0.4, 0.1].some((v) => Math.abs(hireReview - v) < 1e-10)).toBe(true);
    const afterHire = effectiveRate(e.getState(), "review");
    e.applyDecision("agent");
    expect(effectiveRate(e.getState(), "review")).toBeCloseTo(afterHire + 0.05, 10);
    const finishAfterAgent = effectiveRate(e.getState(), "finish");
    const reviewAfterAgent = effectiveRate(e.getState(), "review");
    expect(finishAfterAgent - 1).toBeGreaterThan(reviewAfterAgent - afterHire);
  });

  it("agent-ci-review needs ci-cd, then multiplies review without skipping the stage", () => {
    const e = new Engine(content());
    expect(e.availableDecisions().find((a) => a.def.id === "agent-ci-review")).toMatchObject({
      purchasable: false,
      code: "missing-requires",
    });
    expect(() => e.applyDecision("agent-ci-review")).toThrow(/requires CI\/CD pipeline/);
    e.applyDecision("test-suite");
    e.applyDecision("ci-cd");
    const reviewBefore = effectiveRate(e.getState(), "review");
    e.applyDecision("agent-ci-review");
    expect(effectiveRate(e.getState(), "review")).toBeCloseTo(reviewBefore * 2.5, 5);
    expect(e.getState().stocks.inReview).toBeGreaterThanOrEqual(0);
  });
});
