import { describe, it, expect } from "vitest";
import {
  esc,
  renderStats,
  renderDeliveryStats,
  renderDecisions,
  renderDecisionNode,
  decisionsPanelScaffold,
  ownedPanelScaffold,
  incomePanelScaffold,
  expensesPanelScaffold,
  logPanelScaffold,
  renderOwnedList,
  decisionNodeSection,
  OWNED_LIST_SECTION,
  INCOME_CHART_SECTION,
  INCOME_TITLE_SECTION,
  EXPENSES_CHART_SECTION,
  EXPENSES_TITLE_SECTION,
  LOG_SECTION,
  renderLog,
  renderIncomeChart,
  renderIncomeTitle,
  renderExpensesChart,
  renderExpensesTitle,
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
  renderBuildStamp,
} from "./render";
import { SECTION_ATTR } from "./domPatch";
import { parseStartConfig, parseDecisions, parseChallenges, parseProjects } from "../engine/content";
import { decisionsJson, loadShippedContent, projectsJson, startJson } from "../engine/loadShippedContent";
import { Engine, initialState } from "../engine/engine";
import { projectAvailability } from "../engine/projects";
import type { GameContent, GameState } from "../engine/types";
import { activateDueInstances } from "../engine/tick";

function content(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: [],
    projects: [{ id: "ktlo", name: "Keep the lights on", permanent: true, basePerDay: 0.5, perDay: 20 }],
  };
}

function shopBuyIds(html: string): string[] {
  return [...html.matchAll(/data-buy="([^"]+)"/g)].map((m) => m[1]!);
}

function nodeParts(html: string): { chrome: string; details: string } {
  const idx = html.indexOf('<div class="tt-node-details">');
  expect(idx).toBeGreaterThan(-1);
  return { chrome: html.slice(0, idx), details: html.slice(idx) };
}

describe("esc", () => {
  it("escapes html-significant characters", () => {
    expect(esc(`<b>&"x"</b>`)).toBe("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;");
  });
});

describe("renderStats", () => {
  // top bar keeps Day / Backlog / Budget / Points/Day / Idea→Value.
  it("renders the top-bar stats as label + width-classed value spans (no flow/quality stocks)", () => {
    const c = content();
    const e = new Engine(c);
    const html = renderStats(e.getState(), c);
    expect(html).toContain('<div class="stats">');
    expect(html).toContain(
      '<span class="stat" data-stat="day"><span class="stat-label">Day</span> <span class="stat-value v-day">0 (0 years)</span></span>',
    );
    expect(html).toContain('<span class="stat-label">Backlog</span> <span class="stat-value v-flow">');
    expect(html).toContain('<span class="stat-label">Budget</span> <span class="stat-value v-budget">$');
    expect(html).toContain('<span class="stat-label">Points/Day</span> <span class="stat-value v-rate">');
    expect(html).toContain(
      '<span class="stat" data-stat="ideaToValue"><span class="stat-label">Idea→Value</span> <span class="stat-value v-eta">',
    );
    expect(html).not.toContain("In Progress");
    expect(html).not.toContain(">Done<");
    expect(html).not.toContain("Shipped");
    expect(html).not.toContain("Tech Debt");
    expect(html).not.toContain("Reputation");
  });

  it("shows Idea→Value as an em dash when Points/Day is 0", () => {
    const c = content();
    const e = new Engine(c);
    const html = renderStats(e.getState(), c);
    expect(html).toContain('data-stat="ideaToValue"');
    expect(html).toContain('<span class="stat-value v-eta">—</span>');
  });

  it("shows Idea→Value as ~Nd when Points/Day is positive", () => {
    const c = content();
    const e = new Engine(c);
    const state = e.getState() as import("../engine/types").GameState;
    state.pointsPerDay = 10;
    state.stocks.ideas = 10000;
    state.plan = [{ defId: "ship-v1", name: "Ship v1", progress: 10, size: 400 }];
    // Fresh seed puts the initial project in Ready; pin unshipped for a
    // stable assertion.
    state.stocks.backlog = 50;
    state.stocks.inProgress = 0;
    state.stocks.inReview = 0;
    state.stocks.done = 0;
    const html = renderStats(state, c);
    // Plan size 400 + unshipped 50 = 450 / 10 = 45 days. Ideas stay out.
    expect(html).toContain('<span class="stat-value v-eta">~45d</span>');
  });

  // Budget must telegraph runway before payroll wipe.
  it("appends runway days to Budget when recurring burn is positive", () => {
    const c = content();
    const e = new Engine(c);
    const html = renderStats(e.getState(), c);
    // Fresh game: $25,000 / $30/day = 833 days; healthy, no warning class.
    expect(html).toContain('class="stat-value v-budget">$25,000 (833d)</span>');
    expect(html).not.toContain("budget-low");
  });

  it("marks Budget with budget-low when runway is at or under 14 days", () => {
    const c = content();
    const e = new Engine(c);
    e.applyDecision("basic-dev"); // +$438/day payroll and +$35 KTLO after they start → burn 503 with the granted product
    const state = e.getState() as GameState;
    for (const inst of state.decisions) {
      if (inst.activeOnDay !== undefined) inst.activeOnDay = state.day;
    }
    activateDueInstances(state, c);
    state.stocks.budget = 5030; // exactly 10 days
    const html = renderStats(state, c);
    expect(html).toContain('class="stat-value v-budget budget-low">$5,030 (10d)</span>');
  });

  it("appends Nd runway and warns at 1d", () => {
    const c = content();
    const e = new Engine(c);
    const state = e.getState();
    state.stocks.budget = 30; // 1 day at KTLO $30
    const html = renderStats(state, c);
    expect(html).toContain('class="stat-value v-budget budget-low">$30 (1d)</span>');
  });

  it("omits runway and warning when net burn is not positive", () => {
    const c = content();
    c.projects = [];
    const e = new Engine(c);
    e.applyDecision("subscription");
    const s = e.getState() as import("../engine/types").GameState;
    s.stocks.users = 40; // 40 users x $0.75/day of recurring income, no payroll
    const html = renderStats(e.getState(), c);
    expect(html).toContain('class="stat-value v-budget">$');
    expect(html).not.toContain(" days)");
    expect(html).not.toContain(" day)");
    expect(html).not.toMatch(/\(\d+d\)/);
    expect(html).not.toContain("budget-low");
  });
});

