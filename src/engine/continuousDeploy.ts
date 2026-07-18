import type { GameContent, GameState } from "./types";

// A small standalone module rather than living in decisions.ts: tick.ts
// needs this check, and decisions.ts already imports from tick.ts (for
// `log`), so adding the reverse import there would create a tick <->
// decisions cycle. This module only depends on types.ts, so tick.ts can
// import it free of that risk.
//
// True once any owned decision instance's definition carries a
// continuousDeploy effect in its base `effects` array. Deliberately checks
// only the def's base effects, not a synergy-selected variant (synergies
// are a purchase-time effect swap for numeric tuning; continuous deploy is
// a structural, definition-level property and is not meant to be toggled
// by which synergy happened to be active at purchase time). Derived from
// ownership on every call, so it is automatically true again if content
// ever grants continuousDeploy via a second decision, and automatically
// false if the granting instance is removed via the mutable escape hatch
// -- in shipped content ci-cd is unique and non-removable, so activation
// is permanent in practice, but the engine does not special-case that.
export function continuousDeployActive(state: GameState, content: GameContent): boolean {
  return state.decisions.some((inst) => {
    const def = content.decisions.find((d) => d.id === inst.defId);
    return def?.effects.some((e) => e.type === "continuousDeploy") ?? false;
  });
}
