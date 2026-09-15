import { describe, it, expect } from "vitest";
import { initialState } from "../engine/engine";
import { loadShippedContent } from "../engine/loadShippedContent";
import type { GameContent } from "../engine/types";
import {
  debtConsequenceTone,
  debtDragLabel,
  debtRegenCaption,
  formatDebtStatValue,
} from "./debtConsequences";

function studio(): GameContent {
  return loadShippedContent("studio");
}

describe("debt drag status", () => {
  it("is silent on a fresh game: just the number, no lecture", () => {
    const state = initialState(studio());
    expect(debtConsequenceTone(state)).toBe("ok");
    expect(debtDragLabel(state)).toBeNull();
    expect(formatDebtStatValue(state)).toBe("0");
    expect(debtRegenCaption(state, "0.5")).toBe("debt +0.5/pt");
  });

  it("names the slowdown on the Tech Debt stat once past the free band", () => {
    const state = initialState(studio());
    // excess 1000 * 0.00015 = 0.15 -> 15% slower
    state.stocks.techDebt = 1400;
    expect(debtConsequenceTone(state)).toBe("warn");
    expect(debtDragLabel(state)).toBe("15% slower");
    expect(formatDebtStatValue(state)).toBe("1,400 (15% slower)");
    expect(debtRegenCaption(state, "0.5")).toBe("debt +0.5/pt · 15% slower");
  });

  it("caps the slowdown readout at maxDrag", () => {
    const state = initialState(studio());
    state.stocks.techDebt = 10_000;
    expect(debtConsequenceTone(state)).toBe("high");
    expect(debtDragLabel(state)).toBe("40% slower (max)");
    expect(formatDebtStatValue(state)).toContain("40% slower (max)");
  });
});
