import type { GameState } from "./types";

export const SAVE_VERSION = 1;

export function serialize(state: Readonly<GameState>): string {
  return JSON.stringify({ version: SAVE_VERSION, state });
}

function maxIdSuffix(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (id.startsWith(prefix)) {
      const n = Number(id.slice(prefix.length));
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

export function deserialize(json: string): GameState {
  const parsed = JSON.parse(json) as { version: number; state: GameState };
  if (parsed.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version ${parsed.version} (expected ${SAVE_VERSION})`);
  }
  const state = parsed.state;
  // defensive defaults for saves written before the id counters were state-owned
  if (state.nextModifierId === undefined) {
    state.nextModifierId = maxIdSuffix(state.modifiers.map((m) => m.id), "mod-") + 1;
  }
  if (state.nextInstanceId === undefined) {
    state.nextInstanceId = maxIdSuffix(state.decisions.map((d) => d.instanceId), "inst-") + 1;
  }
  return state;
}
