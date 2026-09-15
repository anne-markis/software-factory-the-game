import { describe, it, expect } from "vitest";
import { initialState } from "../engine/engine";
import { parseStartConfig } from "../engine/content";
import { loadShippedContent, startJson } from "../engine/loadShippedContent";
import type { GameContent } from "../engine/types";
import {
  debtConsequenceParts,
  debtConsequenceTone,
  renderDebtConsequences,
} from "./debtConsequences";

function studio(): GameContent {
  return loadShippedContent("studio");
}

describe("debtConsequenceParts", () => {
  it("names slowdown and rework on a fresh Studio game, before any debt exists", () => {
    const content = studio();
    const state = initialState(content);
    expect(debtConsequenceTone(state)).toBe("ok");
    expect(debtConsequenceParts(state, content)).toEqual([
      "slows delivery after 400 (up to 40%)",
      "adds rework after first ship",
    ]);
    const html = renderDebtConsequences(state, content);
    expect(html).toContain("High tech debt");
    expect(html).toContain("slows delivery after 400 (up to 40%)");
    expect(html).toContain("adds rework after first ship");
    expect(html).not.toContain("Production incident");
    expect(html).not.toContain("no slowdown");
  });

  it("names delivery drag once debt passes the free band", () => {
    const content = studio();
    const state = initialState(content);
    // excess 1000 * 0.00015 = 0.15 -> 15% slower
    state.stocks.techDebt = 1400;
    expect(debtConsequenceTone(state)).toBe("warn");
    expect(debtConsequenceParts(state, content)).toContain("15% slower (up to 40%)");
    expect(renderDebtConsequences(state, content)).toContain("data-debt-tone=\"warn\"");
    expect(renderDebtConsequences(state, content)).toContain("debt-warn");
  });

  it("caps the slowdown readout at maxDrag", () => {
    const content = studio();
    const state = initialState(content);
    state.stocks.techDebt = 10_000;
    expect(debtConsequenceTone(state)).toBe("high");
    expect(debtConsequenceParts(state, content)).toContain("40% slower (max)");
    expect(renderDebtConsequences(state, content)).toContain("debt-high");
  });

  it("switches rework to a live per-ship amount once the first project has shipped", () => {
    const content = studio();
    const state = initialState(content);
    state.completedProjects = 1;
    expect(debtConsequenceParts(state, content)).toEqual([
      "slows delivery after 400 (up to 40%)",
      "rework +0.5 per ship",
    ]);
  });

  it("names Company incidents even before they can fire, then shows live odds", () => {
    const content = loadShippedContent("company");
    const gated = initialState(content);
    expect(debtConsequenceParts(gated, content)).toContain("Production incident more likely as debt rises");

    const live = initialState(content);
    live.completedProjects = 1;
    live.stocks.techDebt = 500;
    const parts = debtConsequenceParts(live, content);
    expect(parts).toContain("Production incident 2%/day");
    expect(renderDebtConsequences(live, content)).toContain("Production incident 2%/day");
  });

  it("escapes challenge names in the HTML", () => {
    const start = parseStartConfig(startJson);
    const content: GameContent = {
      start,
      decisions: [],
      projects: [],
      challenges: [
        {
          id: "x",
          name: "<boom>",
          description: "desc",
          probabilityPerDay: 0.01,
          probScaling: { stat: "techDebt", per: 500, add: 0.01 },
          effects: [],
        },
      ],
    };
    const state = initialState(content);
    const html = renderDebtConsequences(state, content);
    expect(html).not.toContain("<boom>");
    expect(html).toContain("&lt;boom&gt;");
  });
});
