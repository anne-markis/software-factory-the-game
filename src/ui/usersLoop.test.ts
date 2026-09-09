import { describe, expect, it } from "vitest";
import { Engine, initialState } from "../engine/engine";
import { parseStartConfig, parseDecisions } from "../engine/content";
import { decisionsJson, startJson } from "../engine/loadShippedContent";
import type { GameContent, GameState } from "../engine/types";
import { usersLoopSvg } from "./usersLoop";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("usersLoopSvg", () => {
  it("renders the users feedback loop with realized flows and no teaching caption", () => {
    const c = content();
    const state = initialState(c);
    const svg = usersLoopSvg(state, c);
    expect(svg).toContain("Reputation");
    expect(svg).toContain("Users");
    expect(svg).toContain("User income");
    expect(svg).toContain("churn");
    expect(svg).toContain('aria-label="User loop"');
    expect(svg).not.toMatch(/until launch/i);
    expect(svg).not.toMatch(/monetize/i);
    expect(svg).not.toContain("acquire");
  });

  it("shows rates, churn, and subscription income after launch", () => {
    const c = content();
    const e = new Engine(c);
    const s = e.getState() as GameState;
    s.completedProjects = 1;
    s.stocks.users = 40;
    s.stocks.reputation = 1;
    e.applyDecision("subscription");
    e.tick();
    const svg = usersLoopSvg(e.getState(), c);
    expect(svg).toMatch(/1\.\d\/day/); // acquire rate on the arrow
    // Flows run before income: 40 users + 1.6 acquire - 0.4 churn = 41.2, then $0.75 each.
    expect(svg).toContain("$30.9");
    expect(svg).toMatch(/−\d+%/);
    expect(svg).not.toMatch(/support drag/);
    expect(svg).not.toMatch(/free band/);
  });

  it("stays at zero income before users exist", () => {
    const c = content();
    const svg = usersLoopSvg(initialState(c), c);
    expect(svg).toContain(">0<");
    expect(svg).toContain("$0.0");
  });
});
