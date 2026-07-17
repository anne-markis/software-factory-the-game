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

  // Release-7 bug fix: main.ts only autosaved every 10 days, so the paused
  // flag (part of saved state) was usually stale on reload and the game
  // would un-pause itself. The fix is event-driven saving in the UI layer
  // (src/ui/main.ts), which localStorage-based storage.ts can't be tested
  // against here without jsdom; this pins the underlying engine-level
  // contract instead: paused round-trips through serialize/deserialize and a
  // freshly constructed Engine honors it (tick is a no-op while paused).
  it("round-trips a paused state and the restored engine stays paused", () => {
    const c = content();
    const a = new Engine(c);
    a.pause();
    const saved = serialize(a.getState());

    const restoredState = deserialize(saved);
    expect(restoredState.paused).toBe(true);

    const b = new Engine(c, restoredState);
    expect(b.getState().paused).toBe(true);
    const dayBefore = b.getState().day;
    b.tick();
    expect(b.getState().day).toBe(dayBefore);
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

  it("defaults a missing challengeLastFired to {} (legacy save shape)", () => {
    const c = content();
    const a = new Engine(c);
    const raw = JSON.parse(serialize(a.getState()));
    delete raw.state.challengeLastFired;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.challengeLastFired).toEqual({});
  });

  // gameSeed post-dates challenge cooldowns; deserialize has no content access,
  // so the Engine constructor backfills it from content.start.seed. Legacy
  // saves that predate the field must resume with challenge rolls keyed off the
  // correct seed rather than undefined.
  it("Engine backfills a missing gameSeed from content (legacy save shape)", () => {
    const c = content();
    const a = new Engine(c);
    const raw = JSON.parse(serialize(a.getState()));
    delete raw.state.gameSeed;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.gameSeed).toBeUndefined(); // deserialize cannot know the seed
    const b = new Engine(c, restored);
    expect(b.getState().gameSeed).toBe(c.start.seed);
  });
});