describe("renderDeliveryStats", () => {
  // flow/quality stocks under the Delivery loop, same slot pattern.
  it("renders In Progress, In Review, Done, Shipped, Tech Debt, Reputation, Users, and Ideas with fixed-width value slots", () => {
    const c = content();
    const e = new Engine(c);
    const html = renderDeliveryStats(e.getState());
    expect(html).toContain('<div class="delivery-stats">');
    expect(html).toContain('<span class="stat-label">In Progress</span> <span class="stat-value v-count">');
    expect(html).toContain('<span class="stat-label">In Review</span> <span class="stat-value v-count">');
    expect(html).toContain('<span class="stat-label">Done</span> <span class="stat-value v-count">');
    expect(html).toContain('<span class="stat-label">Shipped</span> <span class="stat-value v-flow">');
    expect(html).toContain('<span class="stat-label">Tech Debt</span> <span class="stat-value v-debt">');
    expect(html).toContain('<span class="stat-label">Reputation</span> <span class="stat-value v-rep">');
    expect(html).toContain('<span class="stat-label">Users</span> <span class="stat-value v-users">');
    expect(html).toContain('<span class="stat-label">Ideas</span> <span class="stat-value v-ideas">100</span>');
    expect(html).not.toContain("Day");
    expect(html).not.toContain("Backlog");
    expect(html).not.toContain("Budget");
    expect(html).not.toContain("Points/Day");
  });
});

