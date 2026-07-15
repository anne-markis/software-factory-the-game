import { describe, it, expect } from "vitest";
import { esc, renderDecisions, renderLog, renderChoices } from "./render";
import { parseStartConfig, parseDecisions, parseChallenges } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import challengesJson from "../../content/challenges.json";
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
