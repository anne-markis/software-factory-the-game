import { describe, it, expect } from "vitest";
import { loopDiagramSvg } from "./loopDiagram";
import { initialState } from "../engine/engine";
import { parseStartConfig, parseDecisions } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import type { GameContent } from "../engine/types";

function emptyContent(): GameContent {
  return { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] };
}

function fullDecisionsContent(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("loopDiagramSvg", () => {
  it("renders one box per stage with stock values and rates", () => {
    const content = emptyContent();
    const state = initialState(content);
    const svg = loopDiagramSvg(state, content);
    expect(svg).toContain("<svg");
    for (const label of ["Backlog", "In Progress", "Done", "Shipped"]) expect(svg).toContain(label);
    expect(svg).toContain("1,500"); // backlog value
    expect(svg).toContain("1.0/day"); // base rates
    expect(svg).toContain("debt +0.5/pt"); // regen arrow label
    expect(svg.match(/<line /g)).toHaveLength(3); // pull, finish, deploy
  });

  it("drops the Done box and shows the continuous-deploy caption once ci-cd is owned", () => {
    const content = fullDecisionsContent();
    const state = initialState(content);
    // Mutable escape hatch: grant ci-cd directly rather than routing through
    // a full purchase (requires/budget/gamble are exercised elsewhere).
    state.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
    const svg = loopDiagramSvg(state, content);
    expect(svg).toContain("Backlog");
    expect(svg).toContain("In Progress");
    expect(svg).toContain("Shipped");
    expect(svg).not.toContain(">Done<");
    expect(svg).toContain("continuous deploy");
    expect(svg.match(/<line /g)).toHaveLength(2); // pull, finish only
  });
});
