import { serialize, deserialize } from "../engine/save";
import type { GameState } from "../engine/types";
import { SPEED_OPTIONS, DEFAULT_SPEED, type Speed } from "./tickDriver";

const KEY = "software-factory-save";
// Speed is a UI preference, not game state (see design doc section 6): its
// own key, separate from the save, so it isn't wiped by "Reset game" and
// isn't part of what a save/load round-trips through the engine.
const SPEED_KEY = "software-factory-speed";

export function saveGame(state: Readonly<GameState>): void {
  localStorage.setItem(KEY, serialize(state));
}

export function loadGame(): GameState | undefined {
  const raw = localStorage.getItem(KEY);
  if (!raw) return undefined;
  try {
    return deserialize(raw);
  } catch {
    return undefined; // unreadable or wrong-version save: start fresh
  }
}

export function clearSave(): void {
  localStorage.removeItem(KEY);
}

// Pure so it can be unit-tested without a localStorage-backed environment
// (see tickDriver.test.ts-style pure-module pattern; storage.ts itself isn't
// exercised directly in the node test env). Falls back to DEFAULT_SPEED for
// anything that isn't one of the finite allowed options: missing, wrong
// type, NaN, or a numeric value outside SPEED_OPTIONS.
export function normalizeSpeed(value: unknown): Speed {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n === "number" && !Number.isNaN(n) && (SPEED_OPTIONS as readonly number[]).includes(n)) {
    return n as Speed;
  }
  return DEFAULT_SPEED;
}

export function saveSpeed(speed: Speed): void {
  localStorage.setItem(SPEED_KEY, String(speed));
}

export function loadSpeed(): Speed {
  return normalizeSpeed(localStorage.getItem(SPEED_KEY));
}