describe("renderDecisions", () => {
  it("hides a prerequisite-locked node (ci-cd on a fresh game) until its requires are met", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    // ci-cd is omitted entirely — no name, no disabled Buy, no requires reason.
    expect(html).not.toContain('data-buy="ci-cd"');
    expect(html).not.toContain("requires Add test suite");
    expect(html).not.toContain("tt-locked");
    expect(html).not.toContain("CI/CD pipeline");
    // Empty Owned copy lives in the right-rail panel, not the shop.
    expect(html).not.toContain("Nothing yet. You are a solo dev.");
    expect(renderOwnedList([], content())).toBe("");
  });

  it("day-0 shop shows hack day and user interviews among starting cards; CI/CD and harness stay hidden", () => {
    const e = new Engine(content());
    const day0 = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(day0).toContain('data-buy="hack-day"');
    expect(day0).not.toContain('data-buy="hack-day" disabled');
    expect(day0).toContain('data-buy="user-interviews"');
    expect(day0).not.toContain('data-buy="user-interviews" disabled');
    expect(day0).not.toContain("Hold office hours");
    expect(day0).not.toContain("Run user research");
    // Agent harness / CI/CD hide rules are unchanged.
    expect(day0).not.toContain('data-buy="ci-cd"');
    expect(day0).not.toContain('data-buy="agent-harness"');

    e.applyDecision("hack-day");
    e.applyDecision("user-interviews");
    const after = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(after).toContain('data-buy="hack-day"');
    expect(after).toContain("owned x1");
    expect(after).toContain('data-buy="user-interviews"');
    expect(after).not.toContain('data-buy="ci-cd"');
    expect(after).not.toContain('data-buy="agent-harness"');
  });

  // scaffold lays out one patchable section per
  // shop-visible decision. Owned unique and missing-requires omit their shells.
  // Owned chrome is no longer part of the shop scaffold.
  it("decisionsPanelScaffold exposes a section shell for every shop-visible decision without Owned", () => {
    const c = content();
    const e = new Engine(c);
    const avail = e.availableDecisions();
    const html = decisionsPanelScaffold(c, [...e.getState().decisions], avail);
    expect(html).toContain(`<h3>Alter the system</h3>`);
    expect(html).not.toContain("Alter the loop");
    expect(html).not.toContain(`<h3>Owned</h3>`);
    expect(html).not.toContain(`${SECTION_ATTR}="${OWNED_LIST_SECTION}"`);
    for (const a of avail) {
      if (a.code === "missing-requires" || a.code === "already-owned") {
        expect(html).not.toContain(`${SECTION_ATTR}="${decisionNodeSection(a.def.id)}"`);
      } else {
        expect(html).toContain(`${SECTION_ATTR}="${decisionNodeSection(a.def.id)}"`);
      }
    }
    // Scaffold is structure only — no live Buy buttons yet.
    expect(html).not.toContain("data-buy=");
  });

  it("ownedPanelScaffold exposes the Owned list patch target inside expanded details", () => {
    const html = ownedPanelScaffold();
    expect(html).toContain(`<h3>Owned</h3>`);
    expect(html).toContain(`${SECTION_ATTR}="${OWNED_LIST_SECTION}"`);
    expect(html).toMatch(/<details class="panel side-details" open>/);
  });

  it("decisionsPanelScaffold omits shells for owned unique decisions", () => {
    const c = content();
    const e = new Engine(c);
    e.applyDecision("test-suite");
    const avail = e.availableDecisions();
    const html = decisionsPanelScaffold(c, e.getState().decisions, avail);
    expect(html).not.toContain(`${SECTION_ATTR}="${decisionNodeSection("test-suite")}"`);
    // Downstream ci-cd is unlocked and stays in the shop layout.
    expect(html).toContain(`${SECTION_ATTR}="${decisionNodeSection("ci-cd")}"`);
    // Repeatable agent still has a shell even after purchase.
    e.applyDecision("agent");
    const afterAgent = decisionsPanelScaffold(c, e.getState().decisions, e.availableDecisions());
    expect(afterAgent).toContain(`${SECTION_ATTR}="${decisionNodeSection("agent")}"`);
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
    expect(html).toContain('data-buy="hack-day" disabled');
    expect(html).toContain("cannot afford");
    // Prerequisite-locked cards stay hidden even when broke.
    expect(html).not.toContain('data-buy="ci-cd"');
    expect(html).not.toContain("requires Add test suite");
  });

  it("shows owned instances with gamble outcome and remove button", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const inst = e.getState().decisions.find((d) => d.defId === "basic-dev")!;
    const html = renderOwnedList([...e.getState().decisions], content());
    expect(html).toContain(`data-remove="${inst.instanceId}"`);
    expect(html).toContain(`[${inst.gambleLabel}]`);
  });

  it("lists removable owned instances newest-first", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    e.applyDecision("subscription");
    e.applyDecision("agent");
    const html = renderOwnedList([...e.getState().decisions], content());
    const agent = html.indexOf("Add coding agent");
    const subscription = html.indexOf("Subscription plan");
    const hire = html.indexOf("Hire basic developer");
    expect(agent).toBeGreaterThan(-1);
    expect(agent).toBeLessThan(subscription);
    expect(subscription).toBeLessThan(hire);
  });

  // Owned entries surface cost + derived effects (same helpers as shop cards) so upkeep trim does not require scrolling Alter the system.
  it("shows cost and derived effects on each Owned entry", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    e.applyDecision("agent");
    const ownedHtml = renderOwnedList([...e.getState().decisions], content());
    expect(ownedHtml).toContain("owned-item");
    expect(ownedHtml).toContain('<div class="owned-cost">$2000 once + 14 days + $438/day</div>');
    expect(ownedHtml).toContain('<div class="owned-cost">$10/human once + $4/human/day</div>');
    // Gamble range (basic-dev) and the agent's deterministic effects both
    // reuse the shop's .tt-effects line inside the Owned panel.
    expect(ownedHtml).toMatch(/owned-item[\s\S]*tt-effects[\s\S]*capacity \+1/);
    expect(ownedHtml).toContain("finish +1.0 to -1.0, review +0.7 to +0.1, morale +4.0 to -15.0");
    expect(ownedHtml).toContain("joining in 14 days");
    expect(ownedHtml).toContain("Add coding agent");
    expect(ownedHtml).toContain(
      "finish +0.2/day (+10%/human), plan +0.2/day (+10%/human), review +0.05/day, debt +0.04",
    );
    expect(ownedHtml).toContain('data-remove=');
  });

  it("escapes content-derived strings", () => {
    const c = content();
    c.decisions[0].name = `<img src=x onerror=alert(1)>`;
    const e = new Engine(c);
    const html = renderDecisions(e.availableDecisions(), [], c);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("hides an owned unique decision from the shop while keeping a removable unique in Owned", () => {
    const e = new Engine(content());
    e.applyDecision("subscription");
    const shop = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    const owned = renderOwnedList([...e.getState().decisions], content());
    // Card node is gone: no tt-node name, no tt-owned placeholder, no Buy.
    expect(shop).not.toMatch(/tt-node-name[^>]*>Subscription plan/);
    expect(shop).not.toContain("tt-owned");
    expect(shop).not.toContain('data-buy="subscription"');
    expect(shop).not.toContain("<h3>Owned</h3>");
    // Removable unique stays listed under Owned so it can be dropped.
    expect(owned).toContain("Subscription plan");
    expect(owned).toContain("data-remove=");
  });

  it("omits non-removable owned instances from the Owned list", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    e.applyDecision("user-interviews");
    e.applyDecision("basic-dev");
    const shop = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    const owned = renderOwnedList([...e.getState().decisions], content());
    expect(owned).not.toContain("Add test suite");
    expect(owned).not.toContain("User interviews");
    expect(owned).toContain("Hire basic developer");
    expect(owned).toContain("data-remove=");
    expect(shop).not.toMatch(/tt-node-name[^>]*>Add test suite/);
    expect(shop).not.toContain('data-buy="test-suite"');
    // Unlocked downstream sits in the flat list with no chain header.
    expect(shop).not.toMatch(/<h4>/);
    expect(shop).not.toContain("Standalone");
    expect(shop).toContain('data-buy="ci-cd"');
    expect(shop).toContain('data-buy="basic-dev"');
  });

  it("returns a removable unique card to the shop after Remove", () => {
    const e = new Engine(content());
    e.applyDecision("subscription");
    const owned = [...e.getState().decisions];
    expect(owned.filter((d) => d.defId === "subscription")).toHaveLength(1);
    let shop = renderDecisions(e.availableDecisions(), owned, content());
    expect(shop).not.toContain("Subscription plan");
    e.removeDecision(owned.find((d) => d.defId === "subscription")!.instanceId);
    shop = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(shop).toContain("Subscription plan");
    expect(shop).toContain('data-buy="subscription"');
  });

  it("shows a repeatable decision's owned count while keeping the Buy button live", () => {
    const e = new Engine(content());
    // agent is the Studio shop's stackable card: buying a second
    // copy shows the count without retiring the Buy button.
    e.applyDecision("agent");
    e.applyDecision("agent");
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).toContain("owned x2");
    expect(html).toContain('data-buy="agent"');
  });

  it("renders a flat shop: no chain headers, Standalone, or arrows", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).toMatch(/tt-node-name[^>]*>Add test suite</);
    expect(html).toMatch(/tt-node-name[^>]*>Add coding agent</);
    expect(html).toMatch(/tt-node-name[^>]*>Hire basic developer</);
    expect(html).not.toMatch(/<h4>/);
    expect(html).not.toContain("Standalone");
    expect(html).not.toContain("tt-arrow");
    expect(html).not.toContain("&rarr;");
    expect(html).toContain("tt-shop-grid");
    // Category tags left with the fat card.
    expect(html).not.toContain("tt-cat");
    expect(html).not.toContain(">speed<");
    expect(html).not.toContain(">debt<");
  });

  // shop order is the resolved catalog array (decisions.json),
  // not the requires-graph tree-walk. Hidden ids leave a hole — they are
  // not pulled forward and not regrouped under a chain header.
  it("paints fresh Studio shop in decisions.json order", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    // ci-cd / harness / orchestration stay hidden (unmet requires).
    expect(shopBuyIds(html)).toEqual([
      "test-suite",
      "basic-dev",
      "agent",
      "hack-day",
      "user-interviews",
      "subscription",
      "raise-round",
      "sell-company",
    ]);
  });

  it("inserts unlocked CI/CD into its JSON slot after test-suite, not at the end", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).not.toMatch(/<h4>/);
    expect(html).not.toContain("Standalone");
    // test-suite is owned-unique (hidden); ci-cd appears where the file
    // put it — after that hole, before basic-dev.
    expect(shopBuyIds(html)).toEqual([
      "ci-cd",
      "basic-dev",
      "agent",
      "hack-day",
      "user-interviews",
      "subscription",
      "raise-round",
      "sell-company",
    ]);
  });

  it("inserts harness and orchestration after agent once two agents are owned", () => {
    const e = new Engine(content());
    e.applyDecision("agent");
    e.applyDecision("agent");
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(shopBuyIds(html)).toEqual([
      "test-suite",
      "basic-dev",
      "agent",
      "agent-harness",
      "agent-orchestration",
      "hack-day",
      "user-interviews",
      "subscription",
      "raise-round",
      "sell-company",
    ]);
  });

  it("keeps scaffold shells in the same catalog order as live Buy buttons", () => {
    const c = content();
    const e = new Engine(c);
    const avail = e.availableDecisions();
    const owned = [...e.getState().decisions];
    const scaffold = decisionsPanelScaffold(c, owned, avail);
    const live = renderDecisions(avail, owned, c);
    const shellIds = [...scaffold.matchAll(/data-section="decision-node:([^"]+)"/g)].map((m) => m[1]!);
    expect(shellIds).toEqual(shopBuyIds(live));
    expect(shellIds).toEqual([
      "test-suite",
      "basic-dev",
      "agent",
      "hack-day",
      "user-interviews",
      "subscription",
      "raise-round",
      "sell-company",
    ]);
  });

  it("no longer renders the retired unlock-count hint", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    expect(html).not.toContain("more alterations unlock");
  });

  it("renders a card's authored description in full, with no first-sentence truncation, plus a derived effects line", () => {
    const e = new Engine(content());
    // Unlock orchestration so its long description is in the shop.
    e.applyDecision("agent");
    e.applyDecision("agent");
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    // agent-orchestration's description (>110 chars, multiple sentences) is a
    // known long-ish entry -- assert it appears whole, not clipped to its first
    // sentence or an ellipsis (Release 20 removes the old 87-char truncation).
    const orchestrationDesc =
      "A planner splits work across your agents and reviews what comes back: finishing, planning, and review 45% faster, tech debt grows 45% slower, and the same humans cover a larger fleet. Needs at least two agents to coordinate. Adds $30/day to Keep the lights on.";
    expect(orchestrationDesc.length).toBeGreaterThan(110);
    expect(html).toContain(`<div class="tt-node-desc">${orchestrationDesc}</div>`);
    expect(html).not.toContain("...");
    // Description + derived effects live in the disclosure, not on the row
    // test-suite's derived line is a known, stable case.
    expect(html).toContain('<div class="tt-effects">all rates x0.5 for 5d, debt x0.5</div>');
    const orch = html.indexOf("A planner splits work");
    const orchDetails = html.lastIndexOf('<div class="tt-node-details">', orch);
    expect(orchDetails).toBeGreaterThan(-1);
    expect(orchDetails).toBeLessThan(orch);
  });

  it("flags gamble decisions with a chip and omits it from deterministic ones", () => {
    const e = new Engine(content());
    const html = renderDecisions(e.availableDecisions(), [...e.getState().decisions], content());
    // basic-dev is the lean shop's only gamble hire (cut senior-dev),
    // so exactly one card carries the chip. A deterministic decision
    // (test-suite) does not.
    const gambleChips = html.match(/class="tt-gamble"/g) ?? [];
    expect(gambleChips.length).toBe(2);
    expect(html).toContain('<span class="tt-gamble"');
    // The "(gamble)" suffix moved out of the derived line onto the chip, so a
    // gamble card shows the range alone.
    expect(html).not.toContain("(gamble)");
  });

  // slim shop row — Buy | name, gamble, owned, cost. Description
  // and derived effects move into a disclosure; category tags leave the chrome.
  it("renders a slim row with left Buy, name, optional gamble/owned, and cost", () => {
    const e = new Engine(content());
    const avail = e.availableDecisions();
    const testSuite = avail.find((a) => a.def.id === "test-suite")!;
    const html = renderDecisionNode(testSuite, 0);
    const { chrome, details } = nodeParts(html);

    expect(html).toMatch(/<button class="tt-buy" data-buy="test-suite"\s*>Buy<\/button>/);
    expect(chrome.indexOf("tt-buy")).toBeLessThan(chrome.indexOf("tt-node-name"));
    expect(chrome.indexOf("tt-node-name")).toBeLessThan(chrome.indexOf("tt-cost"));
    expect(chrome).toMatch(/tt-node-name[^>]*>Add test suite</);
    expect(chrome).toContain('$500 once');
    expect(chrome).toContain("tt-node-disclose");
    expect(chrome).toMatch(/aria-expanded="false"/);
    expect(chrome).not.toContain("tt-gamble");
    expect(chrome).not.toContain("owned x");
    expect(chrome).not.toContain("tt-cat");
    expect(chrome).not.toContain("tt-node-desc");
    expect(chrome).not.toContain("tt-effects");
    expect(details).toContain("tt-node-desc");
    expect(details).toContain("Halves tech debt permanently");
    expect(details).toContain('<div class="tt-effects">all rates x0.5 for 5d, debt x0.5</div>');
    expect(details).not.toContain("data-buy");
    // Native title is not the description disclosure.
    expect(html).not.toContain(`title="${testSuite.def.description}"`);
  });

  it("keeps the gamble chip on the row, not only in the disclosure", () => {
    const e = new Engine(content());
    const basic = e.availableDecisions().find((a) => a.def.id === "basic-dev")!;
    const { chrome, details } = nodeParts(renderDecisionNode(basic, 0));
    expect(chrome).toContain('class="tt-gamble"');
    expect(chrome).not.toContain("title=");
    expect(chrome.indexOf("tt-node-name")).toBeLessThan(chrome.indexOf("tt-gamble"));
    expect(chrome.indexOf("tt-gamble")).toBeLessThan(chrome.indexOf("tt-cost"));
    expect(details).not.toContain("tt-gamble");
  });

  it("shows repeatable owned xN on the row with a live Buy", () => {
    const e = new Engine(content());
    e.applyDecision("agent");
    e.applyDecision("agent");
    const agent = e.availableDecisions().find((a) => a.def.id === "agent")!;
    const html = renderDecisionNode(agent, 2);
    const { chrome } = nodeParts(html);
    expect(chrome).toContain("owned x2");
    expect(html).toMatch(/<button class="tt-buy" data-buy="agent"\s*>Buy<\/button>/);
    expect(html).not.toContain("disabled");
  });

  it("keeps cannot-afford reason on the row without opening details", () => {
    const c = content();
    c.start.stocks.budget = 0;
    const e = new Engine(c);
    const hack = e.availableDecisions().find((a) => a.def.id === "hack-day")!;
    const html = renderDecisionNode(hack, 0);
    const { chrome, details } = nodeParts(html);
    expect(html).toMatch(/<button class="tt-buy" data-buy="hack-day" disabled>Buy<\/button>/);
    expect(chrome).toContain('class="tt-reason"');
    expect(chrome).toContain("cannot afford");
    expect(details).not.toContain("cannot afford");
    expect(details).not.toContain("tt-reason");
  });
});

