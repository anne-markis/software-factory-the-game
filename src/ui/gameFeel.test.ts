// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cockpitStatViews,
  createFlashController,
  deliveryStatViews,
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

  it("does not put Era in the cockpit stats bar", () => {
    const content = makeContent();
    const views = cockpitStatViews(initialState(content), content);
    expect(views.map((v) => v.label)).toEqual(["Day", "Backlog", "Budget", "Points/Day"]);
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
    expect(labels).toEqual(["In Progress", "Done", "Shipped", "Tech Debt", "Reputation", "Users", "Ideas"]);
    const users = views.find((v) => v.label === "Users")!;
    expect(users.value).toBe("0"); // starts at 0 until the beta completes
    expect(users.widthClass).toBe("v-users");
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
