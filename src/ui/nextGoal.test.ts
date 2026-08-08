import { describe, expect, it } from "vitest";
import { parseStartConfig, parseDecisions, parseProjects } from "../engine/content";
import { Engine } from "../engine/engine";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import projectsJson from "../../content/projects.json";
import type { GameContent, GameState } from "../engine/types";
import {
  nextContractGoal,
  nextMilestoneGoal,
  renderNextGoal,
  selectNextGoal,
} from "./nextGoal";

function makeContent(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: [],
    projects: parseProjects(projectsJson),
  };
}

const content = makeContent();

/** Mutable view of engine state for fixture setup (getState is typed readonly). */
function mut(e: Engine): GameState {
  return e.getState() as GameState;
}

function engineWith(mutate: (s: GameState) => void): Engine {
  const e = new Engine(content);
  mutate(mut(e));
  return e;
}

describe("nextMilestoneGoal", () => {
  it("picks the lowest unmet milestone from a fresh game (0 reputation)", () => {
    const e = new Engine(content);
    const g = nextMilestoneGoal(e.getState(), content);
    expect(g).toEqual({
      kind: "milestone",
      id: "trusted",
      name: "Trusted vendor",
      current: 0,
      target: 5,
    });
  });

  it("advances to the next milestone once reputation crosses the prior threshold", () => {
    const e = engineWith((s) => {
      s.stocks.reputation = 5;
    });
    const g = nextMilestoneGoal(e.getState(), content);
    expect(g?.id).toBe("established");
    expect(g?.current).toBe(5);
    expect(g?.target).toBe(15);
  });

  it("returns null when reputation is at or above the top milestone", () => {
    const e = engineWith((s) => {
      s.stocks.reputation = 70;
    });
    expect(nextMilestoneGoal(e.getState(), content)).toBeNull();
  });

  it("re-surfaces a lower milestone after a reputation spiral drop", () => {
    const e = engineWith((s) => {
      s.stocks.reputation = 15;
    });
    expect(nextMilestoneGoal(e.getState(), content)?.id).toBe("leader");
    mut(e).stocks.reputation = 4;
    expect(nextMilestoneGoal(e.getState(), content)?.id).toBe("trusted");
  });
});

describe("nextContractGoal", () => {
  it("skips affordability-only locks and surfaces the nearest progression gate", () => {
    // Fresh game: small-crm may be unaffordable but is not progression-locked.
    // big-migration / mobile-app need 1 completion + 5 reputation.
    const e = new Engine(content);
    const g = nextContractGoal(e.getState(), content);
    expect(g).not.toBeNull();
    expect(g!.reason).toMatch(/requires /);
    // Lowest gate among progression locks: both mobile-app and big-migration
    // need 1 completion + 5 rep; sort is by reputation then completions then id.
    expect(g!.id).toBe("big-migration");
  });

  it("ignores unlocked tiers and advances to the next progression gate", () => {
    const e = engineWith((s) => {
      s.completedProjects = 1;
      s.stocks.reputation = 5;
      s.stocks.budget = 100_000;
    });
    // With 1 completion + 5 rep, big-migration and mobile-app are unlocked;
    // enterprise still needs 2 completions + 15 rep.
    const g = nextContractGoal(e.getState(), content);
    expect(g?.id).toBe("enterprise-replatform");
    expect(g?.reason).toMatch(/requires/);
  });

  it("returns null when no progression-locked contracts remain", () => {
    const e = engineWith((s) => {
      s.completedProjects = 2;
      s.stocks.reputation = 15;
      s.stocks.budget = 100_000;
    });
    expect(nextContractGoal(e.getState(), content)).toBeNull();
  });
});

describe("selectNextGoal / renderNextGoal", () => {
  it("shows milestone + contract together on a fresh game", () => {
    const e = new Engine(content);
    const sel = selectNextGoal(e.getState(), content);
    expect(sel.top).toBeNull();
    expect(sel.milestone?.id).toBe("trusted");
    expect(sel.contract?.id).toBe("big-migration");

    const html = renderNextGoal(e.getState(), content);
    expect(html).toContain('class="next-goal"');
    expect(html).toContain("Next");
    expect(html).toContain('data-next-milestone="trusted"');
    expect(html).toContain("Trusted vendor");
    expect(html).toContain("0/5 reputation");
    expect(html).toContain('data-next-contract="big-migration"');
    expect(html).toContain("Legacy platform migration");
  });

  it("shows the top-out state when milestones and contract gates are cleared", () => {
    const e = engineWith((s) => {
      s.stocks.reputation = 70;
      s.completedProjects = 2;
      s.stocks.budget = 100_000;
    });
    const sel = selectNextGoal(e.getState(), content);
    expect(sel.milestone).toBeNull();
    expect(sel.contract).toBeNull();
    expect(sel.top).toEqual({ kind: "top" });

    const html = renderNextGoal(e.getState(), content);
    expect(html).toContain('data-next-top="1"');
    expect(html).toContain("Top milestone reached — keep shipping");
    expect(html).not.toContain("win");
  });

  it("escapes milestone and contract names in rendered HTML", () => {
    const hostile: GameContent = {
      start: {
        ...content.start,
        milestones: [
          {
            id: "x",
            reputation: 1,
            name: `<img src=x onerror=alert(1)>`,
            message: "nope",
          },
        ],
      },
      decisions: content.decisions,
      challenges: [],
      projects: [
        {
          id: "p",
          name: `Evil</span><script>alert(1)</script>`,
          sizePoints: 1,
          upfrontCost: 0,
          payoutPerPoint: 1,
          completionBonus: 0,
          reputationReward: 0,
          requiresCompleted: 9,
          requiresReputation: 9,
        },
      ],
    };
    const e = new Engine(hostile);
    const html = renderNextGoal(e.getState(), hostile);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("Evil&lt;/span&gt;");
  });
});
