import { describe, it, expect } from "vitest";
import { initialState } from "../engine/engine";
import { loadShippedContent } from "../engine/loadShippedContent";
import type { GameContent } from "../engine/types";
import {
  debtConsequenceTone,
  debtDragLabel,
  debtToneClass,
  formatThroughputValue,
} from "./debtConsequences";

function studio(): GameContent {
  return loadShippedContent("studio");
}

describe("debt drag status", () => {
  it("is silent on a fresh game: no suffix, no tone", () => {
    const state = initialState(studio());
    expect(debtConsequenceTone(state)).toBe("ok");
    expect(debtToneClass("ok")).toBeUndefined();
    expect(debtDragLabel(state)).toBeNull();
    expect(formatThroughputValue(state)).toBe("0");
  });

  it("names the slowdown on throughput once past the free band", () => {
    const state = initialState(studio());
    // excess 1000 * 0.00015 = 0.15 -> 15%
    state.stocks.techDebt = 1400;
    state.pointsPerDay = 1.7;
    expect(debtConsequenceTone(state)).toBe("warn");
    expect(debtToneClass("warn")).toBe("debt-warn");
    expect(debtDragLabel(state)).toBe("-15%");
    expect(formatThroughputValue(state)).toBe("1.7 (-15%)");
  });

  it("caps the slowdown readout at maxDrag", () => {
    const state = initialState(studio());
    state.stocks.techDebt = 10_000;
    state.pointsPerDay = 0.6;
    expect(debtConsequenceTone(state)).toBe("high");
    expect(debtToneClass("high")).toBe("debt-high");
    expect(debtDragLabel(state)).toBe("-40%");
    expect(formatThroughputValue(state)).toBe("0.6 (-40%)");
  });
});
