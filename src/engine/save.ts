import type { GameState } from "./types";

// Bumped to 5 for the Ideas stock and discover faucet: a v4 save has no
// ideas pile and no discover rate, so late-game offers would be free to
// grab. Bumped to 4 for the Studio project redo: tiny gigs + v1–v5 replace the old
// contract ladder in Studio, and unique versions need completedProjectIds. A
// v3 save can have small-crm / mobile-app in flight as Studio contracts those
// ids no longer offer. Bumped to 3 for the lean Studio shop and challenge pool.
// A v2 save can hold owned instances and challenge cooldowns keyed
// to ids that no longer exist in content (copilot, the org ladder, agent-swarm,
// the retired challenges), and a v2 game was balanced around the old base pull
// rate; there is nothing sensible to migrate those to. Bumped to 2 before that
// for the Studio spine: the users stock, the launch-beta starting
// project, the 300-point backlog, and the always-on stockDrags/stockFlows.
//
// deserialize rejects mismatched versions, and the UI's loadGame swallows that
// error and starts fresh, so old saves are wiped silently rather than resumed
// into an inconsistent state.
export const SAVE_VERSION = 5;

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
  // defensive default for saves written before challenge cooldowns existed
  if (state.challengeLastFired === undefined) {
    state.challengeLastFired = {};
  }
  // defensive default for saves written before archetype narration (Release 15).
  // Unlike the debtDrag config (backfilled from content in the Engine
  // constructor), [] is content-free, so it defaults here like challengeLastFired.
  if (state.archetypesSeen === undefined) {
    state.archetypesSeen = [];
  }
  // defensive default for saves written before milestone narration (Release
  // 17). Content-free like archetypesSeen, so it defaults here rather than
  // in the Engine constructor (which backfills content-derived fields like
  // gameSeed/debtDrag/stocks.reputation).
  if (state.milestonesSeen === undefined) {
    state.milestonesSeen = [];
  }
  // defensive defaults for saves written before pullFlow/finishFlow (realized-throughput fix). Content-free like archetypesSeen/
  // milestonesSeen, so they default here rather than in the Engine
  // constructor. 0 is a safe, neutral placeholder until the next tick
  // recomputes the real realized flow.
  if (state.pullFlow === undefined) {
    state.pullFlow = 0;
  }
  if (state.finishFlow === undefined) {
    state.finishFlow = 0;
  }
  // defensive default for saves written before pointsPerDay (same realized-
  // throughput family as pullFlow/finishFlow). Legacy saves predate the
  // field; 0 is a safe placeholder until the next tick recomputes the real
  // realized flow (see tick.ts which sets state.pointsPerDay = shippedFlow).
  if (state.pointsPerDay === undefined) {
    state.pointsPerDay = 0;
  }
  if (state.userAcquireFlow === undefined) {
    state.userAcquireFlow = 0;
  }
  if (state.userChurnFlow === undefined) {
    state.userChurnFlow = 0;
  }
  if (state.userIncomeFlow === undefined) {
    state.userIncomeFlow = 0;
  }
  // Completed-id set for unique versions / requiresCompletedId. Content-free
  // like milestonesSeen, so it defaults here. SAVE_VERSION 4 rejects genuine
  // v3 saves; this only guards hand-built current-version states.
  if (state.completedProjectIds === undefined) {
    state.completedProjectIds = [];
  }
  // Defensive default for the users stock. The SAVE_VERSION bumps
  // mean genuine pre-v2 saves are rejected before reaching here, so this only
  // guards hand-built or in-flight current-version states missing the field: 0
  // is the correct baseline (users start at 0 until the Launch beta completes).
  if (state.stocks.users === undefined) {
    state.stocks.users = 0;
  }
  // DecisionInstance.appliedSynergyIfOwned needs no defaulting:
  // undefined already means "bought under the base effects", and which synergy
  // a legacy instance was bought under is unrecoverable from the save, so any
  // backfill from current ownership would invent mitigation that never
  // happened -- exactly the bug the field exists to fix.
  return state;
}
