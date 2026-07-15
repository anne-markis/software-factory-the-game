import { describe, it, expect } from "vitest";
import { applyEffects } from "./effects";
import { initialState } from "./engine";
import { parseStartConfig } from "./content";
import startJson from "../../content/start.json";
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
    expect(effectiveRate(s, "pull")).toBe(0.5);
    expect(s.modifiers[0].expiresDay).toBe(5); // day 0 + 5
  });

  it("modifyRate with a specific target and add op only affects that rate", () => {
    const s = freshState();
    applyEffects(s, [{ type: "modifyRate", target: "pull", op: "add", value: 1 }], "src-1");
    expect(effectiveRate(s, "pull")).toBe(2);
    expect(effectiveRate(s, "finish")).toBe(1);
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
    expect(s.stocks.backlog).toBe(10200);
  });

  it("sickness marks the instance from context", () => {
    const s = freshState();
    s.decisions.push({ instanceId: "i1", defId: "basic-dev" });
    applyEffects(s, [{ type: "sickness", factor: 0.7, durationDays: 5 }], "chal-1", { instanceId: "i1" });
    expect(s.decisions[0].sickUntilDay).toBe(5);
    expect(s.decisions[0].sickFactor).toBe(0.7);
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
    expect(effectiveRate(s, "pull")).toBe(0.5);
    tick(s, rng, content, noChallenges);
    expect(s.day).toBe(5);
    expect(s.modifiers).toHaveLength(0);
    expect(effectiveRate(s, "pull")).toBe(1);
  });
});
