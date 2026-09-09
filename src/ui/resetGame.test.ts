// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createResetGame } from "./resetGame";
import { saveGame, loadGame, clearSave } from "./storage";
import { initialState } from "../engine/engine";
import { loadShippedContent } from "../engine/loadShippedContent";
import { validateContentGraph } from "../engine/content";
import type { GameState } from "../engine/types";

function stubState(day: number): GameState {
  const content = loadShippedContent();
  validateContentGraph(content);
  const state = initialState(content);
  state.day = day;
  return state;
}

describe("createResetGame", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does nothing when the player cancels the confirm", () => {
    const halt = vi.fn();
    const clear = vi.fn();
    const reload = vi.fn();
    const reset = createResetGame({
      confirm: () => false,
      halt,
      clearSave: clear,
      reload,
    });

    reset.onReset();

    expect(halt).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(reset.savesAllowed()).toBe(true);
  });

  it("halts, wipes, and reloads when the player confirms, in that order", () => {
    const halt = vi.fn();
    const clear = vi.fn();
    const reload = vi.fn();
    const reset = createResetGame({
      confirm: () => true,
      halt,
      clearSave: clear,
      reload,
    });

    reset.onReset();

    expect(halt).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(halt.mock.invocationCallOrder[0]).toBeLessThan(clear.mock.invocationCallOrder[0]);
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]);
    expect(reset.savesAllowed()).toBe(false);
  });

  it("blocks persist before halt so a queued driver frame cannot write during wipe", () => {
    const reset = createResetGame({
      confirm: () => true,
      halt: () => {
        expect(reset.savesAllowed()).toBe(false);
      },
      clearSave: () => {
        expect(reset.savesAllowed()).toBe(false);
      },
      reload: () => {
        expect(reset.savesAllowed()).toBe(false);
      },
    });

    reset.onReset();
    expect(reset.savesAllowed()).toBe(false);
  });

  it("persist writes the live factory until a confirmed wipe", () => {
    const reset = createResetGame({
      confirm: () => false,
      halt: vi.fn(),
      clearSave,
      reload: vi.fn(),
    });

    reset.persist(() => saveGame(stubState(10)));
    expect(loadGame()?.day).toBe(10);

    reset.onReset();
    reset.persist(() => saveGame(stubState(11)));
    expect(loadGame()?.day).toBe(11);
  });

  it("after confirm, a driver autosave cannot resurrect the wiped factory", () => {
    saveGame(stubState(40));
    expect(loadGame()?.day).toBe(40);

    const reset = createResetGame({
      confirm: () => true,
      halt: vi.fn(),
      clearSave: () => {
        clearSave();
        // Native confirm blocks the thread; when it returns, queued 100ms
        // driver frames still run before unload and would otherwise persist
        // the live factory over the empty slot.
        reset.persist(() => saveGame(stubState(40)));
      },
      reload: () => {
        reset.persist(() => saveGame(stubState(40)));
      },
    });

    reset.onReset();
    reset.persist(() => saveGame(stubState(40)));

    expect(loadGame()).toBeUndefined();
  });
});
