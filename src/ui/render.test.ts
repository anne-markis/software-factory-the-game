import { describe, it, expect } from "vitest";
import { esc, renderDecisions, renderLog, renderChoices, renderProjects, renderStall } from "./render";
import { parseStartConfig, parseDecisions, parseChallenges, parseProjects } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import challengesJson from "../../content/challenges.json";
import projectsJson from "../../content/projects.json";
import { Engine } from "../engine/engine";
import type { GameContent } from "../engine/types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("esc", () => {
  it("escapes html-significant characters", () => {
    expect(esc(`<b>&"x"</b>`)).toBe("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;");
  });
});

describe("renderDecisions", () => {
  it("disables non-purchasable entries with their reason", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).toContain('data-buy="ci-cd" disabled');
    expect(html).toContain("requires Add test suite");
    expect(html).toContain("Nothing yet. You are a solo dev.");
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
    expect(html).toContain("First Contract: 10,000 points left");
    expect(html).toContain('data-project="small-crm" ');
    expect(html).toContain('data-project="big-migration" disabled');
    expect(html).toContain("requires 1 completed project(s)");
    expect(html).toContain("drops efficiency to 85%");
  });
});

describe("renderStall", () => {
  it("renders the banner only when stalled", () => {
    expect(renderStall(true)).toContain("stalled");
    expect(renderStall(false)).toBe("");
  });
});
