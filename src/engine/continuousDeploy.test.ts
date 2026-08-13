import { describe, it, expect } from "vitest";
import { continuousDeployActive } from "./continuousDeploy";
import { Engine } from "./engine";
import { parseStartConfig, parseDecisions } from "./content";
import { decisionsJson, startJson } from "./loadShippedContent";
import type { GameContent, GameState } from "./types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("continuousDeployActive", () => {
  it("is false on a fresh game with no decisions owned", () => {
    const c = content();
    const e = new Engine(c);
    expect(continuousDeployActive(e.getState() as GameState, c)).toBe(false);
  });

  it("is true once ci-cd (a decision whose base effects include continuousDeploy) is owned", () => {
    const c = content();
    const e = new Engine(c);
    e.applyDecision("test-suite");
    e.applyDecision("ci-cd");
    expect(continuousDeployActive(e.getState() as GameState, c)).toBe(true);
  });

  it("is false again if the granting instance is removed (engine cleanliness: derived from ownership, not sticky)", () => {
    const c = content();
    const e = new Engine(c);
    e.applyDecision("test-suite");
    e.applyDecision("ci-cd");
    const state = e.getState() as GameState;
    const inst = state.decisions.find((d) => d.defId === "ci-cd")!;
    // Mutable escape hatch: ci-cd is non-removable in shipped content, so
    // this bypasses removeDecision's guard to prove the check is truly
    // derived rather than cached/sticky.
    state.decisions = state.decisions.filter((d) => d.instanceId !== inst.instanceId);
    expect(continuousDeployActive(state, c)).toBe(false);
  });
});