describe("renderLog", () => {
  it("shows most recent entries first, capped at 30, escaped", () => {
    const log = Array.from({ length: 40 }, (_, i) => ({ day: i, message: `msg ${i} <b>` }));
    const html = renderLog(log);
    expect(html).toContain("Day 39: msg 39 &lt;b&gt;");
    expect(html).not.toContain("Day 9:");
    expect(html.indexOf("Day 39:")).toBeLessThan(html.indexOf("Day 38:"));
    expect(html).not.toContain("Events");
  });

  it("renders an empty log with no placeholder copy", () => {
    expect(renderLog([])).not.toContain("Quiet so far.");
    expect(renderLog([])).toContain('<div class="log"></div>');
  });
});

describe("side rail scaffolds", () => {
  it("Income, Expenses, Events, and Owned chrome are expanded details with patch targets", () => {
    expect(incomePanelScaffold()).toContain(`${SECTION_ATTR}="${INCOME_TITLE_SECTION}"`);
    expect(incomePanelScaffold()).toContain(`${SECTION_ATTR}="${INCOME_CHART_SECTION}"`);
    expect(expensesPanelScaffold()).toContain(`${SECTION_ATTR}="${EXPENSES_TITLE_SECTION}"`);
    expect(expensesPanelScaffold()).toContain(`${SECTION_ATTR}="${EXPENSES_CHART_SECTION}"`);
    expect(logPanelScaffold()).toContain(`${SECTION_ATTR}="${LOG_SECTION}"`);
    expect(incomePanelScaffold()).toMatch(/<details class="panel side-details" open>/);
    expect(expensesPanelScaffold()).toMatch(/<details class="panel side-details" open>/);
    expect(logPanelScaffold()).toMatch(/<details class="panel side-details" open>/);
    expect(logPanelScaffold()).toContain("<h3>Events</h3>");
  });
});

