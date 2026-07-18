import { describe, it, expect } from "vitest";
import { inProgressPanelSvg } from "./inProgressPanel";
import { Engine } from "../engine/engine";
import { parseStartConfig, parseDecisions } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import type { GameContent } from "../engine/types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("inProgressPanelSvg", () => {
  it("shows the base rate and finish rate box with no contributors on a fresh engine", () => {
    const e = new Engine(content());
    const svg = inProgressPanelSvg(e.getState(), content());
    expect(svg).toContain("Base 1.0/day");
    expect(svg).toContain("1.0/day");
    expect(svg).toContain("Progress loop");
    expect(svg).not.toContain("Hire basic developer");
  });

  it("shows a node for an owned dev with its gamble label and contribution", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const s = e.getState();
    const inst = s.decisions[0];
    const mod = s.modifiers.find((m) => m.source === inst.instanceId)!;
    const svg = inProgressPanelSvg(s, content());
    expect(svg).toContain("Hire basic developer");
    expect(svg).toContain(inst.gambleLabel!);
    expect(svg).toContain(`+${mod.value}/day`);
  });

  it("dims a sick instance and marks it as sick", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const s = e.getState() as GameContentMutableState;
    const inst = s.decisions[0];
    inst.sickUntilDay = s.day + 3;
    inst.sickFactor = 0.5;
    const svg = inProgressPanelSvg(s, content());
    expect(svg).toContain("(sick)");
    expect(svg).toContain('opacity="0.5"');
  });

  it("shows a cleaned-up label for a non-instance (challenge) modifier hitting allRates", () => {
    const e = new Engine(content());
    const s = e.getState() as GameContentMutableState;
    s.modifiers.push({
      id: "mod-test-1",
      source: "chal-prod-incident-d90",
      target: "allRates",
      op: "mul",
      value: 0.8,
      expiresDay: s.day + 2,
    });
    const svg = inProgressPanelSvg(s, content());
    expect(svg).toContain("prod-incident");
    expect(svg).toContain("x0.8");
    expect(svg).toContain("(2d left)");
  });

  it("shows the context-switch tax node when more than one project is active", () => {
    const e = new Engine(content());
    const s = e.getState() as GameContentMutableState;
    s.projects.push({ ...s.projects[0], defId: "second", name: "Second Project" });
    const svg = inProgressPanelSvg(s, content());
    expect(svg).toContain("Context switch x0.85");
  });

  it("labels a ramping add-op modifier with its rounded current value and a (ramping) suffix", () => {
    // Real purchase chain for self-learning-agents runs through agent-harness
    // -> agent-swarm -> self-learning-agents, which is expensive to set up
    // and would tie this test to gamble rng along the way. Instead, inject
    // the owned instance and its ramp modifier directly via the mutable-state
    // escape hatch (same pattern as the sickness and second-project tests
    // above), matching source to instanceId so it renders through the
    // owned-decision branch exactly as the real ramp modifier would.
    const e = new Engine(content());
    const s = e.getState() as GameContentMutableState;
    s.decisions.push({ instanceId: "inst-99", defId: "self-learning-agents" });
    s.modifiers.push({
      id: "mod-test-ramp",
      source: "inst-99",
      target: "finish",
      op: "add",
      value: 0.39999999999999997, // 20 accumulated 0.02 increments; float tail is the point
      rampPerDay: 0.02,
      rampCap: 2.0,
    });
    const svg = inProgressPanelSvg(s, content());
    expect(svg).toContain("Self-learning agents: +0.4/day (ramping)");
    expect(svg).not.toContain("0.39999");
    expect(svg).not.toContain("0.4/day (ramping)/day"); // no double suffix/unit
  });

  it("renders negative contributions with a bare minus, not +-", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const s = e.getState() as GameContentMutableState;
    // force a net-negative outcome shape regardless of the seeded gamble roll
    const mod = s.modifiers.find((m) => m.source === s.decisions[0].instanceId)!;
    mod.value = -0.5;
    const svg = inProgressPanelSvg(s, content());
    expect(svg).toContain("-0.5/day");
    expect(svg).not.toContain("+-0.5");
  });
});

// Local escape hatch: getState() returns Readonly<GameState>, but these tests
// deliberately poke at engine internals (sickness, injected modifiers, a
// second project) that have no public setter API. Cast through this alias
// rather than `any` so the mutated shape stays type-checked.
type GameContentMutableState = import("../engine/types").GameState;
