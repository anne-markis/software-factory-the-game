import { describe, expect, it } from "vitest";
import { Engine, initialState } from "./engine";
import { parseStartConfig, parseDecisions } from "./content";
import { decisionsJson, startJson } from "./loadShippedContent";
import { activateDueInstances } from "./tick";
import { applyEffects } from "./effects";
import { effectiveCapacity } from "./capacity";
import { effectiveRate } from "./modifiers";
import { serialize, deserialize } from "./save";
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

describe("morale stock", () => {
  it("seeds at 70 and recovers toward the cap without reputation", () => {
    const e = new Engine(content());
    expect(e.getState().stocks.morale).toBe(70);
    e.tick();
    expect(e.getState().stocks.morale).toBeCloseTo(70.2, 10);
    expect(e.getState().moraleRecoverFlow).toBeCloseTo(0.2, 10);
    expect(e.getState().moralePrideFlow).toBe(0);
  });

  it("reputation only helps morale, never drains it", () => {
    const e = new Engine(content());
    const s = e.getState() as GameState;
    s.stocks.reputation = 20;
    e.tick();
    expect(e.getState().moralePrideFlow).toBeCloseTo(1, 10);
    expect(e.getState().stocks.morale).toBeCloseTo(71.2, 10);
  });

  it("addToStock clamps morale at stockMax", () => {
    const e = new Engine(content());
    const s = e.getState() as GameState;
    s.stocks.morale = 98;
    applyEffects(s, [{ type: "addToStock", stock: "morale", value: 10 }], "test");
    expect(s.stocks.morale).toBe(100);
  });

  it("Launch beta grants +5 morale on complete", () => {
    const e = new Engine(content());
    const s = e.getState() as GameState;
    s.projects[0]!.remaining = 0.01;
    s.stocks.inReview = 0;
    s.stocks.done = 1;
    e.tick();
    expect(e.getState().completedProjects).toBe(1);
    expect(e.getState().stocks.morale).toBeGreaterThanOrEqual(75);
    expect(e.getState().log.some((l) => l.message.includes("+5 morale"))).toBe(true);
  });
});

describe("delayed hire", () => {
  it("charges signing cost and reveals the gamble immediately, without capacity or rates", () => {
    const e = new Engine(content());
    const before = e.getState().stocks.budget;
    const finish = effectiveRate(e.getState(), "finish");
    e.applyDecision("basic-dev");
    const s = e.getState();
    expect(s.stocks.budget).toBe(before - 2000);
    expect(s.decisions).toHaveLength(1);
    expect(s.decisions[0]!.gambleLabel).toBeDefined();
    expect(s.decisions[0]!.activeOnDay).toBe(14);
    expect(s.decisions[0]!.pendingEffects?.length).toBeGreaterThan(0);
    expect(s.modifiers.filter((m) => m.source === s.decisions[0]!.instanceId)).toHaveLength(0);
    expect(effectiveCapacity(s, content())).toBe(1);
    expect(effectiveRate(s, "finish")).toBe(finish);
    expect(s.log.some((l) => /joining in 14 days/.test(l.message))).toBe(true);
  });

  it("does not charge payroll while joining", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const afterHire = e.getState().stocks.budget;
    e.tick();
    // Fixture has no KTLO project; pending hire must not add $438 payroll.
    expect(e.getState().stocks.budget).toBe(afterHire);
    expect(e.getState().decisions).toHaveLength(1);
  });

  it("activates on day 14: effects, seat, payroll, morale nudge", () => {
    const e = new Engine(content());
    const moraleBefore = e.getState().stocks.morale;
    e.applyDecision("basic-dev");
    for (let i = 0; i < 13; i++) e.tick();
    expect(e.getState().day).toBe(13);
    expect(effectiveCapacity(e.getState(), content())).toBe(1);
    e.tick();
    expect(e.getState().day).toBe(14);
    expect(e.getState().decisions[0]!.pendingEffects).toBeUndefined();
    expect(effectiveCapacity(e.getState(), content())).toBe(2);
    expect(e.getState().log.some((l) => l.message.includes("started"))).toBe(true);
    const finish = effectiveRate(e.getState(), "finish");
    expect(finish === 2 || finish === 1.5 || finish === 0.5 || finish === 0).toBe(true);
    expect(e.getState().stocks.morale).not.toBe(moraleBefore);
  });

  it("settle helper applies pending effects without 14 ticks of economy", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    settleHires(e);
    expect(effectiveCapacity(e.getState(), content())).toBe(2);
    expect(e.getState().decisions[0]!.pendingEffects).toBeUndefined();
  });
});

describe("agent overload and quit", () => {
  it("does not drain morale at 10 agents with founder only", () => {
    const e = new Engine(content());
    for (let i = 0; i < 10; i++) e.applyDecision("agent");
    const before = e.getState().stocks.morale;
    e.tick();
    expect(e.getState().moraleOverloadFlow).toBe(0);
    expect(e.getState().stocks.morale).toBeCloseTo(before + 0.2, 10);
  });

  it("drains morale when agents per human exceed 10; harness does not count", () => {
    const e = new Engine(content());
    for (let i = 0; i < 11; i++) e.applyDecision("agent");
    e.applyDecision("agent-harness");
    e.tick();
    expect(e.getState().moraleOverloadFlow).toBeCloseTo(0.3, 10);
  });

  it("pending hires do not count in the human denominator", () => {
    const e = new Engine(content());
    for (let i = 0; i < 11; i++) e.applyDecision("agent");
    e.applyDecision("basic-dev");
    e.tick();
    expect(e.getState().moraleOverloadFlow).toBeCloseTo(0.3, 10);
  });

  it("does not quit while morale is in the safe band, even at 0 reputation", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    settleHires(e);
    const s = e.getState() as GameState;
    s.stocks.reputation = 0;
    s.stocks.morale = 70;
    for (let i = 0; i < 20; i++) e.tick();
    expect(e.getState().decisions.some((d) => d.defId === "basic-dev")).toBe(true);
    expect(e.getState().employeeQuitRate).toBe(0);
  });

  it("quits an active human when morale is 0 and the roll always hits", () => {
    const c = content();
    c.start.instanceChurn = [{ stock: "morale", flag: "human", safeBand: 40, maxRatePerDay: 1 }];
    const e = new Engine(c);
    e.applyDecision("basic-dev");
    settleHires(e);
    const s = e.getState() as GameState;
    s.stocks.morale = 0;
    e.tick();
    expect(e.getState().decisions.some((d) => d.defId === "basic-dev")).toBe(false);
    expect(e.getState().log.some((l) => l.message.startsWith("Quit:"))).toBe(true);
  });
});

describe("morale save backfill", () => {
  it("Engine backfills a missing stocks.morale from content", () => {
    const c = content();
    const raw = structuredClone(initialState(c)) as GameState;
    delete (raw.stocks as { morale?: number }).morale;
    const restored = deserialize(serialize(raw));
    expect(restored.stocks.morale).toBeUndefined();
    const e = new Engine(c, restored);
    expect(e.getState().stocks.morale).toBe(c.start.stocks.morale);
  });
});
