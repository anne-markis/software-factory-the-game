import { describe, it, expect } from "vitest";
import {
  esc,
  renderStats,
  renderDecisions,
  renderLog,
  renderChoicesScaffold,
  renderChoiceCountdown,
  choiceCountdownSection,
  projectsPanelScaffold,
  renderProjectsStatus,
  renderProjectOffers,
  PROJECTS_STATUS_SECTION,
  PROJECTS_OFFERS_SECTION,
  renderStall,
  renderTimeControls,
} from "./render";
import { parseStartConfig, parseDecisions, parseChallenges, parseProjects } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import challengesJson from "../../content/challenges.json";
import projectsJson from "../../content/projects.json";
import { Engine, initialState } from "../engine/engine";
import { projectAvailability } from "../engine/projects";
import type { GameContent } from "../engine/types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("esc", () => {
  it("escapes html-significant characters", () => {
    expect(esc(`<b>&"x"</b>`)).toBe("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;");
  });
});

describe("renderStats", () => {
  it("renders each stat as a label span plus a width-classed, tabular-nums value span (single-line, non-reflowing bar)", () => {
    const c = content();
    const e = new Engine(c);
    const html = renderStats(e.getState(), c);
    expect(html).toContain('<div class="stats">');
    expect(html).toContain(
      '<span class="stat"><span class="stat-label">Day</span> <span class="stat-value v-day">0</span></span>',
    );
    expect(html).toContain('<span class="stat-label">Backlog</span> <span class="stat-value v-flow">');
    expect(html).toContain('<span class="stat-label">Shipped</span> <span class="stat-value v-flow">');
    expect(html).toContain('<span class="stat-label">In Progress</span> <span class="stat-value v-count">');
    expect(html).toContain('<span class="stat-label">Done</span> <span class="stat-value v-count">');
    expect(html).toContain('<span class="stat-label">Budget</span> <span class="stat-value v-budget">$');
    expect(html).toContain('<span class="stat-label">Tech Debt</span> <span class="stat-value v-debt">');
    expect(html).toContain('<span class="stat-label">Reputation</span> <span class="stat-value v-rep">');
    expect(html).toContain('<span class="stat-label">Points/Day</span> <span class="stat-value v-rate">');
  });

  // Issue #37: Budget must telegraph runway before payroll wipe.
  it("appends runway days to Budget when recurring burn is positive", () => {
    const c = content();
    const e = new Engine(c);
    const html = renderStats(e.getState(), c);
    // Fresh game: $10,000 / $20/day = 500 days; healthy, no warning class.
    expect(html).toContain('class="stat-value v-budget">$10,000 (500 days)</span>');
    expect(html).not.toContain("budget-low");
  });

  it("marks Budget with budget-low when runway is at or under 14 days", () => {
    const c = content();
    const e = new Engine(c);
    e.applyDecision("basic-dev"); // +$7/day → burn 27
    const state = e.getState();
    state.stocks.budget = 270; // exactly 10 days
    const html = renderStats(state, c);
    expect(html).toContain('class="stat-value v-budget budget-low">$270 (10 days)</span>');
  });

  it("uses singular day label and warns at 1 day of runway", () => {
    const c = content();
    const e = new Engine(c);
    const state = e.getState();
    state.stocks.budget = 20; // 1 day at base burn 20
    const html = renderStats(state, c);
    expect(html).toContain('class="stat-value v-budget budget-low">$20 (1 day)</span>');
  });

  it("omits runway and warning when net burn is not positive", () => {
    const c = content();
    c.start.baseBurnPerDay = 0;
    const e = new Engine(c);
    e.applyDecision("support-retainer");
    const html = renderStats(e.getState(), c);
    expect(html).toContain('class="stat-value v-budget">$');
    expect(html).not.toContain(" days)");
    expect(html).not.toContain(" day)");
    expect(html).not.toContain("budget-low");
  });
});

