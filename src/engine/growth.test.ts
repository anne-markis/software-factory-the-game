import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { loadShippedContent } from "./loadShippedContent";
import type { GameState } from "./types";

describe("growth spikes", () => {
  it("starts a new game owning one-time product and does not charge for it", () => {
    const e = new Engine(loadShippedContent());
    const s = e.getState();
    expect(s.stocks.budget).toBe(25000);
    expect(s.decisions.map((d) => d.defId)).toEqual(["one-time-product"]);
    expect(e.availableDecisions().find((a) => a.def.id === "one-time-product")!.code).toBe("already-owned");
  });

  it("a missed round spends the fee and drops morale", () => {
    const e = new Engine(loadShippedContent());
    let missed = false;
    for (let i = 0; i < 30 && !missed; i++) {
      (e.getState() as GameState).stocks.budget = 25000;
      (e.getState() as GameState).stocks.morale = 70;
      e.applyDecision("raise-round");
      const last = e.getState().decisions.at(-1)!;
      if (last.gambleLabel === "Missed the round") {
        missed = true;
        expect(e.getState().stocks.budget).toBe(15000);
        expect(e.getState().stocks.morale).toBe(50);
        expect(e.getState().stocks.reputation).toBe(0);
      }
    }
    expect(missed).toBe(true);
  });

  it("a term sheet pays cash, reputation, and a modest user grant", () => {
    const e = new Engine(loadShippedContent());
    let hit = false;
    for (let i = 0; i < 40 && !hit; i++) {
      (e.getState() as GameState).stocks.budget = 25000;
      e.applyDecision("raise-round");
      const last = e.getState().decisions.at(-1)!;
      if (last.gambleLabel === "Term sheet") {
        hit = true;
        expect(e.getState().stocks.budget).toBe(25000 - 10000 + 600000);
        expect(e.getState().stocks.reputation).toBe(25);
        expect(e.getState().stocks.users).toBe(40);
      }
    }
    expect(hit).toBe(true);
  });

  it("selling opens a new company in the era the new treasury clears", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    const s = e.getState() as GameState;
    s.stocks.budget = 40000;
    s.stocks.users = 80;
    s.stocks.reputation = 12;
    s.completedProjects = 2;
    e.applyDecision("basic-dev");
    s.stocks.budget = 40000;
    e.applyDecision("sell-company");
    const next = e.getState();
    expect(next.eraId).toBe("megacorp");
    expect(e.getContent().eraId).toBe("megacorp");
    expect(next.stocks.budget).toBe(40000 + 10_000_000);
    expect(next.stocks.users).toBe(0);
    expect(next.stocks.reputation).toBe(0);
    expect(next.completedProjects).toBe(0);
    expect(next.day).toBe(0);
    expect(next.decisions.map((d) => d.defId)).toEqual(["one-time-product"]);
    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]!.defId).toBe("launch-beta");
    expect(next.log.some((l) => l.message.includes("Megacorp"))).toBe(true);
  });
});
