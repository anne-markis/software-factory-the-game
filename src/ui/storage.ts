import { serialize, deserialize } from "../engine/save";
import type { GameState } from "../engine/types";

const KEY = "software-factory-save";

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
