import { describe, it, expect } from "vitest";
import { serialize, deserialize, SAVE_VERSION } from "./save";
import { Engine } from "./engine";
import { parseStartConfig, parseDecisions } from "./content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import type { GameContent } from "./types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("save/load", () => {
  it("round-trips state and continues the rng sequence identically", () => {
    const c = content();
    const a = new Engine(c);
    for (let i = 0; i < 5; i++) a.tick();
    a.applyDecision("basic-dev");

    const saved = serialize(a.getState());
    const b = new Engine(c, deserialize(saved));
    expect(b.getState()).toEqual(a.getState());

    // both continue identically (same rng state)
    a.applyDecision("agent");
    b.applyDecision("agent");
    a.tick();
    b.tick();
    expect(b.getState()).toEqual(a.getState());
  });

  it("rejects an unknown save version", () => {
    const bad = JSON.stringify({ version: SAVE_VERSION + 1, state: {} });
    expect(() => deserialize(bad)).toThrow(/version/);
  });

  it("defaults missing id counters from existing ids (legacy save shape)", () => {
    const c = content();
    const a = new Engine(c);
    a.applyDecision("basic-dev"); // creates inst-1 and mod-1
    const raw = JSON.parse(serialize(a.getState()));
    delete raw.state.nextModifierId;
    delete raw.state.nextInstanceId;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.nextModifierId).toBe(2);
    expect(restored.nextInstanceId).toBe(2);
  });
});
