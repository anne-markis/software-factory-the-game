import { describe, it, expect } from "vitest";
import { serialize, deserialize, SAVE_VERSION } from "./save";
import { Engine, initialState } from "./engine";
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

  // Studio spine (issue #88): SAVE_VERSION bumped to 2 so pre-Studio v1 saves
  // (no users stock, 1500 backlog, First Contract economy) are rejected rather
  // than resumed into an inconsistent state. The UI's loadGame swallows this
  // error and starts fresh, so old saves are wiped silently.
  it("is version 2 and rejects a legacy v1 save so old saves start fresh", () => {
    expect(SAVE_VERSION).toBe(2);
    const legacyV1 = JSON.stringify({ version: 1, state: {} });
    expect(() => deserialize(legacyV1)).toThrow(/version 1/);
  });

  // A fresh Studio save round-trips its users stock and always-on stockDrags.
  it("round-trips the users stock and stockDrags (Studio spine)", () => {
    const c = content();
    const a = new Engine(c);
    a.tick();
    const restored = deserialize(serialize(a.getState()));
    expect(restored.stocks.users).toBe(a.getState().stocks.users);
    expect(restored.stockDrags).toEqual(a.getState().stockDrags);
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
    a.applyDecision("basic-dev"); // creates inst-1 and mod-1 + mod-2 (pull, finish)
    const raw = JSON.parse(serialize(a.getState()));
    delete raw.state.nextModifierId;
    delete raw.state.nextInstanceId;
    const restored = deserialize(JSON.stringify(raw));
    // basic-dev's hire outcome is two add modifiers (pull and finish) since
    // Release 15's deploy-bottleneck rework, so the highest mod suffix is 2.
    expect(restored.nextModifierId).toBe(3);
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

  // debtDrag config (Release 15) is copied into state at init like the
  // contextSwitchFactor pattern; deserialize has no content access, so the
  // Engine constructor backfills all three fields from content.start.debtDrag,
  // mirroring the gameSeed backfill. Legacy saves predate the fields.
  it("Engine backfills missing debtDrag config from content (legacy save shape)", () => {
    const c = content();
    const a = new Engine(c);
    const raw = JSON.parse(serialize(a.getState()));
    delete raw.state.debtDragFreeDebt;
    delete raw.state.debtDragPerPoint;
    delete raw.state.debtDragMaxDrag;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.debtDragFreeDebt).toBeUndefined(); // deserialize cannot know it
    const b = new Engine(c, restored);
    expect(b.getState().debtDragFreeDebt).toBe(c.start.debtDrag.freeDebt);
    expect(b.getState().debtDragPerPoint).toBe(c.start.debtDrag.dragPerPoint);
    expect(b.getState().debtDragMaxDrag).toBe(c.start.debtDrag.maxDrag);
  });

  // archetypesSeen (Release 15) defaults to [] and is content-free, so unlike
  // debtDrag it is defaulted in deserialize itself (like challengeLastFired).
  it("defaults a missing archetypesSeen to [] (legacy save shape)", () => {
    const c = content();
    const a = new Engine(c);
    const raw = JSON.parse(serialize(a.getState()));
    delete raw.state.archetypesSeen;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.archetypesSeen).toEqual([]);
  });

  // lastChallengeDay (Release 9, global event spacing) is a plain optional
  // field, unlike nextModifierId/nextInstanceId/challengeLastFired above: it
  // is absent until the first challenge ever fires, and "absent" is already
  // the correct value for a legacy save, so deserialize needs no defensive
  // default -- JSON.parse/stringify round-trips it (or its absence) as-is.
  it("round-trips a populated lastChallengeDay", () => {
    const c = content();
    const state = initialState(c);
    state.lastChallengeDay = 42;
    const saved = serialize(state);
    const restored = deserialize(saved);
    expect(restored.lastChallengeDay).toBe(42);
  });

  // reputation (Release 17) lives in stocks, a plain object round-tripped
  // through JSON with no per-field defaulting; like gameSeed/debtDrag,
  // deserialize has no content access, so the Engine constructor backfills
  // it from content.start.stocks.reputation.
  it("Engine backfills a missing stocks.reputation from content (legacy save shape)", () => {
    const c = content();
    const a = new Engine(c);
    const raw = JSON.parse(serialize(a.getState()));
    delete raw.state.stocks.reputation;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.stocks.reputation).toBeUndefined(); // deserialize cannot know the baseline
    const b = new Engine(c, restored);
    expect(b.getState().stocks.reputation).toBe(c.start.stocks.reputation);
  });

  // milestonesSeen (Release 17) is content-free like archetypesSeen, so it
  // defaults in deserialize itself rather than the Engine constructor.
  it("defaults a missing milestonesSeen to [] (legacy save shape)", () => {
    const c = content();
    const a = new Engine(c);
    const raw = JSON.parse(serialize(a.getState()));
    delete raw.state.milestonesSeen;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.milestonesSeen).toEqual([]);
  });

  // pullFlow/finishFlow (issue #9) are content-free like archetypesSeen/
  // milestonesSeen, so they default in deserialize itself rather than the
  // Engine constructor. Legacy saves predate both fields entirely; without a
  // default, loopDiagram.ts/inProgressPanel.ts crash calling .toFixed(1) on
  // undefined before the first tick ever runs.
  it("defaults missing pullFlow/finishFlow to 0 (legacy save shape)", () => {
    const c = content();
    const a = new Engine(c);
    const raw = JSON.parse(serialize(a.getState()));
    delete raw.state.pullFlow;
    delete raw.state.finishFlow;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.pullFlow).toBe(0);
    expect(restored.finishFlow).toBe(0);
    // and the restored engine renders fine immediately, before any tick
    const b = new Engine(c, restored);
    expect(() => b.tick()).not.toThrow();
  });

  // pointsPerDay (same realized-throughput family as pullFlow/finishFlow,
  // issue #9) defaults in deserialize itself. Legacy saves predate the
  // field; without a default, render.ts crashes calling .toLocaleString()
  // on undefined before the first tick ever runs.
  it("defaults a missing pointsPerDay to 0 (legacy save shape)", () => {
    const c = content();
    const a = new Engine(c);
    const raw = JSON.parse(serialize(a.getState()));
    delete raw.state.pointsPerDay;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.pointsPerDay).toBe(0);
    const b = new Engine(c, restored);
    expect(() => b.tick()).not.toThrow();
  });

  it("loads a legacy save without lastChallengeDay fine (stays undefined, no default needed)", () => {
    const c = content();
    const a = new Engine(c);
    const raw = JSON.parse(serialize(a.getState()));
    delete raw.state.lastChallengeDay;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.lastChallengeDay).toBeUndefined();
    // and the restored engine still runs: absence just means "no gap active yet"
    const b = new Engine(c, restored);
    expect(() => b.tick()).not.toThrow();
  });
});
