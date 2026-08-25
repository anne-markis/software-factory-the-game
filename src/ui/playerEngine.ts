import { Engine, type LoadEraContent } from "../engine/engine";
import type { GameContent, GameState } from "../engine/types";

/**
 * Build the engine the player actually plays.
 *
 * Fresh games and post-Reset loads (no save) start paused so reading the
 * factory does not burn sim-days before the player opts in.
 * Restored mid-game saves keep whatever pause flag they were serialized with.
 *
 * Engine.initialState stays unpaused so unit tests that tick a bare Engine
 * keep working without an explicit resume.
 */
export function createPlayerEngine(
  content: GameContent,
  saved?: GameState,
  loadEra?: LoadEraContent,
): Engine {
  const engine = new Engine(content, saved, loadEra);
  if (!saved) engine.pause();
  return engine;
}
