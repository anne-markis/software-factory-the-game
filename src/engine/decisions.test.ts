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
    const e = new Engine(content());
    e.applyDecision("agent"); // base: debt mul 1.2
    e.applyDecision("agent-harness");
    e.applyDecision("agent"); // synergy: debt mul 1.1
    const s = e.getState();
    const debtMods = s.modifiers.filter((m) => m.target === "debtMultiplier").map((m) => m.value).sort();
    expect(debtMods).toEqual([1.1, 1.2]);
  });

  it("buying refactoring-sprint pays down 30% of tech debt and slows all rates 40% for 8 days", () => {
    const c = content();
    c.start.stocks.techDebt = 1000;
    const e = new Engine(c);
    e.applyDecision("refactoring-sprint");
    const s = e.getState();
    expect(s.stocks.techDebt).toBe(700);
    expect(s.stocks.budget).toBe(9600); // 10000 - 400
    // Note: effectiveRate(s, "pull") is NOT 0.6 here -- techDebt 700 is past
    // freeDebt (400), so the debtDrag multiplier also bites on top of this
    // modifier (a separate, already-tested mechanism). Assert the modifier
    // itself instead of the drag-entangled effective rate.
    const mod = s.modifiers.find((m) => m.source === s.decisions[0].instanceId && m.target === "allRates")!;
    expect(mod).toMatchObject({ op: "mul", value: 0.6, expiresDay: 8 }); // day 0 + 8
    // scaleStock creates no modifier of its own -- only the paired modifyRate does.
    expect(s.modifiers.filter((m) => m.source === s.decisions[0].instanceId)).toHaveLength(1);
  });

  it("buying redesign-rebuild wipes 90% of tech debt and slows all rates 60% for 25 days", () => {
    const c = content();
    c.start.stocks.techDebt = 1000;
    const e = new Engine(c);
    e.applyDecision("redesign-rebuild");
    const s = e.getState();
    expect(s.stocks.techDebt).toBe(100);
    expect(s.stocks.budget).toBe(8800); // 10000 - 1200
    expect(effectiveRate(s, "pull")).toBe(0.4);
    const mod = s.modifiers.find((m) => m.source === s.decisions[0].instanceId && m.target === "allRates")!;
    expect(mod).toMatchObject({ op: "mul", value: 0.4, expiresDay: 25 }); // day 0 + 25
    expect(s.modifiers.filter((m) => m.source === s.decisions[0].instanceId)).toHaveLength(1);
  });

  it("refactoring-sprint is not unique: it can be bought repeatedly as debt regrows", () => {
    const c = content();
    c.start.stocks.techDebt = 1000;
    const e = new Engine(c);
    e.applyDecision("refactoring-sprint");
    expect(() => e.applyDecision("refactoring-sprint")).not.toThrow();
    const s = e.getState();
    expect(s.decisions.filter((d) => d.defId === "refactoring-sprint")).toHaveLength(2);
    // 1000 -> 700 (first) -> 490 (second, factor 0.7 applied again). Float
    // multiplication lands at 489.99999999999994, not exactly 490.
    expect(s.stocks.techDebt).toBeCloseTo(490);
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

  it("tightens the basic-dev gamble table when a manager is owned", () => {
    // Seed 20260714 (observed): first gamble roll 0.1269, second 0.8411.
    // eng-manager has no gamble, so buying it consumes no rng draw and both
    // engines see 0.8411 for their second dev. That roll diverges: base table
    // (0.5/0.25/0.2/0.05) lands in Net-negative hire (-0.5); tightened table
    // (0.55/0.30/0.13/0.02) lands in Decent hire (+0.5).
    const withManager = new Engine(content());
    withManager.applyDecision("basic-dev"); // roll 1: Strong hire on either table
    withManager.applyDecision("eng-manager"); // no gamble: no rng draw
    withManager.applyDecision("basic-dev"); // roll 2 against the tightened table
    const sA = withManager.getState();
    const secondDev = sA.decisions.filter((d) => d.defId === "basic-dev")[1];
    expect(secondDev.gambleLabel).toBe("Decent hire");
    const tightened = [1.0, 0.5, -0.5, -1.0]; // tightened table outcome values
    const modA = sA.modifiers.find((m) => m.source === secondDev.instanceId)!;
    expect(tightened).toContain(modA.value);
    expect(modA.value).toBe(0.5);

    const control = new Engine(content());
    control.applyDecision("basic-dev"); // roll 1
    control.applyDecision("basic-dev"); // roll 2 against the base table
    const sB = control.getState();
    const controlSecond = sB.decisions[1];
    expect(controlSecond.gambleLabel).toBe("Net-negative hire");
    const modB = sB.modifiers.find((m) => m.source === controlSecond.instanceId)!;
    expect(modB.value).toBe(-0.5);
  });

  it("senior-dev requires a basic developer first", () => {
    const e = new Engine(content());
    expect(() => e.applyDecision("senior-dev")).toThrow(/requires/);
  });

  it("contractor is not human, so per-human-dev challenge rolls ignore it", () => {
    const defs = parseDecisions(decisionsJson);
    const contractor = defs.find((d) => d.id === "contractor")!;
    expect(contractor.human).not.toBe(true);
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
