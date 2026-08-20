// Issue #65 / US-4: always-visible next-goal lean for endless runs.
// Pure UI derivation from reputation milestones + contract progression gates
// — no engine/save changes, no win screen.
import { projectAvailability, type ProjectAvailability } from "../engine/projects";
import { eraCrossingIsSilent, formatEraEntryPredicate, nextEraDef } from "../engine/eras";
import type { GameContent, GameState } from "../engine/types";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export type NextGoalMilestone = {
  kind: "milestone";
  id: string;
  name: string;
  current: number;
  target: number;
};

export type NextGoalContract = {
  kind: "contract";
  id: string;
  name: string;
  reason: string;
};

export type NextGoalTop = {
  kind: "top";
};

export type NextGoalEra = {
  kind: "era";
  id: string;
  name: string;
  hint: string;
};

export type NextGoalSelection = {
  milestone: NextGoalMilestone | null;
  contract: NextGoalContract | null;
  era: NextGoalEra | null;
  top: NextGoalTop | null;
};

export function nextEraGoal(
  state: Readonly<GameState>,
  content: GameContent,
): NextGoalEra | null {
  if (!content.eras) return null;
  const next = nextEraDef(content.eras, state.eraId);
  if (!next?.entryAnyOf?.length) return null;
  // Silent is the default. A rung is only a grind target when content
  // sets silentEntry: false.
  if (eraCrossingIsSilent(next)) return null;
  return {
    kind: "era",
    id: next.id,
    name: next.name,
    hint: next.entryAnyOf.map(formatEraEntryPredicate).join(" or "),
  };
}

function isProgressionLock(entry: ProjectAvailability): boolean {
  if (entry.startable || !entry.reason) return false;
  // Cash and in-flight are not "next tier" leans — those are operational.
  return (
    entry.reason.startsWith("requires ") &&
    (entry.reason.includes("reputation") || entry.reason.includes("completed"))
  );
}

/** Next unmet reputation milestone by current standing (re-locks on spiral). */
export function nextMilestoneGoal(
  state: Readonly<GameState>,
  content: GameContent,
): NextGoalMilestone | null {
  const current = state.stocks.reputation;
  const sorted = [...content.start.milestones].sort((a, b) => a.reputation - b.reputation);
  for (const m of sorted) {
    if (current < m.reputation) {
      return {
        kind: "milestone",
        id: m.id,
        name: m.name,
        current,
        target: m.reputation,
      };
    }
  }
  return null;
}

/**
 * Next locked contract tier: lowest progression gate among projects blocked
 * on completions/reputation (not affordability / already in flight).
 */
export function nextContractGoal(
  state: Readonly<GameState>,
  content: GameContent,
): NextGoalContract | null {
  const locked = projectAvailability(state as GameState /* read-only use */, content)
    .filter(isProgressionLock)
    .sort((a, b) => {
      const ar = a.def.requiresReputation ?? 0;
      const br = b.def.requiresReputation ?? 0;
      if (ar !== br) return ar - br;
      const ac = a.def.requiresCompleted ?? 0;
      const bc = b.def.requiresCompleted ?? 0;
      if (ac !== bc) return ac - bc;
      return a.def.id.localeCompare(b.def.id);
    });
  const first = locked[0];
  if (!first || !first.reason) return null;
  return {
    kind: "contract",
    id: first.def.id,
    name: first.def.name,
    reason: first.reason,
  };
}

export function selectNextGoal(state: Readonly<GameState>, content: GameContent): NextGoalSelection {
  const milestone = nextMilestoneGoal(state, content);
  const contract = nextContractGoal(state, content);
  const era = nextEraGoal(state, content);
  if (!milestone && !contract && !era) {
    return { milestone: null, contract: null, era: null, top: { kind: "top" } };
  }
  return { milestone, contract, era, top: null };
}

export function renderNextGoal(state: Readonly<GameState>, content: GameContent): string {
  const goal = selectNextGoal(state, content);
  const parts: string[] = [];
  if (goal.milestone) {
    parts.push(
      `<span class="next-goal-item" data-next-milestone="${esc(goal.milestone.id)}">` +
        `${esc(goal.milestone.name)} — ${fmt(goal.milestone.current)}/${fmt(goal.milestone.target)} reputation` +
        `</span>`,
    );
  }
  if (goal.contract) {
    parts.push(
      `<span class="next-goal-item" data-next-contract="${esc(goal.contract.id)}">` +
        `${esc(goal.contract.name)} — ${esc(goal.contract.reason)}` +
        `</span>`,
    );
  }
  if (goal.era) {
    parts.push(
      `<span class="next-goal-item" data-next-era="${esc(goal.era.id)}">` +
        `${esc(goal.era.name)} — ${esc(goal.era.hint)}` +
        `</span>`,
    );
  }
  if (goal.top) {
    parts.push(
      `<span class="next-goal-item" data-next-top="1">Top milestone reached — keep shipping</span>`,
    );
  }
  return (
    `<div class="next-goal" data-section-body="next-goal">` +
    `<span class="next-goal-label">Next</span> ` +
    parts.join(`<span class="next-goal-sep"> · </span>`) +
    `</div>`
  );
}