describe("renderIncomeTitle", () => {
  it("rolls up the latest day's recurring and burst", () => {
    expect(renderIncomeTitle([])).toBe("Income: $0");
    expect(renderIncomeTitle([{ day: 1, recurring: 0, burst: 0 }])).toBe("Income: $0");
    expect(renderIncomeTitle([
      { day: 10, recurring: 75, burst: 0 },
      { day: 11, recurring: 354, burst: 180 },
    ])).toBe("Income: $534");
  });
});

describe("renderExpensesTitle", () => {
  it("rolls up the latest day's human, agents, and KTLO", () => {
    expect(renderExpensesTitle([])).toBe("Expenses: $0");
    expect(renderExpensesTitle([{ day: 1, human: 0, agents: 0, ktlo: 0 }])).toBe("Expenses: $0");
    expect(renderExpensesTitle([
      { day: 10, human: 0, agents: 0, ktlo: 20 },
      { day: 11, human: 438, agents: 16, ktlo: 37 },
    ])).toBe("Expenses: $491");
  });
});

describe("renderIncomeChart", () => {
  it("shows an empty state when no dollars have been earned", () => {
    expect(renderIncomeChart([])).toContain("No income yet.");
    expect(renderIncomeChart([{ day: 1, recurring: 0, burst: 0 }])).toContain("No income yet.");
    expect(renderIncomeChart([{ day: 1, recurring: 0, burst: 0 }])).not.toContain("income-bars");
  });

  it("stacks recurring and burst as separate series with latest totals", () => {
    const html = renderIncomeChart([
      { day: 10, recurring: 75, burst: 0 },
      { day: 11, recurring: 75, burst: 120 },
    ]);
    expect(html).toContain("income-recurring");
    expect(html).toContain("income-burst");
    expect(html).toContain("Recurring $75/day");
    expect(html).toContain("Burst $120/day");
    expect(html).toContain('aria-label="Income per day last 2 days, recurring and burst"');
    expect(html).toContain("Day 11: recurring $75/day, burst $120/day");
  });
});

describe("renderExpensesChart", () => {
  it("shows an empty state when no dollars have been spent", () => {
    expect(renderExpensesChart([])).toContain("No expenses yet.");
    expect(renderExpensesChart([{ day: 1, human: 0, agents: 0, ktlo: 0 }])).toContain("No expenses yet.");
    expect(renderExpensesChart([{ day: 1, human: 0, agents: 0, ktlo: 0 }])).not.toContain("income-bars");
  });

  it("stacks human, agents, and KTLO as separate series with latest totals", () => {
    const html = renderExpensesChart([
      { day: 10, human: 0, agents: 0, ktlo: 20 },
      { day: 11, human: 438, agents: 16, ktlo: 37 },
    ]);
    expect(html).toContain("exp-human");
    expect(html).toContain("exp-agents");
    expect(html).toContain("exp-ktlo");
    expect(html).toContain("Human $438/day");
    expect(html).toContain("Agents $16/day");
    expect(html).toContain("KTLO $37/day");
    expect(html).toContain('aria-label="Expenses per day last 2 days, human, agents, and KTLO"');
    expect(html).toContain("Day 11: human $438/day, agents $16/day, ktlo $37/day");
  });
});

describe("renderChoicesScaffold", () => {
  // Engine still supports choice challenges for fixtures / later eras; shipped
  // Studio content is immediate-only.
  const fixtureChoice = parseChallenges([
    {
      id: "fixture-choice",
      name: "Fixture choice",
      description: "Pick one.",
      probabilityPerDay: 0,
      effects: [],
      choice: {
        expiresInDays: 4,
        defaultOptionId: "pay",
        options: [
          { id: "pay", label: "Pay", effects: [] },
          { id: "skip", label: "Skip", effects: [] },
        ],
      },
    },
  ]);

  it("renders nothing without pending choices", () => {
    expect(renderChoicesScaffold([], fixtureChoice)).toBe("");
  });

  it("renders option buttons and a countdown placeholder for a pending choice", () => {
    const html = renderChoicesScaffold([{ challengeId: "fixture-choice", expiresDay: 8 }], fixtureChoice);
    expect(html).toContain('data-choice="fixture-choice" data-option="pay"');
    expect(html).toContain("Decision needed");
    // interrupt affordance uses class chrome + alertdialog role.
    expect(html).toContain('class="panel choice-interrupt"');
    expect(html).toContain('role="alert"');
    // The countdown is patched separately so the day ticking down
    // does not rebuild the option buttons: the scaffold carries only its slot.
    expect(html).toContain(`<em data-section="${choiceCountdownSection("fixture-choice")}"></em>`);
    expect(html).not.toContain("days left");
  });

  it("keeps the same scaffold string as days pass, so the memo holds", () => {
    const pending = [{ challengeId: "fixture-choice", expiresDay: 8 }];
    expect(renderChoicesScaffold(pending, fixtureChoice)).toBe(renderChoicesScaffold(pending, fixtureChoice));
  });
});

