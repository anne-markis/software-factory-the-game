import { describe, expect, it } from "vitest";
import { Engine, initialState } from "../engine/engine";
import { parseStartConfig, parseDecisions } from "../engine/content";
import { decisionsJson, startJson } from "../engine/loadShippedContent";
import type { GameContent } from "../engine/types";
import { agentLoopSvg } from "./agentLoop";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("agentLoopSvg", () => {
  it("renders humans, oversight, agents, and the fleet leak", () => {
    const svg = agentLoopSvg(initialState(content()), content());
    expect(svg).toContain("Humans");
    expect(svg).toContain("Oversight");
    expect(svg).toContain("Agents");
    expect(svg).toContain("in policy");
    expect(svg).toContain("fleet");
    expect(svg).toContain('aria-label="Agent loop"');
    expect(svg).toContain('data-coupling="true"');
    expect(svg).toContain(">100<");
    expect(svg).toContain(">0<");
  });

  it("counts the founder and a joining hire separately", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const svg = agentLoopSvg(e.getState(), content());
    expect(svg).toContain("1 (+1 join)");
  });
});
