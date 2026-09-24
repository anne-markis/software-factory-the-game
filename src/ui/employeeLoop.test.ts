import { describe, expect, it } from "vitest";
import { Engine, initialState } from "../engine/engine";
import { parseStartConfig, parseDecisions } from "../engine/content";
import { decisionsJson, startJson } from "../engine/loadShippedContent";
import type { GameContent } from "../engine/types";
import { employeeLoopSvg } from "./employeeLoop";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("employeeLoopSvg", () => {
  it("renders reputation, morale, employees, and the overload leak", () => {
    const svg = employeeLoopSvg(initialState(content()), content());
    expect(svg).toContain("Reputation");
    expect(svg).toContain("Morale");
    expect(svg).toContain("Employees");
    expect(svg).toContain("oversight");
    expect(svg).toContain("quit");
    expect(svg).toContain('aria-label="Employee loop"');
    expect(svg).toContain('data-coupling="true"');
    expect(svg).toContain(">70<");
    expect(svg).toContain(">0<");
  });

  it("shows joining headcount after a delayed hire", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const svg = employeeLoopSvg(e.getState(), content());
    expect(svg).toContain("(+1 join)");
  });
});
