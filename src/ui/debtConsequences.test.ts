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
  it("teaches the free band at the start of a Studio game", () => {
    const content = studio();
    const state = initialState(content);
    expect(debtConsequenceTone(state)).toBe("ok");
    expect(debtConsequenceParts(state, content)).toEqual(["no slowdown until 400"]);
    expect(renderDebtConsequences(state, content)).toContain("no slowdown until 400");
    expect(renderDebtConsequences(state, content)).not.toContain("Production incident");
    expect(renderDebtConsequences(state, content)).not.toContain("rework");
  });

  it("names delivery drag once debt passes the free band", () => {
    const content = studio();
    const state = initialState(content);
    // excess 1000 * 0.00015 = 0.15 -> 15% slower
    state.stocks.techDebt = 1400;
    expect(debtConsequenceTone(state)).toBe("warn");
    expect(debtConsequenceParts(state, content)).toContain("15% slower");
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

  it("adds rework once the first project has shipped", () => {
    const content = studio();
    const state = initialState(content);
    state.completedProjects = 1;
    expect(debtConsequenceParts(state, content)).toEqual([
      "no slowdown until 400",
      "rework +0.5 per ship",
    ]);
  });

  it("includes Company incident odds only when that challenge is live", () => {
    const content = loadShippedContent("company");
    const gated = initialState(content);
    expect(debtConsequenceParts(gated, content).some((p) => p.includes("Production incident"))).toBe(false);

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
