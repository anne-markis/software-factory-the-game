import { describe, it, expect } from "vitest";
import { initialState } from "./engine";
import { debtDragMultiplier, stockDragMultiplier, effectiveRate, contextSwitchTax } from "./modifiers";
import { parseStartConfig } from "./content";
import { startJson } from "./loadShippedContent";
import type { GameContent, GameState, StockDrag } from "./types";

// Build a state with clean drag constants (freeDebt 100, dragPerPoint 0.001,
// maxDrag 0.5) so the arithmetic below is exact rather than tied to whatever
// the shipped start.json is currently tuned to.
function stateWithDebt(techDebt: number): GameState {
  const start = { ...parseStartConfig(startJson), debtDrag: { freeDebt: 100, dragPerPoint: 0.001, maxDrag: 0.5 } };
  const content: GameContent = { start, decisions: [], challenges: [], projects: [] };
  const s = initialState(content);
  s.stocks.techDebt = techDebt;
  return s;
}

describe("debtDragMultiplier", () => {
  it("is exactly 1 below the free-debt grace band", () => {
    expect(debtDragMultiplier(stateWithDebt(0))).toBe(1);
    expect(debtDragMultiplier(stateWithDebt(50))).toBe(1);
  });

  it("is exactly 1 at the free-debt boundary (excess 0)", () => {
    expect(debtDragMultiplier(stateWithDebt(100))).toBe(1);
  });

  it("drags linearly with excess debt in the sub-cap region", () => {
    // excess 200 * 0.001 = 0.2 drag -> multiplier 0.8
    expect(debtDragMultiplier(stateWithDebt(300))).toBeCloseTo(0.8, 10);
    // excess 400 * 0.001 = 0.4 drag -> multiplier 0.6
    expect(debtDragMultiplier(stateWithDebt(500))).toBeCloseTo(0.6, 10);
  });

  it("caps the drag at maxDrag no matter how high the debt", () => {
    // excess 900 * 0.001 = 0.9, capped at 0.5 -> multiplier 0.5
    expect(debtDragMultiplier(stateWithDebt(1000))).toBeCloseTo(0.5, 10);
    // and stays there far past the cap
    expect(debtDragMultiplier(stateWithDebt(1_000_000))).toBeCloseTo(0.5, 10);
  });

  it("is applied inside effectiveRate alongside the context-switch tax", () => {
    const s = stateWithDebt(300); // multiplier 0.8
    expect(s.projects.length).toBe(1); // single project -> context switch tax is 1
    expect(contextSwitchTax(s)).toBe(1);
    // base rate 1.0 * drag 0.8 = 0.8
    expect(effectiveRate(s, "finish")).toBeCloseTo(0.8, 10);

    // Add a second project so the context-switch tax also engages, and confirm
    // both multipliers stack (0.85 tax * 0.8 drag on the base 1.0 rate).
    s.projects.push({ ...s.projects[0], defId: "second", name: "Second" });
    expect(effectiveRate(s, "finish")).toBeCloseTo(0.85 * 0.8, 10);
  });

  it("does not drag at all when debt sits below the band (effectiveRate unchanged)", () => {
    const s = stateWithDebt(50);
    expect(effectiveRate(s, "pull")).toBe(s.baseRates.pull); // multiplier is exactly 1
  });
});

// Studio spine: the users support drag. Mirrors debtDrag but keyed
// on a stock and pointed at a rate (or "all"). Uses clean fixture constants
// rather than the shipped tuning so the arithmetic is exact.
describe("stockDragMultiplier", () => {
  function stateWithUsers(users: number, drags: StockDrag[]): GameState {
    const content: GameContent = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] };
    const s = initialState(content);
    s.stocks.users = users;
    s.stockDrags = drags;
    return s;
  }

  const usersDrag: StockDrag = { stock: "users", freeBand: 25, dragPerPoint: 0.004, maxDrag: 0.35, target: "all" };

  it("is exactly 1 at or below the free band", () => {
    expect(stockDragMultiplier(stateWithUsers(0, [usersDrag]), "pull")).toBe(1);
    expect(stockDragMultiplier(stateWithUsers(25, [usersDrag]), "finish")).toBe(1);
  });

  it("drags linearly with excess users above the free band, until the cap", () => {
    // excess 50 * 0.004 = 0.2 drag -> 0.8; excess 75 * 0.004 = 0.3 -> 0.7.
    expect(stockDragMultiplier(stateWithUsers(75, [usersDrag]), "pull")).toBeCloseTo(0.8, 10);
    expect(stockDragMultiplier(stateWithUsers(100, [usersDrag]), "pull")).toBeCloseTo(0.7, 10);
    // Past the cap (excess 200 * 0.004 = 0.8, capped at 0.35 -> 0.65) it holds.
    expect(stockDragMultiplier(stateWithUsers(225, [usersDrag]), "pull")).toBeCloseTo(0.65, 10);
    expect(stockDragMultiplier(stateWithUsers(100000, [usersDrag]), "pull")).toBeCloseTo(0.65, 10);
  });

  it("only drags the rates its target names", () => {
    const finishOnly: StockDrag = { ...usersDrag, target: "finish" };
    const s = stateWithUsers(100, [finishOnly]);
    expect(stockDragMultiplier(s, "finish")).toBeCloseTo(0.7, 10);
    expect(stockDragMultiplier(s, "pull")).toBe(1); // untouched: not its target
  });

  it("is applied inside effectiveRate above the free band, stacking with the context-switch tax", () => {
    const s = stateWithUsers(100, [usersDrag]); // multiplier 0.7 on all rates
    expect(effectiveRate(s, "finish")).toBeCloseTo(0.7, 10); // base 1.0 * 0.7
    s.projects.push({ ...s.projects[0], defId: "second", name: "Second" });
    expect(effectiveRate(s, "finish")).toBeCloseTo(0.85 * 0.7, 10); // stacks with the tax
  });
});