describe("renderDecisions", () => {
  it("shows a prerequisite-locked node (ci-cd on a fresh game) visibly, dimmed, with its requirement", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    // ci-cd is present (not hidden) but its Buy button is disabled and it
    // carries the human-readable requirement.
    expect(html).toContain('data-buy="ci-cd" disabled');
    expect(html).toContain("requires Add test suite");
    expect(html).toContain("tt-locked");
    expect(html).toContain("Nothing yet. You are a solo dev.");
  });

  it("buying test-suite unlocks ci-cd (Buy enabled, no longer locked)", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).toContain('data-buy="ci-cd" ');
    expect(html).not.toContain('data-buy="ci-cd" disabled');
  });

  it("keeps cannot-afford entries visible and disabled, distinct from hidden missing-requires entries", () => {
    const c = content();
    c.start.stocks.budget = 0;
    const e = new Engine(c);
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], c);
    expect(html).toContain('data-buy="ddos-protection" disabled');
    expect(html).toContain("cannot afford");
  });

  it("shows owned instances with gamble outcome and remove button", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const inst = e.getState().decisions[0];
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).toContain(`data-remove="${inst.instanceId}"`);
    expect(html).toContain(`[${inst.gambleLabel}]`);
  });

  it("escapes content-derived strings", () => {
    const c = content();
    c.decisions[0].name = `<img src=x onerror=alert(1)>`;
    const e = new Engine(c);
    const html = renderDecisions(e.availableDecisions(), [], c);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("shows an owned unique decision as owned instead of vanishing from the tree", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    // test-suite is unique and owned: still present, no Buy button, marked owned.
    expect(html).not.toContain('data-buy="test-suite"');
    expect(html).toContain("Add test suite");
    expect(html).toContain("tt-owned");
    expect(html).toContain("owned");
    // basic-dev (repeatable, not owned yet) stays buyable.
    expect(html).toContain('data-buy="basic-dev"');
  });

  it("shows a repeatable decision's owned count while keeping the Buy button live", () => {
    const e = new Engine(content());
    e.applyDecision("contractor");
    e.applyDecision("contractor");
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).toContain("owned x2");
    expect(html).toContain('data-buy="contractor"');
  });

  it("renders each node's chain (or standalone) placement and a short category tag", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    // Chain headers, named after each chain's root.
    expect(html).toContain("Add test suite");
    expect(html).toContain("Hire basic developer");
    expect(html).toContain("Add coding agent");
    expect(html).toContain("Standalone");
    expect(html).toContain("&rarr;");
    // Category tags (mapped from DecisionCategory to short labels).
    expect(html).toContain('<span class="tt-cat">speed</span>');
    expect(html).toContain('<span class="tt-cat">debt</span>');
  });

  it("no longer renders the retired unlock-count hint", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).not.toContain("more alterations unlock");
  });

  it("renders a card's authored description in full, with no first-sentence truncation, plus a derived effects line", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    // agent-swarm's description (>110 chars, multiple sentences) is a known
    // long-ish entry -- assert it appears whole, not clipped to its first
    // sentence or an ellipsis (Release 20 removes the old 87-char truncation).
    const agentSwarmDesc =
      "Agents pick up and ship work themselves: all work 80% faster. Tech debt grows 50% faster unless an orchestrator tames it.";
    expect(agentSwarmDesc.length).toBeGreaterThan(110);
    expect(html).toContain(`<div class="tt-node-desc">${agentSwarmDesc}</div>`);
    expect(html).not.toContain("...");
    // The derived effects line sits beneath the description, terse and
    // numbers-only, generated from structured effects (see effectSummary.ts)
    // -- test-suite's is a known, stable case.
    expect(html).toContain('<div class="tt-effects">all rates x0.5 for 5d, debt x0.5</div>');
  });

  it("flags gamble decisions with a chip and omits it from deterministic ones", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    // basic-dev and senior-dev are the only shipped gamble hires; their cards
    // carry the chip. A deterministic decision (test-suite) does not.
    const gambleChips = html.match(/class="tt-gamble"/g) ?? [];
    expect(gambleChips.length).toBe(2);
    expect(html).toContain('<span class="tt-gamble"');
    // The "(gamble)" suffix moved out of the derived line onto the chip, so a
    // gamble card shows the range alone.
    expect(html).not.toContain("(gamble)");
  });
});

describe("renderLog", () => {
  it("shows most recent entries first, capped at 30, escaped", () => {
    const log = Array.from({ length: 40 }, (_, i) => ({ day: i, message: `msg ${i} <b>` }));
    const html = renderLog(log);
    expect(html).toContain("Day 39: msg 39 &lt;b&gt;");
    expect(html).not.toContain("Day 9:");
    expect(html.indexOf("Day 39:")).toBeLessThan(html.indexOf("Day 38:"));
  });

  it("renders a placeholder when empty", () => {
    expect(renderLog([])).toContain("Quiet so far.");
  });
});

describe("renderChoicesScaffold", () => {
  it("renders nothing without pending choices", () => {
    expect(renderChoicesScaffold([], parseChallenges(challengesJson))).toBe("");
  });

  it("renders option buttons and a countdown placeholder for a pending choice", () => {
    const challenges = parseChallenges(challengesJson);
    const html = renderChoicesScaffold([{ challengeId: "key-dev-poached", expiresDay: 8 }], challenges);
    expect(html).toContain('data-choice="key-dev-poached" data-option="match-offer"');
    expect(html).toContain("Decision needed");
    // The countdown is patched separately (issue #6) so the day ticking down
    // does not rebuild the option buttons: the scaffold carries only its slot.
    expect(html).toContain(`<em data-section="${choiceCountdownSection("key-dev-poached")}"></em>`);
    expect(html).not.toContain("days left");
  });

  it("keeps the same scaffold string as days pass, so the memo holds", () => {
    const challenges = parseChallenges(challengesJson);
    const pending = [{ challengeId: "key-dev-poached", expiresDay: 8 }];
    expect(renderChoicesScaffold(pending, challenges)).toBe(renderChoicesScaffold(pending, challenges));
  });
});

