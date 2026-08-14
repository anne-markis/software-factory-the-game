import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { parseStartConfig, parseDecisions } from "./content";
import { decisionsJson, startJson } from "./loadShippedContent";
import { effectiveRate, effectiveDebtMultiplier } from "./modifiers";
import type { GameContent } from "./types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("decisions", () => {
  it("charges one-time cost and applies effects", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    const s = e.getState();
    expect(s.stocks.budget).toBe(9500);
    // test-suite's setup slowdown halves every rate: base pull 2 -> 1, finish 1 -> 0.5.
    expect(effectiveRate(s, "pull")).toBe(1);
    expect(effectiveRate(s, "finish")).toBe(0.5);
    expect(effectiveDebtMultiplier(s)).toBe(0.25);
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
    const s = e.getState();
    expect(s.decisions).toHaveLength(1);
    expect(s.decisions[0].gambleLabel).toBeDefined();
    // Since Release 15's deploy-bottleneck rework a hire's outcome is two
    // add-modifiers -- one on pull, one on finish -- with the same value
    // (human capacity no longer boosts deploy).
    const mods = s.modifiers.filter((m) => m.source === s.decisions[0].instanceId);
    expect(mods).toHaveLength(2);
    expect(mods.map((m) => m.target).sort()).toEqual(["finish", "pull"]);
    expect([1.0, 0.5, -0.5, -1.0]).toContain(mods[0].value);
    expect(mods[0].value).toBe(mods[1].value);
  });

  it("uses the synergy variant when the synergy decision is owned", () => {
    // Shipped Studio content has no synergies any more (issue #89 replaced the
    // agent/harness synergy with global multipliers), so the engine's
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
    // effects (see archetypes.ts's debt mitigation check, issue #14).
    const workers = s.decisions.filter((d) => d.defId === "worker");
    expect(workers.map((d) => d.appliedSynergyIfOwned)).toEqual([undefined, "provider"]);
    expect(s.decisions.find((d) => d.defId === "provider")!.appliedSynergyIfOwned).toBeUndefined();
  });

  it("stacks agents linearly: N copies are worth N times one copy (issue #89)", () => {
    const e = new Engine(content());
    const base = effectiveRate(e.getState(), "finish");
    e.applyDecision("agent");
    e.applyDecision("agent");
    e.applyDecision("agent");
    const s = e.getState();
    // agent is not unique, so three instances coexist -- each with its own
    // +0.2 finish and +0.1 debt-multiplier modifier.
    expect(s.decisions.filter((d) => d.defId === "agent")).toHaveLength(3);
    expect(effectiveRate(s, "finish")).toBeCloseTo(base + 0.6);
    // debtMultiplier: base 0.5 + 3 x 0.1
    expect(effectiveDebtMultiplier(s)).toBeCloseTo(0.8);
    // Other rates are untouched: agents write code, they do not run releases.
    expect(effectiveRate(s, "deploy")).toBeCloseTo(base);
  });

  it("harness and orchestration multiply every agent, including ones bought before them (issue #89)", () => {
    const e = new Engine(content());
    e.applyDecision("agent");
    e.applyDecision("agent");
    e.applyDecision("agent-harness");
    e.applyDecision("agent-orchestration");
    const s = e.getState();
    // finish: (1 base + 2 x 0.2) x 1.25 x 1.45
    expect(effectiveRate(s, "finish")).toBeCloseTo(1.4 * 1.25 * 1.45);
    // debt: (0.5 base + 2 x 0.1) x 0.7 x 0.55 -- the pair more than cancels
    // the debt two agents add, which is the point of buying them.
    expect(effectiveDebtMultiplier(s)).toBeCloseTo(0.7 * 0.7 * 0.55);
    expect(effectiveDebtMultiplier(s)).toBeLessThan(0.5); // below the un-agented base
  });

  it("gates agent-orchestration on owning at least two agents (requiresCounts, issue #89)", () => {
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
    // Fixture-based since Studio content ships no synergies (the eng-manager
    // odds-tightener left with the org ladder, issue #89). Both engines share
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

  it("the agent ladder is not human, so payroll-loss and human gates ignore it", () => {
    const defs = parseDecisions(decisionsJson);
    // basic-dev is the only human in the Studio shop; the challenge pool's
    // human gates and removeHuman all key on this flag.
    expect(defs.filter((d) => d.human === true).map((d) => d.id)).toEqual(["basic-dev"]);
    for (const id of ["agent", "agent-harness", "agent-orchestration"]) {
      expect(defs.find((d) => d.id === id)!.human).not.toBe(true);
    }
  });

  it("payroll failure removes the decision permanently during tick", () => {
    const c = content();
    c.start.stocks.budget = 30;
    const e = new Engine(c);
    e.applyDecision("basic-dev"); // no one-time cost
    e.tick(); // day 1: burn 20 (30->10), pays 7 (10->3)
    e.tick(); // day 2: burn 20 clamps 3->0, cannot pay 7, dev removed
    const s = e.getState();
    expect(s.decisions).toHaveLength(0);
    expect(s.log.some((l) => l.message.includes("Payroll failed"))).toBe(true);
  });
});
