import { describe, it, expect } from "vitest";
import { applyEffects } from "./effects";
import { initialState } from "./engine";
import { parseStartConfig } from "./content";
import startJson from "../../content/start.json";
import { effectiveRate, effectiveDebtMultiplier } from "./modifiers";
import type { GameContent } from "./types";

function freshState() {
  const content: GameContent = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] };
  return initialState(content);
}

describe("applyEffects", () => {
  it("modifyRate creates a modifier that changes effective rate", () => {
    const s = freshState();
    applyEffects(s, [{ type: "modifyRate", target: "all", op: "mul", value: 0.5, durationDays: 5 }], "src-1");
    expect(effectiveRate(s, "pull")).toBe(0.5);
    expect(s.modifiers[0].expiresDay).toBe(5); // day 0 + 5
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
  });

  it("sickness marks the instance from context", () => {
    const s = freshState();
    s.decisions.push({ instanceId: "i1", defId: "basic-dev" });
    applyEffects(s, [{ type: "sickness", factor: 0.7, durationDays: 5 }], "chal-1", { instanceId: "i1" });
    expect(s.decisions[0].sickUntilDay).toBe(5);
    expect(s.decisions[0].sickFactor).toBe(0.7);
  });
});