describe("renderChoiceCountdown", () => {
  it("renders the remaining days", () => {
    expect(renderChoiceCountdown({ challengeId: "key-dev-poached", expiresDay: 8 }, 5)).toBe("(3 days left)");
    expect(renderChoiceCountdown({ challengeId: "key-dev-poached", expiresDay: 8 }, 6)).toBe("(2 days left)");
  });
});

describe("renderProjectsStatus", () => {
  it("shows the efficiency header and the in-flight lines", () => {
    const c = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
    const e = new Engine(c);
    const html = renderProjectsStatus([...e.getState().projects], e.getState());
    expect(html).toContain("Projects (efficiency 100%)");
    expect(html).toContain("First Contract: 1,500 points left");
    // The Start buttons live in the sibling offers section, not here, so the
    // per-tick progress update cannot tear them down (issue #6).
    expect(html).not.toContain("data-project");
  });
});

describe("renderProjectOffers", () => {
  it("shows offers with gating reasons and the efficiency preview", () => {
    const c = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
    const e = new Engine(c);
    const html = renderProjectOffers(e.availableProjects(), e.getState());
    expect(html).toContain('data-project="small-crm" ');
    expect(html).toContain('data-project="big-migration" disabled');
    expect(html).toContain("requires 1 completed project(s)");
    expect(html).toContain("drops efficiency to 85%");
  });

  it("shows the reputation gate reason once the completed-count floor is already met (reputation reasons flow through the same reason field as completions/afford)", () => {
    const c = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
    const s = initialState(c);
    // big-migration requires 1 completed project AND 5 reputation. Satisfy
    // the completion floor but leave reputation below its gate so the
    // reputation reason -- not the completion reason -- is what renders.
    s.completedProjects = 1;
    s.stocks.reputation = 1;
    const html = renderProjectOffers(projectAvailability(s, c), s);
    expect(html).toContain('data-project="big-migration" disabled');
    expect(html).toContain("requires 5 reputation");
  });

  it("does not change as in-flight work progresses, so the Start buttons survive the tick", () => {
    const c = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
    const s = initialState(c);
    const before = renderProjectOffers(projectAvailability(s, c), s);
    s.projects[0].remaining -= 25;
    expect(renderProjectOffers(projectAvailability(s, c), s)).toBe(before);
  });
});

describe("projectsPanelScaffold", () => {
  it("provides both patch targets inside one panel", () => {
    const html = projectsPanelScaffold();
    expect(html).toContain(`data-section="${PROJECTS_STATUS_SECTION}"`);
    expect(html).toContain(`data-section="${PROJECTS_OFFERS_SECTION}"`);
    expect(html).toContain('<div class="panel">');
    expect(html).toContain("<hr/>");
  });
});

describe("renderTimeControls", () => {
  it("renders Pause plus every speed option, marking the active one", () => {
    const html = renderTimeControls(false, 1, [1, 2, 5]);
    expect(html).toContain('id="pause"');
    expect(html).toContain(">Pause<");
    expect(html).toContain('data-speed="1"');
    expect(html).toContain('data-speed="2"');
    expect(html).toContain('data-speed="5"');
    // Active speed (1) is marked; the others are not.
    expect(html).toContain('class="tc-btn tc-active" data-speed="1"');
    expect(html).toContain('class="tc-btn" data-speed="2"');
    expect(html).toContain('class="tc-btn" data-speed="5"');
  });

  it("moves the active marker when the active speed changes", () => {
    const html = renderTimeControls(false, 5, [1, 2, 5]);
    expect(html).toContain('class="tc-btn" data-speed="1"');
    expect(html).toContain('class="tc-btn" data-speed="2"');
    expect(html).toContain('class="tc-btn tc-active" data-speed="5"');
  });

  it("flips the pause button's label to Resume when paused", () => {
    const html = renderTimeControls(true, 1, [1, 2, 5]);
    expect(html).toContain(">Resume<");
    expect(html).not.toContain(">Pause<");
  });
});

describe("renderStall", () => {
  it("renders the banner only when stalled", () => {
    expect(renderStall(true)).toContain("stalled");
    expect(renderStall(false)).toBe("");
  });
});
