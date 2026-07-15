import { describe, it, expect } from "vitest";
import { loopDiagramSvg } from "./loopDiagram";
import { initialState } from "../engine/engine";
import { parseStartConfig } from "../engine/content";
import startJson from "../../content/start.json";

describe("loopDiagramSvg", () => {
  it("renders one box per stage with stock values and rates", () => {
    const state = initialState({ start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] });
    const svg = loopDiagramSvg(state);
    expect(svg).toContain("<svg");
    for (const label of ["Backlog", "In Progress", "Done", "Shipped"]) expect(svg).toContain(label);
    expect(svg).toContain("10,000"); // backlog value
    expect(svg).toContain("1.0/day"); // base rates
    expect(svg).toContain("debt +0.5/pt"); // regen arrow label
  });
});
