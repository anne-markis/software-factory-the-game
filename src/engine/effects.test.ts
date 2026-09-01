import { describe, it, expect } from "vitest";
import { applyEffects } from "./effects";
import { serialize, deserialize } from "./save";
import { initialState } from "./engine";
import { parseStartConfig } from "./content";
import { startJson } from "./loadShippedContent";
import { effectiveRate, effectiveDebtMultiplier } from "./modifiers";
import { tick } from "./tick";
import { createRng } from "./rng";
import type { GameContent } from "./types";

function freshContent(): GameContent {
  return { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] };
}

function freshState() {
  return initialState(freshContent());
}

describe("applyEffects", () => {
  it("modifyRate creates a modifier that changes effective rate", () => {
    const s = freshState();
    applyEffects(s, [{ type: "modifyRate", target: "all", op: "mul", value: 0.5, durationDays: 5 }], "src-1");
    expect(effectiveRate(s, "pull")).toBe(1); // base pull 2 x 0.5
    expect(effectiveRate(s, "finish")).toBe(0.5); // base finish 1 x 0.5
    expect(s.modifiers[0].expiresDay).toBe(5); // day 0 + 5
  });

  it("modifyRate with a specific target and add op only affects that rate", () => {
    const s = freshState();
    applyEffects(s, [{ type: "modifyRate", target: "pull", op: "add", value: 1 }], "src-1");
    expect(effectiveRate(s, "pull")).toBe(3); // base pull 2 + 1
    expect(effectiveRate(s, "finish")).toBe(1);
  });

  it("modifyRate add on discover raises only the Ideas faucet", () => {
    const s = freshState();
    const pullBefore = effectiveRate(s, "pull");
    const finishBefore = effectiveRate(s, "finish");
    const deployBefore = effectiveRate(s, "deploy");
    applyEffects(s, [{ type: "modifyRate", target: "discover", op: "add", value: 1.5 }], "src-1");
    expect(effectiveRate(s, "discover")).toBeCloseTo(2.0, 10); // base 0.5 + 1.5
    expect(effectiveRate(s, "plan")).toBe(1);
    expect(effectiveRate(s, "pull")).toBe(pullBefore);
    expect(effectiveRate(s, "finish")).toBe(finishBefore);
    expect(effectiveRate(s, "deploy")).toBe(deployBefore);
  });

  it("modifyRate add on plan raises only the Plan rate", () => {
    const s = freshState();
    const discoverBefore = effectiveRate(s, "discover");
    applyEffects(s, [{ type: "modifyRate", target: "plan", op: "add", value: 1 }], "src-1");
    expect(effectiveRate(s, "plan")).toBeCloseTo(2, 10);
    expect(effectiveRate(s, "discover")).toBe(discoverBefore);
    expect(effectiveRate(s, "pull")).toBe(2);
  });

  it("modifyDebtMultiplier changes effective debt multiplier", () => {
    const s = freshState();
    applyEffects(s, [{ type: "modifyDebtMultiplier", op: "mul", value: 0.5 }], "src-1");
    expect(effectiveDebtMultiplier(s)).toBe(0.25);
    expect(s.modifiers[0].expiresDay).toBeUndefined();
  });

  it("addToStock changes the stock immediately, clamped at zero", () => {
    const s = freshState();
    applyEffects(s, [{ type: "addToStock", stock: "budget", value: -100 }], "src-1");
    expect(s.stocks.budget).toBe(9900);
    applyEffects(s, [{ type: "addToStock", stock: "techDebt", value: -5 }], "src-1");
    expect(s.stocks.techDebt).toBe(0);
    applyEffects(s, [{ type: "addToStock", stock: "backlog", value: 200 }], "src-1");
    expect(s.stocks.backlog).toBe(500); // Studio start backlog 300 + 200
    expect(s.projects[0]!.remaining).toBe(500); // ADR 0009: pipeline inject attaches to remaining
  });

  it("scaleStock multiplies the target stock immediately, clamped at zero, leaving siblings untouched", () => {
    const s = freshState();
    s.stocks.techDebt = 1000;
    applyEffects(s, [{ type: "scaleStock", stock: "techDebt", factor: 0.7 }], "src-1");
    expect(s.stocks.techDebt).toBe(700); // reduction
    expect(s.stocks.backlog).toBe(300); // sibling stock unaffected (Studio start backlog 300)

    applyEffects(s, [{ type: "scaleStock", stock: "techDebt", factor: 0 }], "src-1");
    expect(s.stocks.techDebt).toBe(0); // factor 0 wipes it entirely

    s.stocks.techDebt = 200;
    applyEffects(s, [{ type: "scaleStock", stock: "techDebt", factor: 1.5 }], "src-1");
    expect(s.stocks.techDebt).toBe(300); // factor > 1 grows the stock
    expect(s.stocks.budget).toBe(10000); // still untouched throughout
  });

  it("sickness marks the instance from context", () => {
    const s = freshState();
    s.decisions.push({ instanceId: "i1", defId: "basic-dev" });
    applyEffects(s, [{ type: "sickness", factor: 0.7, durationDays: 5 }], "chal-1", { instanceId: "i1" });
    expect(s.decisions[0].sickUntilDay).toBe(5);
    expect(s.decisions[0].sickFactor).toBe(0.7);
  });

  it("removeHuman strips the targeted human instance and its modifiers", () => {
    const content: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [
        {
          id: "basic-dev",
          name: "Hire basic developer",
          description: "d",
          category: "ship-faster",
          human: true,
          cost: { perDay: 7 },
          effects: [{ type: "modifyRate", target: "pull", op: "add", value: 1 }],
          removable: true,
        },
        {
          id: "ci-cd",
          name: "CI/CD",
          description: "d",
          category: "change-structure",
          cost: { oneTime: 1 },
          effects: [],
          removable: false,
        },
      ],
      challenges: [],
      projects: [],
    };
    const s = initialState(content);
    s.decisions.push({ instanceId: "inst-dev", defId: "basic-dev" }, { instanceId: "inst-tool", defId: "ci-cd" });
    s.modifiers.push({
      id: "mod-dev",
      source: "inst-dev",
      target: "pull",
      op: "add",
      value: 1,
    });
    s.modifiers.push({
      id: "mod-tool",
      source: "inst-tool",
      target: "deploy",
      op: "mul",
      value: 1.1,
    });

    applyEffects(s, [{ type: "removeHuman" }], "choice-poach", { instanceId: "inst-dev", content });

    expect(s.decisions.map((d) => d.instanceId)).toEqual(["inst-tool"]);
    expect(s.modifiers.map((m) => m.id)).toEqual(["mod-tool"]);
    expect(s.log.some((l) => l.message === "Lost: Hire basic developer")).toBe(true);
  });

  it("removeHuman prefers the context instance over roster order", () => {
    const content: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [
        {
          id: "basic-dev",
          name: "Hire basic developer",
          description: "d",
          category: "ship-faster",
          human: true,
          cost: { perDay: 7 },
          effects: [],
          removable: true,
        },
      ],
      challenges: [],
      projects: [],
    };
    const s = initialState(content);
    s.decisions.push({ instanceId: "first", defId: "basic-dev" }, { instanceId: "second", defId: "basic-dev" });
    applyEffects(s, [{ type: "removeHuman" }], "choice-poach", { instanceId: "second", content });
    expect(s.decisions.map((d) => d.instanceId)).toEqual(["first"]);
  });

  it("removeHuman no-ops without content or humans", () => {
    const s = freshState();
    s.decisions.push({ instanceId: "x", defId: "agent" });
    applyEffects(s, [{ type: "removeHuman" }], "choice-poach");
    expect(s.decisions).toHaveLength(1);
    applyEffects(s, [{ type: "removeHuman" }], "choice-poach", { content: freshContent() });
    expect(s.decisions).toHaveLength(1);
  });

  it("modifier ids come from state and advance nextModifierId", () => {
    const s = freshState();
    applyEffects(s, [{ type: "modifyRate", target: "all", op: "mul", value: 0.5 }], "src-1");
    applyEffects(s, [{ type: "modifyDebtMultiplier", op: "add", value: 0.1 }], "src-1");
    expect(s.modifiers.map((m) => m.id)).toEqual(["mod-1", "mod-2"]);
    expect(s.nextModifierId).toBe(3);
  });

  // Pins expiry semantics through the real tick loop. A buy-style application
  // between ticks at day 0 with durationDays 5 yields expiresDay 5; the tick
  // increments day before pruneExpired (which keeps only expiresDay > day), so
  // the modifier affects ticks 1 through 4 and is pruned during tick 5. This
  // is accepted behavior; content numbers are tuned around it.
  it("a day-0 modifier with durationDays 5 affects ticks 1-4 and is pruned on tick 5", () => {
    const content = freshContent();
    const s = initialState(content);
    const rng = createRng(content.start.seed);
    const noChallenges = () => {};
    applyEffects(s, [{ type: "modifyRate", target: "all", op: "mul", value: 0.5, durationDays: 5 }], "src-1");
    for (let i = 0; i < 4; i++) tick(s, rng, content, noChallenges);
    expect(s.day).toBe(4);
    expect(effectiveRate(s, "pull")).toBe(1); // base pull 2 x 0.5 while live
    tick(s, rng, content, noChallenges);
    expect(s.day).toBe(5);
    expect(s.modifiers).toHaveLength(0);
    expect(effectiveRate(s, "pull")).toBe(2); // back to base
  });

  it("rampRate creates a 0-value add modifier and leaves the rate unchanged on the day it is applied", () => {
    const s = freshState();
    applyEffects(s, [{ type: "rampRate", target: "finish", perDay: 0.5, cap: 2 }], "src-1");
    const m = s.modifiers[0];
    expect(m.op).toBe("add");
    expect(m.target).toBe("finish");
    expect(m.value).toBe(0);
    expect(m.rampPerDay).toBe(0.5);
    expect(m.rampCap).toBe(2);
    expect(effectiveRate(s, "finish")).toBe(1); // base rate, unchanged before any tick grows it
  });

  it("a ramp modifier grows perDay each tick and clamps at cap", () => {
    const content = freshContent();
    const s = initialState(content);
    const rng = createRng(content.start.seed);
    const noChallenges = () => {};
    applyEffects(s, [{ type: "rampRate", target: "finish", perDay: 0.5, cap: 2 }], "src-1");
    for (let i = 0; i < 7; i++) tick(s, rng, content, noChallenges);
    expect(s.day).toBe(7);
    // 7 ticks * 0.5/day = 3.5, clamped to cap 2; base finish rate is 1.
    expect(effectiveRate(s, "finish")).toBe(3);
  });

  it("removing the source strips the ramp modifier and its progress entirely", () => {
    const s = freshState();
    applyEffects(s, [{ type: "rampRate", target: "finish", perDay: 0.5, cap: 2 }], "inst-x");
    // Mimics removeDecision/payroll-failure removal: strip all modifiers by source.
    s.modifiers = s.modifiers.filter((m) => m.source !== "inst-x");
    expect(effectiveRate(s, "finish")).toBe(1);
  });

  it("continuousDeploy is a marker effect: it creates no modifier", () => {
    const s = freshState();
    applyEffects(s, [{ type: "continuousDeploy" }], "src-1");
    expect(s.modifiers).toHaveLength(0);
    expect(s.nextModifierId).toBe(1); // untouched: no modifier was ever pushed
  });

  it("a ramp modifier's progress round-trips through a save/restore mid-growth", () => {
    const content = freshContent();
    const a = initialState(content);
    const rngA = createRng(content.start.seed);
    const noChallenges = () => {};
    applyEffects(a, [{ type: "rampRate", target: "finish", perDay: 0.5, cap: 2 }], "src-1");
    for (let i = 0; i < 3; i++) tick(a, rngA, content, noChallenges);

    // real JSON round-trip, not just a deep copy: proves rampPerDay/rampCap
    // and mid-growth value survive serialize/deserialize
    const b = deserialize(serialize(a));
    const ramp = b.modifiers.find((m) => m.rampPerDay !== undefined)!;
    expect(ramp.rampPerDay).toBe(0.5);
    expect(ramp.rampCap).toBe(2);
    expect(ramp.value).toBe(1.5); // 3 ticks * 0.5
    const rngB = createRng(b.rngState, true);

    for (let i = 0; i < 4; i++) {
      tick(a, rngA, content, noChallenges);
      tick(b, rngB, content, noChallenges);
    }
    expect(b).toEqual(a);
  });
});
