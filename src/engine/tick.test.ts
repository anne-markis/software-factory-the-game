import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { parseStartConfig } from "./content";
import startJson from "../../content/start.json";
import type { GameContent } from "./types";

export function testContent(): GameContent {
  return { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] };
}

describe("tick", () => {
  it("moves points downstream one stage per day at base rates", () => {
    const e = new Engine(testContent());
    e.tick(); // day 1: pull moves 1 point into inProgress
    let s = e.getState();
    expect(s.stocks.backlog).toBe(9999);
    expect(s.stocks.inProgress).toBe(1);
    expect(s.stocks.shipped).toBe(0);

    e.tick(); // day 2
    e.tick(); // day 3: first point ships (downstream-first prevents same-day pass-through)
    s = e.getState();
    expect(s.stocks.shipped).toBe(1);
    expect(s.pointsPerDay).toBe(1);
  });

  it("shipped points regenerate tech debt into the backlog", () => {
    const e = new Engine(testContent());
    e.tick();
    e.tick();
    e.tick(); // 1 point shipped, debt multiplier 0.5
    const s = e.getState();
    expect(s.stocks.techDebt).toBe(0.5);
    expect(s.stocks.backlog).toBe(9997 + 0.5);
  });

  it("pays revenue per shipped point and charges base burn", () => {
    const e = new Engine(testContent());
    e.tick(); // no shipping yet: 10000 - 5 burn
    expect(e.getState().stocks.budget).toBe(9995);
    e.tick();
    e.tick(); // ships 1 point at $3
    expect(e.getState().stocks.budget).toBe(10000 - 15 + 3);
  });

  it("does nothing while paused", () => {
    const e = new Engine(testContent());
    e.pause();
    e.tick();
    expect(e.getState().day).toBe(0);
    e.resume();
    e.tick();
    expect(e.getState().day).toBe(1);
  });

  it("clamps flows so stocks never go negative", () => {
    const content = testContent();
    content.start.stocks.backlog = 0;
    const e = new Engine(content);
    for (let i = 0; i < 10; i++) e.tick();
    const s = e.getState();
    expect(s.stocks.backlog).toBeGreaterThanOrEqual(0);
    expect(s.stocks.inProgress).toBeGreaterThanOrEqual(0);
    expect(s.stocks.done).toBeGreaterThanOrEqual(0);
  });
});
