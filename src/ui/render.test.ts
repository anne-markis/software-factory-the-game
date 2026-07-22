import { describe, it, expect } from "vitest";
import { esc, renderStats, renderDecisions, renderLog, renderChoices, renderProjects, renderStall } from "./render";
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
    const e = new Engine(content());
    const html = renderStats(e.getState());
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
});

describe("renderDecisions", () => {
  it("hides missing-requires entries from a fresh shop and shows the unlock hint with a count", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).not.toContain('data-buy="ci-cd"');
    expect(html).not.toContain("requires Add test suite");
    // 7 shipped decisions gate on requires (ci-cd, agent-harness, senior-dev,
    // eng-manager, agent-swarm, swarm-orchestrator, self-learning-agents),
    // all unmet on a fresh game.
    expect(html).toContain("7 more alterations unlock as your factory grows.");
    expect(html).toContain("Nothing yet. You are a solo dev.");
  });

  it("buying test-suite unlocks ci-cd in the shop and drops the hidden count by one", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).toContain('data-buy="ci-cd"');
    expect(html).toContain("6 more alterations unlock as your factory grows.");
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

  it("drops owned unique decisions from the shop list entirely", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).not.toContain('data-buy="test-suite"');
    expect(html).toContain('data-buy="basic-dev"');
  });

  it("groups a fresh shop into category sections, ordered Ship faster before Earn income, with test-suite under Tame tech debt", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).toContain("Ship faster");
    expect(html).toContain("Earn income");
    expect(html.indexOf("Ship faster")).toBeLessThan(html.indexOf("Earn income"));
    const tameDebtIdx = html.indexOf("Tame tech debt");
    const testSuiteIdx = html.indexOf('data-buy="test-suite"');
    expect(tameDebtIdx).toBeGreaterThan(-1);
    expect(testSuiteIdx).toBeGreaterThan(tameDebtIdx);
  });

  it("hides the Change the loop section on a fresh game (ci-cd hidden by missing-requires) and shows it after buying test-suite", () => {
    const e = new Engine(content());
    const freshHtml = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(freshHtml).not.toContain("Change the loop");

    e.applyDecision("test-suite");
    const afterHtml = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(afterHtml).toContain("Change the loop");
    expect(afterHtml).toContain('data-buy="ci-cd"');
  });

  it("still shows the unlock-count hint alongside the sectioned shop", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).toContain("7 more alterations unlock as your factory grows.");
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

describe("renderChoices", () => {
  it("renders nothing without pending choices", () => {
    expect(renderChoices([], parseChallenges(challengesJson), 5)).toBe("");
  });

  it("renders option buttons and countdown for a pending choice", () => {
    const challenges = parseChallenges(challengesJson);
    const html = renderChoices([{ challengeId: "key-dev-poached", expiresDay: 8 }], challenges, 5);
    expect(html).toContain('data-choice="key-dev-poached" data-option="match-offer"');
    expect(html).toContain("(3 days left)");
    expect(html).toContain("Decision needed");
  });
});

describe("renderProjects", () => {
  it("shows in-flight projects, offers with gating reasons, and the efficiency preview", () => {
    const c = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
    const e = new Engine(c);
    const html = renderProjects([...e.getState().projects], e.availableProjects(), e.getState());
    expect(html).toContain("Projects (efficiency 100%)");
    expect(html).toContain("First Contract: 1,500 points left");
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
    const html = renderProjects([...s.projects], projectAvailability(s, c), s);
    expect(html).toContain('data-project="big-migration" disabled');
    expect(html).toContain("requires 5 reputation");
  });
});

describe("renderStall", () => {
  it("renders the banner only when stalled", () => {
    expect(renderStall(true)).toContain("stalled");
    expect(renderStall(false)).toBe("");
  });
});
