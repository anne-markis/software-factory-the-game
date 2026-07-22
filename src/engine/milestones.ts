import type { GameContent, GameState } from "./types";

// Named reputation threshold narration (Release 17). Mirrors archetypes.ts's
// once-only sticky pattern (state.milestonesSeen instead of archetypesSeen):
// each milestone id is logged and recorded the first tick reputation reaches
// its threshold, and never un-fires on a later downward recross -- milestones
// mark having-reached, not current standing. Thresholds and copy come entirely
// from content (content.start.milestones), sorted strictly ascending by
// parseStartConfig's integrity check, though detection here does not depend
// on that ordering (it checks every not-yet-seen milestone every tick).
//
// Engine-pure, log passed in (tick.ts's log) rather than imported here, the
// same reasoning as archetypes.ts: avoids a tick <-> milestones import cycle.
export function detectMilestones(
  state: GameState,
  content: GameContent,
  log: (state: GameState, message: string) => void,
): void {
  const seen = new Set(state.milestonesSeen);
  for (const m of content.start.milestones) {
    if (seen.has(m.id)) continue;
    if (state.stocks.reputation >= m.reputation) {
      state.milestonesSeen.push(m.id);
      seen.add(m.id);
      log(state, m.message);
    }
  }
}
