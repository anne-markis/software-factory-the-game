import { describe, it, expect } from "vitest";
import { createPlayerEngine } from "./playerEngine";
import { Engine, initialState } from "../engine/engine";
import { validateContentGraph } from "../engine/content";
import { loadShippedContent } from "../engine/loadShippedContent";
import type { GameContent } from "../engine/types";

function content(): GameContent {
  const c: GameContent = loadShippedContent();
  validateContentGraph(c);
  return c;
}

describe("createPlayerEngine", () => {
  it("starts a fresh game paused so ticks do not advance the day", () => {
    const e = createPlayerEngine(content());
    expect(e.getState().paused).toBe(true);
    expect(e.getState().day).toBe(0);
    e.tick();
    expect(e.getState().day).toBe(0);
  });

  it("shows Resume-ready state: resume then tick advances the day", () => {
    const e = createPlayerEngine(content());
    e.resume();
    expect(e.getState().paused).toBe(false);
    e.tick();
    expect(e.getState().day).toBe(1);
  });

  it("does not force-pause a restored mid-game save that was running", () => {
    const c = content();
    const saved = initialState(c);
    saved.paused = false;
    saved.day = 42;
    const e = createPlayerEngine(c, saved);
    expect(e.getState().paused).toBe(false);
    expect(e.getState().day).toBe(42);
  });

  it("preserves a restored save that was already paused", () => {
    const c = content();
    const saved = initialState(c);
    saved.paused = true;
    saved.day = 10;
    const e = createPlayerEngine(c, saved);
    expect(e.getState().paused).toBe(true);
    expect(e.getState().day).toBe(10);
  });

  it("leaves bare Engine construction unpaused (tests / non-player paths)", () => {
    const e = new Engine(content());
    expect(e.getState().paused).toBe(false);
  });
});
