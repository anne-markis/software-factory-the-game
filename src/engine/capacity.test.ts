import { describe, it, expect } from "vitest";
import { applySeatCapacity, effectiveCapacity } from "./capacity";
import { Engine, initialState } from "./engine";
import { applyEffects } from "./effects";
import { parseStartConfig, parseDecisions } from "./content";
import { decisionsJson, startJson } from "./loadShippedContent";
import { unshippedWork } from "./work";
import { activateDueInstances } from "./tick";
import type { DecisionDef, GameContent, GameState } from "./types";

function shippedContent(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: [],
    projects: [],
  };
}

function def(partial: Partial<DecisionDef> & { id: string }): DecisionDef {
  return {
    name: partial.id,
    description: "x",
    category: "ship-faster",
    cost: {},
    effects: [],
    removable: true,
    ...partial,
  };
}

describe("effectiveCapacity", () => {
  it("is the founder base with no owned cards", () => {
    const content = shippedContent();
    expect(effectiveCapacity(initialState(content), content)).toBe(1);
  });

  it("adds DecisionDef.capacity per owned hire and ignores agents", () => {
    const content = shippedContent();
    const e = new Engine(content);
    const s = e.getState() as GameState;
    s.decisions.push({ instanceId: "h1", defId: "basic-dev" }, { instanceId: "a1", defId: "agent" });
    expect(effectiveCapacity(s, content)).toBe(2);
    s.decisions.push({ instanceId: "h2", defId: "basic-dev" });
    expect(effectiveCapacity(s, content)).toBe(3);
  });

  it("does not key off the human flag: a non-human card with capacity still adds a seat", () => {
    const content: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [def({ id: "bot", capacity: 4 })],
      challenges: [],
      projects: [],
    };
    const s = initialState(content);
    s.decisions.push({ instanceId: "i1", defId: "bot" });
    expect(effectiveCapacity(s, content)).toBe(5);
  });

  it("capacityFromOwned on one unique card counts other owned instances once", () => {
    const content: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [
        def({ id: "agent" }),
        def({ id: "fleet", unique: true, capacityFromOwned: [{ id: "agent", per: 1 }] }),
      ],
      challenges: [],
      projects: [],
    };
    const s = initialState(content);
    s.decisions.push(
      { instanceId: "a1", defId: "agent" },
      { instanceId: "a2", defId: "agent" },
      { instanceId: "f", defId: "fleet" },
    );
    expect(effectiveCapacity(s, content)).toBe(3);
  });

  it("applySeatCapacity finishes at speed then fills seats from Ready", () => {
    const s = initialState(shippedContent());
    const { finishFlow, pullFlow } = applySeatCapacity(s, 1, 1);
    expect(finishFlow).toBe(1);
    expect(s.stocks.inProgress).toBe(1);
    expect(s.stocks.backlog).toBe(298);
    expect(s.stocks.inReview).toBe(1);
    expect(s.stocks.done).toBe(0);
    expect(pullFlow).toBe(2);
    expect(unshippedWork(s)).toBe(300);
  });

  it("lets finish outrun seat count: speed moves the pool, seats only split leftover", () => {
    const s = initialState(shippedContent());
    applySeatCapacity(s, 1, 3);
    expect(s.stocks.inProgress).toBe(1);
    expect(s.stocks.inReview).toBe(3);
    expect(s.stocks.done).toBe(0);
    expect(s.stocks.backlog).toBe(296);
  });

  it("spills extra In Progress back to Ready when capacity drops", () => {
    const s = initialState(shippedContent());
    s.stocks.inProgress = 5;
    s.stocks.backlog = 10;
    applySeatCapacity(s, 1, 0);
    expect(s.stocks.inProgress).toBe(1);
    expect(s.stocks.backlog).toBe(14);
  });

  it("modifyCapacity add/mul stack after owned-def capacity", () => {
    const content = shippedContent();
    const s = initialState(content);
    s.decisions.push({ instanceId: "h1", defId: "basic-dev" });
    applyEffects(s, [{ type: "modifyCapacity", op: "add", value: 2 }], "card");
    expect(effectiveCapacity(s, content)).toBe(4);
    applyEffects(s, [{ type: "modifyCapacity", op: "mul", value: 2 }], "mul");
    expect(effectiveCapacity(s, content)).toBe(8);
  });
});

function settleHires(e: Engine): void {
  const s = e.getState() as GameState;
  for (const inst of s.decisions) {
    if (inst.activeOnDay !== undefined && inst.activeOnDay > s.day) inst.activeOnDay = s.day;
  }
  activateDueInstances(s, e.getContent());
}

describe("tick seats", () => {
  it("keeps In Progress at founder capacity while Ready waits", () => {
    const e = new Engine(shippedContent());
    e.tick();
    const s = e.getState();
    expect(s.stocks.inProgress).toBe(1);
    expect(s.stocks.backlog).toBe(298);
    expect(s.stocks.inReview).toBe(1);
    expect(s.stocks.done).toBe(0);
    e.tick();
    const s2 = e.getState();
    expect(s2.stocks.inProgress).toBe(1);
    expect(s2.stocks.backlog).toBe(297);
    expect(s2.stocks.inReview).toBe(1);
    expect(s2.stocks.done).toBe(1);
  });

  it("a hire raises In Progress; agents do not", () => {
    const e = new Engine(shippedContent());
    const s = e.getState() as GameState;
    s.decisions.push({ instanceId: "h1", defId: "basic-dev" }, { instanceId: "a1", defId: "agent" });
    s.modifiers.push({ id: "m", source: "a1", target: "finish", op: "add", value: 0.2 });
    e.tick();
    expect(e.getState().stocks.inProgress).toBe(2);
  });

  it("a hire fills the extra seat from Ready when they start, without finishing", () => {
    const e = new Engine(shippedContent());
    e.tick();
    const before = e.getState();
    const ready = before.stocks.backlog;
    const done = before.stocks.done;
    e.applyDecision("basic-dev");
    expect(e.getState().stocks.inProgress).toBe(1);
    settleHires(e);
    const s = e.getState();
    expect(s.stocks.inProgress).toBe(2);
    expect(s.stocks.backlog).toBe(ready - 1);
    expect(s.stocks.done).toBe(done);
  });

  it("an agent does not fill extra seats on purchase", () => {
    const e = new Engine(shippedContent());
    e.tick();
    e.applyDecision("agent");
    expect(e.getState().stocks.inProgress).toBe(1);
  });

  it("removing a hire spills the extra seat back to Ready immediately", () => {
    const e = new Engine(shippedContent());
    e.tick();
    e.applyDecision("basic-dev");
    settleHires(e);
    expect(e.getState().stocks.inProgress).toBe(2);
    const ready = e.getState().stocks.backlog;
    const done = e.getState().stocks.done;
    e.removeDecision(e.getState().decisions[0]!.instanceId);
    const s = e.getState();
    expect(s.stocks.inProgress).toBe(1);
    expect(s.stocks.backlog).toBe(ready + 1);
    expect(s.stocks.done).toBe(done);
  });

  it("does not fill extra hire seats while delivery is frozen", () => {
    const content = shippedContent();
    const e = new Engine(content);
    e.tick();
    expect(e.getState().stocks.inProgress).toBe(1);
    e.applyDecision("basic-dev");
    const s = e.getState() as GameState;
    s.stocks.budget = 0;
    settleHires(e);
    expect(e.getState().stocks.inProgress).toBe(1);
  });
});
