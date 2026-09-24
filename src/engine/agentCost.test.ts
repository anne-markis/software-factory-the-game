import { describe, expect, it } from "vitest";
import { agentSeatCount, scaledDecisionCost } from "./agentCost";
import { parseDecisions, parseStartConfig } from "./content";
import { Engine } from "./engine";
import { decisionsJson, startJson } from "./loadShippedContent";
import type { GameContent, GameState } from "./types";
import { activateDueInstances } from "./tick";

function content(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: [],
    projects: [],
  };
}

function activateHires(engine: Engine, c: GameContent): void {
  const state = engine.getState() as GameState;
  for (const inst of state.decisions) {
    if (inst.activeOnDay !== undefined && inst.activeOnDay > state.day) inst.activeOnDay = state.day;
  }
  activateDueInstances(state, c);
}

describe("coding agent cost per human", () => {
  it("bills the founder alone at the authored rate", () => {
    const c = content();
    const agent = c.decisions.find((d) => d.id === "agent")!;
    const e = new Engine(c);
    expect(agentSeatCount(e.getState())).toBe(1);
    expect(scaledDecisionCost(agent, 1, "perDay")).toBe(4);
    expect(scaledDecisionCost(agent, 1, "oneTime")).toBe(10);
    const before = e.getState().stocks.budget;
    e.applyDecision("agent");
    expect(e.getState().stocks.budget).toBe(before - 10);
  });

  it("multiplies setup and daily cost by founder plus active hires", () => {
    const c = content();
    const e = new Engine(c);
    e.applyDecision("basic-dev");
    activateHires(e, c);
    expect(agentSeatCount(e.getState())).toBe(2);
    const before = e.getState().stocks.budget;
    e.applyDecision("agent");
    expect(e.getState().stocks.budget).toBe(before - 20);
    e.tick();
    // No permanent KTLO project. The hire still adds $35 ktloPerDay beside $438 payroll and the agent's $8.
    expect(e.getState().expensesByDay.at(-1)).toMatchObject({ human: 438, agents: 8, ktlo: 35 });
    expect(e.getState().stocks.budget).toBe(before - 20 - 438 - 8 - 35);
  });

  it("ignores a hire until they start, then raises agent payroll", () => {
    const c = content();
    const e = new Engine(c);
    e.applyDecision("agent");
    e.applyDecision("basic-dev");
    e.tick();
    expect(e.getState().expensesByDay.at(-1)?.agents).toBe(4);
    activateHires(e, c);
    e.tick();
    expect(e.getState().expensesByDay.at(-1)?.agents).toBe(8);
  });

  it("charges the day's agent bill from the roster at the start of payroll", () => {
    const c = content();
    const e = new Engine(c);
    e.applyDecision("basic-dev");
    activateHires(e, c);
    e.applyDecision("agent");
    const state = e.getState() as GameState;
    // After the zero KTLO step, $6 remains. The hire's $438 fails first.
    // The agent was priced for two seats ($8) before that removal, so it
    // fails too instead of dropping to the founder's $4.
    state.stocks.budget = 6;
    e.tick();
    expect(state.decisions.some((d) => d.defId === "basic-dev")).toBe(false);
    expect(state.decisions.some((d) => d.defId === "agent")).toBe(false);
  });

  it("leaves shared ladder cards at one bill", () => {
    const c = content();
    const harness = c.decisions.find((d) => d.id === "agent-harness")!;
    expect(harness.agent).toBeUndefined();
    expect(scaledDecisionCost(harness, 4, "perDay")).toBe(5);
  });
});
