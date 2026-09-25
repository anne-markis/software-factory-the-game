// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cockpitStatViews,
  createFlashController,
  DAYS_PER_YEAR,
  deliveryStatViews,
  formatDayWithYears,
  GAMBLE_REVEAL_MS,
  renderGambleReveal,
  STAT_FLASH_COOLDOWN_MS,
  syncStatRow,
} from "./gameFeel";
import { initialState } from "../engine/engine";
import { parseStartConfig, parseDecisions, parseProjects } from "../engine/content";
import { decisionsJson, projectsJson, startJson } from "../engine/loadShippedContent";
import type { GameContent } from "../engine/types";

function makeContent(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: [],
    projects: parseProjects(projectsJson),
  };
}

describe("gameFeel stat flash", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks material value changes with stat-flash and skips Day", () => {
    const content = makeContent();
    const state = initialState(content);
    const root = document.createElement("div");
    const flash = createFlashController(() => 0);

    syncStatRow(root, "stats", cockpitStatViews(state, content), flash);
    const dayBefore = root.querySelector(".v-day")!;
    const backlogBefore = root.querySelector(".v-flow")!;
    expect(dayBefore.classList.contains("stat-flash")).toBe(false);
    expect(backlogBefore.classList.contains("stat-flash")).toBe(false);

    state.day = 1;
    state.stocks.backlog = state.stocks.backlog + 5;
    syncStatRow(root, "stats", cockpitStatViews(state, content), flash);

    expect(root.querySelector(".v-day")!.classList.contains("stat-flash")).toBe(false);
    expect(root.querySelector(".v-flow")!.classList.contains("stat-flash")).toBe(true);
    // In-place: same value node survives the update.
    expect(root.querySelector(".v-flow")).toBe(backlogBefore);
    expect(root.querySelector(".v-day")).toBe(dayBefore);
  });

  it("does not restroke the same label during the cooldown window", () => {
    const content = makeContent();
    const state = initialState(content);
    const root = document.createElement("div");
    let now = 0;
    const flash = createFlashController(() => now);

    syncStatRow(root, "stats", cockpitStatViews(state, content), flash);
    state.stocks.backlog += 1;
    syncStatRow(root, "stats", cockpitStatViews(state, content), flash);
    const valueEl = root.querySelector(".v-flow")!;
    expect(valueEl.classList.contains("stat-flash")).toBe(true);
    valueEl.classList.remove("stat-flash");

    now = STAT_FLASH_COOLDOWN_MS - 1;
    state.stocks.backlog += 1;
    syncStatRow(root, "stats", cockpitStatViews(state, content), flash);
    expect(root.querySelector(".v-flow")!.classList.contains("stat-flash")).toBe(false);

    now = STAT_FLASH_COOLDOWN_MS;
    state.stocks.backlog += 1;
    syncStatRow(root, "stats", cockpitStatViews(state, content), flash);
    expect(root.querySelector(".v-flow")!.classList.contains("stat-flash")).toBe(true);
  });

  it("appends a calendar-year reading to Day", () => {
    expect(DAYS_PER_YEAR).toBe(365);
    expect(formatDayWithYears(0)).toBe("0 (0 years)");
    expect(formatDayWithYears(10)).toBe("10 (0 years)");
    expect(formatDayWithYears(182)).toBe("182 (0.5 years)");
    expect(formatDayWithYears(365)).toBe("365 (1 year)");
    expect(formatDayWithYears(730)).toBe("730 (2 years)");
    expect(formatDayWithYears(2000)).toBe("2000 (5.5 years)");

    const content = makeContent();
    const state = initialState(content);
    state.day = 365;
    const day = cockpitStatViews(state, content).find((v) => v.stat === "day")!;
    expect(day.label).toBe("Day");
    expect(day.value).toBe("365 (1 year)");
    expect(day.material).toBe(false);
  });

  it("does not put Era in the cockpit stats bar", () => {
    const content = makeContent();
    const views = cockpitStatViews(initialState(content), content);
    expect(views.map((v) => v.label)).toEqual(["Day", "Backlog", "Budget", "Points/Day", "Idea→Value"]);
  });

  it("shows Idea→Value as ~Nd from Plan sizes and unshipped work", () => {
    const content = makeContent();
    const state = initialState(content);
    state.pointsPerDay = 10;
    state.stocks.ideas = 10000;
    state.plan = [{ defId: "ship-v1", name: "Ship v1", progress: 10, size: 400 }];
    // initialState seeds 300 in Ready; keep that so the assertion is explicit.
    expect(state.stocks.backlog).toBe(300);
    const eta = cockpitStatViews(state, content).find((v) => v.label === "Idea→Value")!;
    // 400 + 300 = 700 / 10 → ~70d. Ideas and the 10 points of fill stay out.
    expect(eta.value).toBe("~70d");
    expect(eta.stat).toBe("ideaToValue");
    expect(eta.widthClass).toBe("v-eta");
    expect(eta.material).toBe(true);
  });

  it("shows Idea→Value as an em dash when Points/Day is 0", () => {
    const content = makeContent();
    const state = initialState(content);
    const eta = cockpitStatViews(state, content).find((v) => v.label === "Idea→Value")!;
    expect(eta.value).toBe("—");
  });

  it("cockpit Backlog is unshipped work, not the Ready-stage stock (ADR 0009)", () => {
    const content = makeContent();
    const state = initialState(content);
    const atStart = cockpitStatViews(state, content).find((v) => v.label === "Backlog")!;
    expect(atStart.value).toBe("300");
    // Pull moves 50 pts into In Progress: Ready-stage stock drops, unshipped does not.
    state.stocks.backlog -= 50;
    state.stocks.inProgress += 50;
    const afterPull = cockpitStatViews(state, content).find((v) => v.label === "Backlog")!;
    expect(afterPull.value).toBe("300");
    // Shipping 10 pts is what burns the hero Backlog down.
    state.stocks.done = 0;
    state.stocks.inProgress -= 10;
    state.stocks.shipped += 10;
    const afterShip = cockpitStatViews(state, content).find((v) => v.label === "Backlog")!;
    expect(afterShip.value).toBe("290");
  });

  it("includes a Users delivery stat after Reputation (Studio spine)", () => {
    const content = makeContent();
    const state = initialState(content);
    const views = deliveryStatViews(state);
    const labels = views.map((v) => v.label);
    expect(labels).toEqual(["In Progress", "In Review", "Done", "Shipped", "Tech Debt", "Reputation", "Users", "Ideas"]);
    const users = views.find((v) => v.label === "Users")!;
    expect(users.value).toBe("0"); // starts at 0 until the beta completes
    expect(users.widthClass).toBe("v-users");
    const debt = views.find((v) => v.label === "Tech Debt")!;
    expect(debt.value).toBe("0");
    expect(debt.valueClass).toBeUndefined();
    const rate = cockpitStatViews(state, content).find((v) => v.label === "Points/Day")!;
    expect(rate.value).toBe("0");
    expect(rate.valueClass).toBeUndefined();
    // A material change to users flashes in place like the other stats.
    const root = document.createElement("div");
    const flash = createFlashController(() => 0);
    syncStatRow(root, "delivery-stats", deliveryStatViews(state), flash);
    state.stocks.users = 30;
    syncStatRow(root, "delivery-stats", deliveryStatViews(state), flash);
    expect(root.querySelector(".v-users")!.classList.contains("stat-flash")).toBe(true);
  });

  it("includes an Ideas delivery stat after Users, seeded at 100", () => {
    const content = makeContent();
    const state = initialState(content);
    const views = deliveryStatViews(state);
    const ideas = views.find((v) => v.label === "Ideas")!;
    expect(ideas.value).toBe("100");
    expect(ideas.widthClass).toBe("v-ideas");
    const root = document.createElement("div");
    const flash = createFlashController(() => 0);
    syncStatRow(root, "delivery-stats", deliveryStatViews(state), flash);
    state.stocks.ideas = 105;
    syncStatRow(root, "delivery-stats", deliveryStatViews(state), flash);
    expect(root.querySelector(".v-ideas")!.classList.contains("stat-flash")).toBe(true);
  });

  it("flashes delivery-stat material changes in place", () => {
    const content = makeContent();
    const state = initialState(content);
    const root = document.createElement("div");
    const flash = createFlashController(() => 0);
    syncStatRow(root, "delivery-stats", deliveryStatViews(state), flash);
    const shipped = root.querySelector(".v-flow")!;
    state.stocks.reputation += 1;
    syncStatRow(root, "delivery-stats", deliveryStatViews(state), flash);
    expect(root.querySelector(".v-rep")!.classList.contains("stat-flash")).toBe(true);
    expect(root.querySelector(".v-flow")).toBe(shipped);
  });

  it("puts live drag on Points/Day and only colors Tech Debt", () => {
    const content = makeContent();
    const state = initialState(content);
    state.stocks.techDebt = 1400;
    state.pointsPerDay = 1.7;
    const rate = cockpitStatViews(state, content).find((v) => v.label === "Points/Day")!;
    expect(rate.value).toBe("1.7 (-15%)");
    expect(rate.valueClass).toBe("debt-warn");
    const debt = deliveryStatViews(state).find((v) => v.label === "Tech Debt")!;
    expect(debt.value).toBe("1,400");
    expect(debt.valueClass).toBe("debt-warn");
  });
});

describe("gameFeel gamble reveal", () => {
  it("renders a status line with decision name and outcome", () => {
    const html = renderGambleReveal({
      decisionName: "Hire basic developer",
      outcomeLabel: "Strong hire",
    });
    expect(html).toContain('class="gamble-reveal"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Hire basic developer");
    expect(html).toContain("Strong hire");
    expect(html).toContain("gamble-reveal-outcome");
  });

  it("renders nothing when idle", () => {
    expect(renderGambleReveal(null)).toBe("");
  });

  it("escapes HTML in reveal copy", () => {
    const html = renderGambleReveal({
      decisionName: '<script>x</script>',
      outcomeLabel: 'a & b',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b");
  });

  it("exposes a multi-second reveal window constant", () => {
    expect(GAMBLE_REVEAL_MS).toBeGreaterThanOrEqual(3000);
    expect(GAMBLE_REVEAL_MS).toBeLessThanOrEqual(8000);
  });
});
