import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { parseStartConfig, parseDecisions } from "./content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
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
    expect(effectiveRate(s, "pull")).toBe(0.5);
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
    // whatever the outcome, exactly one add-modifier exists for it
    const mods = s.modifiers.filter((m) => m.source === s.decisions[0].instanceId);
    expect(mods).toHaveLength(1);
    expect([1.0, 0.5, -0.5, -1.0]).toContain(mods[0].value);
  });

  it("uses the synergy variant when the synergy decision is owned", () => {
    const e = new Engine(content());
    e.applyDecision("agent"); // base: debt mul 1.2
    e.applyDecision("agent-harness");
    e.applyDecision("agent"); // synergy: debt mul 1.1
    const s = e.getState();
    const debtMods = s.modifiers.filter((m) => m.target === "debtMultiplier").map((m) => m.value).sort();
    expect(debtMods).toEqual([1.1, 1.2]);
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