describe("renderChoiceCountdown", () => {
  it("renders the remaining days while the clock is running", () => {
    expect(renderChoiceCountdown({ challengeId: "fixture-choice", expiresDay: 8 }, 5)).toBe("(3d)");
    expect(renderChoiceCountdown({ challengeId: "fixture-choice", expiresDay: 8 }, 6)).toBe("(2d)");
  });

  // manual pause freezes expiresDay, so a ticking countdown would lie.
  it("renders nothing while paused", () => {
    expect(renderChoiceCountdown({ challengeId: "fixture-choice", expiresDay: 8 }, 5, true)).toBe("");
  });
});

describe("renderProjectsStatus", () => {
  it("shows the Projects header, In flight group, remaining, and effect chips", () => {
    const c = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
    const e = new Engine(c);
    const html = renderProjectsStatus([...e.getState().projects], e.getState(), c);
    expect(html).toContain("<h3>Projects</h3>");
    expect(html).toContain("<th>Project</th>");
    expect(html).toContain("<th>Size</th>");
    expect(html).toContain("<th>Ideas</th>");
    expect(html).toContain("<th>Start $</th>");
    expect(html).toContain("<th>$/pt</th>");
    expect(html).toContain("<th>Done $</th>");
    expect(html).toContain("<th>Effects</th>");
    expect(html).toContain("In flight");
    expect(html).not.toContain("WIP");
    expect(html).not.toContain("efficiency");
    expect(html).toContain("Launch beta");
    expect(html).toContain("300 left");
    expect(html).toContain("+1 rep");
    expect(html).toContain("+30 users");
    // Fresh engine has not ticked yet — realized Points/Day is 0 → stalled
    // (FR-3.2).
    expect(html).toContain(">stalled<");
    expect(html).toContain('data-abandon="launch-beta"');
    expect(html).toContain(">Abandon<");
    expect(html).not.toContain(">Cancel<");
    // The Start buttons live in the sibling offers section, not here, so the
    // per-tick progress update cannot tear them down.
    expect(html).not.toContain('data-project="');
  });

  it("shows Planning rows with progress / size, slice ETA, and Cancel (not Abandon)", () => {
    const c = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
    const s = initialState(c);
    s.plan = [{ defId: "ship-v1", name: "Ship v1", progress: 12, size: 400 }];
    const html = renderProjectsStatus([...s.projects], s, c);
    expect(html).toContain("In plan");
    expect(html).toContain('data-plan-status="ship-v1"');
    expect(html).toContain("12 / 400");
    expect(html).toContain("~388d");
    expect(html).toContain('data-cancel="ship-v1"');
    expect(html).toContain(">Cancel<");
    expect(html).not.toMatch(/data-abandon="ship-v1"/);
    expect(html).toContain('data-abandon="launch-beta"');
    expect(html).toContain(">Abandon<");
  });

  it("splits Planning ETAs across named Plan items at the plan rate", () => {
    const c = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
    const s = initialState(c);
    s.plan = [
      { defId: "ship-v1", name: "Ship v1", progress: 0, size: 400 },
      { defId: "large-refactor", name: "Large refactor", progress: 0, size: 1000 },
    ];
    const html = renderProjectsStatus([...s.projects], s, c);
    expect(html).toContain("0 / 400");
    expect(html).toContain("0 / 1,000");
    expect(html).toContain("~800d");
    expect(html).toContain("~2,000d");
    expect(html.match(/data-cancel="/g)).toHaveLength(2);
  });

  // P0.1 FR-3: derived ~days from remaining ÷ Points/Day.
  it("shows ~Nd when Points/Day is positive", () => {
    const c = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
    const s = initialState(c);
    // Pipeline fill takes several days before realized Points/Day is non-zero;
    // set the rate directly so this asserts the derived line, not tick lag.
    s.pointsPerDay = 1;
    const html = renderProjectsStatus([...s.projects], s, c);
    expect(html).toContain("300 left");
    expect(html).toContain("~300d");
    expect(html).not.toContain(">stalled<");
  });

  it("updates the estimate when Points/Day changes", () => {
    const c = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
    const s = initialState(c);
    s.pointsPerDay = 10;
    s.projects[0]!.remaining = 100;
    expect(renderProjectsStatus([...s.projects], s, c)).toContain("~10d");
    s.pointsPerDay = 0;
    expect(renderProjectsStatus([...s.projects], s, c)).toContain(">stalled<");
  });

  it("lengthens each in-flight ETA when a second contract starts, then shortens when one leaves", () => {
    const c = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
    const s = initialState(c);
    s.pointsPerDay = 1;
    s.projects[0]!.remaining = 100;
    expect(renderProjectsStatus([...s.projects], s, c)).toContain("~100d");
    expect(s.pointsPerDay).toBe(1);

    s.projects.push({
      defId: "gig-landing-page",
      name: "Back-burner feature",
      remaining: 100,
      payoutPerPoint: 16,
      completionBonus: 300,
      reputationReward: 1,
    });
    const two = renderProjectsStatus([...s.projects], s, c);
    expect(two).toContain("Launch beta");
    expect(two).toContain("Back-burner feature");
    expect(two.match(/100 left/g)).toHaveLength(2);
    expect(two.match(/~200d/g)).toHaveLength(2);
    expect(s.pointsPerDay).toBe(1);
    expect(two).not.toContain("efficiency");

    s.projects = s.projects.filter((p) => p.defId !== "gig-landing-page");
    const one = renderProjectsStatus([...s.projects], s, c);
    expect(one).toContain("~100d");
    expect(one).not.toContain("~200d");
  });

  it("pins Keep the lights on above in-flight work and keeps a Studio gig abandonable", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    e.startProject("gig-landing-page");
    const companyBudget = loadShippedContent().eras!.eras.find((era) => era.id === "company")!.entryAnyOf![0].minBudget!;
    e.getState().stocks.budget = companyBudget + 20;
    e.tick();
    const html = renderProjectsStatus([...e.getState().projects], e.getState(), e.getContent());
    const always = html.indexOf("Always on");
    const flight = html.indexOf("In flight");
    expect(always).toBeGreaterThan(-1);
    expect(always).toBeLessThan(flight);
    expect(html).toContain("Keep the lights on");
    expect(html).toContain("always on");
    expect(html).toContain(">On<");
    expect(html).toContain("0.2/day of finish");
    expect(html).toContain("$30/day");
    expect(html).toContain("hosting $0 until 1 user");
    expect(html).toContain("cannot cancel");
    expect(html).not.toContain("seat");
    expect(html).not.toContain('data-abandon="ktlo"');
    expect(html).not.toContain("Bugfix sprint");
    expect(html).toContain("Back-burner feature");
    expect(html).toContain('data-abandon="gig-landing-page"');
    e.getState().stocks.users = 150;
    const band = renderProjectsStatus([...e.getState().projects], e.getState(), e.getContent());
    expect(band).toContain("hosting $18 until 400 users");
    expect(band).toContain("$48/day");
    e.getState().modifiers.push({
      id: "spike",
      source: "usage-overage",
      target: "ktloCash",
      op: "add",
      value: 40,
      expiresDay: e.getState().day + 3,
    });
    const spiked = renderProjectsStatus([...e.getState().projects], e.getState(), e.getContent());
    expect(spiked).toContain("$88/day");
    expect(spiked).toContain("spike $40/day");
    const offers = renderProjectOffers(e.availableProjects(), e.getState());
    expect(offers).not.toContain("Bugfix sprint");
    expect(offers).not.toContain("Back-burner feature");
  });
});

describe("renderProjectOffers", () => {
  function studioProjects(): GameContent {
    return {
      start: parseStartConfig(startJson),
      decisions: [],
      challenges: [],
      projects: parseProjects(projectsJson),
    };
  }

  // unmet prerequisite rows are omitted; startable gigs stay.
  it("shows startable offers without efficiency copy, omitting the critical-path gates", () => {
    const c = studioProjects();
    const e = new Engine(c);
    const html = renderProjectOffers(e.availableProjects(), e.getState());
    expect(html).toContain('data-project="gig-landing-page" ');
    expect(html).not.toContain("Bugfix sprint");
    expect(html).toContain("Back-burner feature");
    expect(html).toContain("$3,000");
    expect(html).not.toContain("$200 start");
    expect(html).toContain("150 pts");
    expect(html).toContain("$16");
    expect(html).toContain("$300");
    expect(html).toContain("+1 rep");
    expect(html).not.toMatch(/100 · \$0 ·/);
    expect(html).not.toMatch(/efficiency/i);
    expect(html).not.toContain("drops efficiency");
    for (const id of ["ship-v1", "ship-vnext"]) {
      expect(html).not.toContain(`data-project="${id}"`);
    }
    expect(html).not.toContain("requires completed Launch beta");
    expect(html).not.toContain("requires completed Ship v1");
  });

  it("reveals Ship v1 after Launch beta completes, keeping the next feature hidden", () => {
    const c = studioProjects();
    const s = initialState(c);
    s.completedProjects = 1;
    s.completedProjectIds = ["launch-beta"];
    const html = renderProjectOffers(projectAvailability(s, c), s);
    expect(html).toContain('data-project="ship-v1"');
    expect(html).not.toContain("requires completed Launch beta");
    expect(html).not.toContain('data-project="ship-vnext"');
    expect(html).not.toContain("requires completed Ship v1");
  });

  it("hides a reputation-gated offer below the floor and shows it at the floor", () => {
    const fixture = {
      id: "rep-gated",
      name: "Reputation Gated Contract",
      sizePoints: 1000,
      upfrontCost: 0,
      payoutPerPoint: 10,
      completionBonus: 500,
      reputationReward: 3,
      requiresReputation: 5,
    };
    const c: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [],
      challenges: [],
      projects: [fixture],
    };
    const s = initialState(c);
    expect(s.stocks.reputation).toBe(0);
    expect(renderProjectOffers(projectAvailability(s, c), s)).not.toContain('data-project="rep-gated"');
    expect(renderProjectOffers(projectAvailability(s, c), s)).not.toContain("requires 5 reputation");
    s.stocks.reputation = 5;
    const unlocked = renderProjectOffers(projectAvailability(s, c), s);
    expect(unlocked).toContain('data-project="rep-gated"');
    expect(unlocked).not.toContain("requires 5 reputation");
  });

  it("lists Ship v1 as disabled Pursue after Launch beta while Ideas are short, and omits it before", () => {
    const c = studioProjects();
    const s = initialState(c);
    expect(renderProjectOffers(projectAvailability(s, c), s)).not.toContain('data-project="ship-v1"');
    s.completedProjects = 1;
    s.completedProjectIds = ["launch-beta"];
    s.stocks.ideas = 100;
    const html = renderProjectOffers(projectAvailability(s, c), s);
    expect(html).toContain('data-project="ship-v1" disabled>Pursue<');
    expect(html).toContain('class="num proj-warn">200<');
    expect(html).not.toContain("cannot afford");
    expect(html).not.toContain('data-project="ship-v1" disabled>Start<');
  });

  it("labels Start vs Pursue from the catalog flag and keeps Start live while Plan is filling", () => {
    const c = studioProjects();
    const s = initialState(c);
    s.completedProjects = 1;
    s.completedProjectIds = ["launch-beta"];
    s.stocks.ideas = 400;
    s.plan = [{ defId: "large-refactor", name: "Large refactor", progress: 3, size: 1000 }];
    const html = renderProjectOffers(projectAvailability(s, c), s);
    expect(html).toContain('data-project="gig-landing-page" >Start<');
    expect(html).not.toContain('data-project="gig-landing-page" disabled');
    expect(html).toContain('data-project="ship-v1" >Pursue<');
    expect(html).not.toContain('data-project="large-refactor"');
  });

  it("keeps cannot-afford offers visible and disabled", () => {
    const fixture = {
      id: "pricey",
      name: "Pricey Contract",
      sizePoints: 100,
      upfrontCost: 50_000,
      payoutPerPoint: 10,
      completionBonus: 100,
      reputationReward: 1,
    };
    const c: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [],
      challenges: [],
      projects: [fixture],
    };
    const s = initialState(c);
    s.stocks.budget = 0;
    const html = renderProjectOffers(projectAvailability(s, c), s);
    expect(html).toContain('data-project="pricey" disabled');
    expect(html).toContain("cannot afford");
    expect(html).toContain('class="num proj-warn">$50,000<');
  });

  // finished unique versions leave the offers list; repeatables stay.
  it("hides an already-completed unique offer while keeping repeatable gigs", () => {
    const c = studioProjects();
    const s = initialState(c);
    s.completedProjects = 2;
    s.completedProjectIds = ["launch-beta", "ship-v1"];
    const html = renderProjectOffers(projectAvailability(s, c), s);
    expect(html).not.toContain('data-project="ship-v1"');
    expect(html).not.toContain("already completed");
    // The repeatable follow-on is unlocked and still shown.
    expect(html).toContain('data-project="ship-vnext"');
    expect(html).toContain("Ship next feature");
    // Repeatable gigs remain offerable after any completions.
    expect(html).toContain('data-project="gig-landing-page"');
    expect(projectAvailability(s, c).find((p) => p.def.id === "gig-landing-page")!.startable).toBe(true);
  });

  it("labels Ideas on Pursue, omits $0 money, and chips debt / users effects", () => {
    const c = studioProjects();
    const s = initialState(c);
    s.completedProjects = 1;
    s.completedProjectIds = ["launch-beta"];
    s.stocks.ideas = 400;
    const html = renderProjectOffers(projectAvailability(s, c), s);
    expect(html).toContain("Available");
    expect(html).toContain("debt −50");
    expect(html).toContain("+20 users");
    expect(html).toContain("+1 users/day");
    expect(html).toContain("400 pts");
    expect(html).toContain("$1,000");
    expect(html).not.toContain("$0/pt");
    expect(html).toContain('data-project="medium-refactor" >Start<');
    expect(html).toContain("150 pts");
    expect(html).toContain("debt −150");
    expect(html).toContain('data-project="large-refactor" >Pursue<');
    expect(html).toContain("1,000 pts");
    expect(html).toContain('class="num">200<');
    expect(html).toContain("debt −1000");
  });

  it("omits an already-in-flight catalog row from Available (it lives in In flight)", () => {
    const c = studioProjects();
    const s = initialState(c);
    s.projects.push({
      defId: "gig-landing-page",
      name: "Back-burner feature",
      remaining: 150,
      payoutPerPoint: 16,
      completionBonus: 300,
      reputationReward: 1,
    });
    const html = renderProjectOffers(projectAvailability(s, c), s);
    expect(html).not.toContain('data-project="gig-landing-page"');
    expect(html).toContain('data-project="small-refactor"');
  });

  it("does not change as in-flight work progresses, so the Start buttons survive the tick", () => {
    const c = studioProjects();
    const s = initialState(c);
    const before = renderProjectOffers(projectAvailability(s, c), s);
    s.projects[0].remaining -= 25;
    expect(renderProjectOffers(projectAvailability(s, c), s)).toBe(before);
  });

  it("does not change as Plan progress fills, so offer buttons survive the tick", () => {
    const c = studioProjects();
    const s = initialState(c);
    s.plan = [{ defId: "large-refactor", name: "Large refactor", progress: 0, size: 1000 }];
    const before = renderProjectOffers(projectAvailability(s, c), s);
    s.plan[0]!.progress = 10;
    s.stocks.plan = 10;
    expect(renderProjectOffers(projectAvailability(s, c), s)).toBe(before);
  });
});

describe("projectsPanelScaffold", () => {
  it("provides both patch targets inside one panel", () => {
    const html = projectsPanelScaffold();
    expect(html).toContain(`data-section="${PROJECTS_STATUS_SECTION}"`);
    expect(html).toContain(`data-section="${PROJECTS_OFFERS_SECTION}"`);
    expect(html).toContain('<div class="panel">');
    expect(html).not.toContain("<hr/>");
    expect(html).not.toContain("<hr>");
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

  it("flips the pause button's label to Start when paused", () => {
    const html = renderTimeControls(true, 1, [1, 2, 5]);
    expect(html).toContain(">Start<");
    expect(html).not.toContain(">Pause<");
    expect(html).not.toContain("Resume");
  });

  it("marks Start as the active control while paused so the day-clock start is obvious", () => {
    const html = renderTimeControls(true, 1, [1, 2, 5]);
    expect(html).toContain('class="tc-btn tc-active" id="pause"');
    // Speeds stay dimmed while paused; the selected 1x must not look like Play.
    expect(html).toContain('class="tc-btn" data-speed="1"');
    expect(html).not.toContain('tc-active" data-speed');
  });
});

describe("renderBuildStamp", () => {
  it("renders version, deployed time, and a repo link", () => {
    const html = renderBuildStamp({
      version: "v2026.08.05-12",
      builtAt: "2026-08-05T20:15:30.000Z",
      repoUrl: "https://github.com/anne-markis/software-factory-the-game",
    });
    expect(html).toContain('class="build-stamp"');
    expect(html).toContain("v2026.08.05-12");
    expect(html).toContain("deployed 2026-08-05 20:15:30 UTC");
    expect(html).toContain('href="https://github.com/anne-markis/software-factory-the-game"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">source<");
  });

  it("escapes untrusted characters in version and URL", () => {
    const html = renderBuildStamp({
      version: '<script>x</script>',
      builtAt: "2026-01-01T00:00:00.000Z",
      repoUrl: 'https://example.com/"onclick="alert(1)',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
  });
});

describe("renderStall", () => {
  it("renders the banner only when stalled", () => {
    expect(renderStall(true)).toContain("Stalled.");
    expect(renderStall(false)).toBe("");
  });

  it("renders the insolvency banner when delivery is frozen and the pipeline is not stalled", () => {
    const html = renderStall(false, true);
    expect(html).toContain("Insolvent.");
    expect(html).not.toContain("frozen");
    expect(html).not.toContain("nothing affordable");
  });

  it("keeps the empty-pipeline stall copy when both flags are set", () => {
    const html = renderStall(true, true);
    expect(html).toContain("Stalled.");
    expect(html).not.toContain("nothing affordable");
    expect(html).not.toContain("Insolvent.");
  });
});
