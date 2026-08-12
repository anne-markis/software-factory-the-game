import { describe, it, expect } from "vitest";
import { detectArchetypes } from "./archetypes";
import { initialState } from "./engine";
import { applyDecision } from "./decisions";
import { createRng } from "./rng";
import { parseStartConfig, parseDecisions } from "./content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import type { DecisionDef, GameContent, GameState } from "./types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

// A capturing log stub matching tick.ts's log signature (state, message).
function collect() {
  const messages: string[] = [];
  const log = (s: GameState, m: string) => {
    s.log.push({ day: s.day, message: m });
    messages.push(m);
  };
  return { messages, log };
}

describe("detectArchetypes", () => {
  it("fires limits-to-growth once when drag passes halfway to its cap", () => {
    // Shipped config: freeDebt 400, dragPerPoint 0.00015, maxDrag 0.4.
    // Threshold is 1 - maxDrag/2 = 0.8. techDebt 2000 -> excess 1600 -> drag
    // 0.24 -> multiplier 0.76 (< 0.8), so it fires; 0.24 rounds to 24%.
    const c = content();
    const s = initialState(c);
    s.stocks.techDebt = 2000;
    const { messages, log } = collect();

    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).toContain("limits-to-growth");
    const line = messages.find((m) => m.startsWith("Limits to growth"))!;
    expect(line).toBeDefined();
    expect(line).toContain("24%");

    // Once-only: a second detection on the same (still-dragging) state logs nothing new.
    const count = messages.length;
    detectArchetypes(s, c, log);
    expect(messages.length).toBe(count);
    expect(s.archetypesSeen.filter((a) => a === "limits-to-growth")).toHaveLength(1);
  });

  it("does not fire limits-to-growth before the halfway-to-cap threshold", () => {
    const c = content();
    const s = initialState(c);
    s.stocks.techDebt = 1000; // excess 600 -> drag 0.09 -> multiplier 0.91 (> 0.8)
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("limits-to-growth");
    expect(messages).toHaveLength(0);
  });

  it("fires shifting-the-burden once when 2+ debt-raisers are owned with no mitigation and debt past the band", () => {
    const c = content();
    const s = initialState(c);
    // Two debt-raising decisions (agent mul 1.2, copilot mul 1.05), no
    // debt-lowering decision, techDebt past freeDebt (400).
    s.decisions.push({ instanceId: "i-agent", defId: "agent" }, { instanceId: "i-copilot", defId: "copilot" });
    s.stocks.techDebt = 500;
    const { messages, log } = collect();

    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).toContain("shifting-the-burden");
    expect(messages.some((m) => m.startsWith("Shifting the burden"))).toBe(true);

    // Once-only.
    const count = messages.length;
    detectArchetypes(s, c, log);
    expect(messages.length).toBe(count);
    expect(s.archetypesSeen.filter((a) => a === "shifting-the-burden")).toHaveLength(1);
  });

  it("does not fire shifting-the-burden while any debt-lowering decision is owned", () => {
    const c = content();
    const s = initialState(c);
    // test-suite is a debt-lowerer (mul 0.5), so the burden is being paid down.
    s.decisions.push(
      { instanceId: "i-agent", defId: "agent" },
      { instanceId: "i-copilot", defId: "copilot" },
      { instanceId: "i-test", defId: "test-suite" },
    );
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });

  it("does not fire shifting-the-burden while debt is still within the grace band", () => {
    const c = content();
    const s = initialState(c);
    s.decisions.push({ instanceId: "i-agent", defId: "agent" }, { instanceId: "i-copilot", defId: "copilot" });
    s.stocks.techDebt = 300; // below freeDebt 400
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });

  it("still fires shifting-the-burden when a synergy provider is owned but no instance was bought under it (issue #14)", () => {
    // agent-harness requires agent, so the agent bought before it can never
    // have gotten the harness synergy -- its debt mul stayed at the base 1.2.
    // Owning the harness (which has no debt effect of its own) must therefore
    // not read as mitigation: nothing has paid the debt down.
    const c = content();
    const s = initialState(c);
    s.decisions.push(
      { instanceId: "i-agent", defId: "agent" },
      { instanceId: "i-swarm", defId: "agent-swarm" },
      { instanceId: "i-harness", defId: "agent-harness" },
    );
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).toContain("shifting-the-burden");
    expect(messages.some((m) => m.startsWith("Shifting the burden"))).toBe(true);
  });

  it("does not fire shifting-the-burden once an instance was actually bought under a debt-lowering synergy", () => {
    // Same build, but the second agent was purchased while the harness was
    // owned, so its recorded synergy really did cut its debt mul (1.2 -> 1.1).
    const c = content();
    const s = initialState(c);
    s.decisions.push(
      { instanceId: "i-agent", defId: "agent" },
      { instanceId: "i-harness", defId: "agent-harness" },
      { instanceId: "i-agent-2", defId: "agent", appliedSynergyIfOwned: "agent-harness" },
    );
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });

  it("does not fire shifting-the-burden for a swarm bought under the orchestrator synergy", () => {
    const c = content();
    const s = initialState(c);
    s.decisions.push(
      { instanceId: "i-agent", defId: "agent" },
      { instanceId: "i-harness", defId: "agent-harness" },
      { instanceId: "i-orch", defId: "swarm-orchestrator" },
      { instanceId: "i-swarm", defId: "agent-swarm", appliedSynergyIfOwned: "swarm-orchestrator" },
    );
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });

  it("fires shifting-the-burden through real purchases in agent -> harness order (issue #14)", () => {
    // End-to-end through applyDecision rather than hand-built instances: the
    // harness cannot be bought before the agent it requires, so no owned
    // instance ever got the debt-lowering synergy.
    const c = content();
    const s = initialState(c);
    const rng = createRng(c.start.seed);
    applyDecision(s, c, "agent", rng);
    applyDecision(s, c, "copilot", rng);
    applyDecision(s, c, "agent-harness", rng);
    expect(s.decisions.every((d) => d.appliedSynergyIfOwned === undefined)).toBe(true);
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).toContain("shifting-the-burden");
    expect(messages.some((m) => m.startsWith("Shifting the burden"))).toBe(true);
  });

  it("suppresses shifting-the-burden once a second agent is bought after the harness (issue #14)", () => {
    const c = content();
    const s = initialState(c);
    const rng = createRng(c.start.seed);
    applyDecision(s, c, "agent", rng);
    applyDecision(s, c, "copilot", rng);
    applyDecision(s, c, "agent-harness", rng);
    applyDecision(s, c, "agent", rng); // bought under the harness synergy
    expect(s.decisions.filter((d) => d.appliedSynergyIfOwned === "agent-harness")).toHaveLength(1);
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });

  it("does not credit a recorded synergy that leaves the decision's debt multiplier alone", () => {
    // Fixture: "provider" swaps in a rate-only variant on raiser (no debt term)
    // and a debt-lowering variant on raiser2. An instance of raiser recorded
    // under provider therefore mitigates nothing, so the archetype still fires
    // -- the per-(decision, provider) classification must not leak across defs.
    const raiser: DecisionDef = {
      id: "raiser", name: "Raiser", description: "d", category: "ship-faster", cost: {}, removable: true,
      effects: [{ type: "modifyDebtMultiplier", op: "mul", value: 1.2 }],
      synergies: [{ ifOwned: "provider", effects: [{ type: "modifyRate", target: "all", op: "mul", value: 1.1 }] }],
    };
    const raiser2: DecisionDef = {
      id: "raiser2", name: "Raiser 2", description: "d", category: "ship-faster", cost: {}, removable: true,
      effects: [{ type: "modifyDebtMultiplier", op: "mul", value: 1.3 }],
      synergies: [{ ifOwned: "provider", effects: [{ type: "modifyDebtMultiplier", op: "mul", value: 1.05 }] }],
    };
    const provider: DecisionDef = {
      id: "provider", name: "Provider", description: "d", category: "ship-faster",
      cost: {}, removable: true, effects: [],
    };
    const c: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [raiser, raiser2, provider],
      challenges: [],
      projects: [],
    };
    const s = initialState(c);
    s.decisions.push(
      { instanceId: "i-raiser", defId: "raiser", appliedSynergyIfOwned: "provider" },
      { instanceId: "i-raiser2", defId: "raiser2" },
      { instanceId: "i-provider", defId: "provider" },
    );
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).toContain("shifting-the-burden");
    expect(messages.some((m) => m.startsWith("Shifting the burden"))).toBe(true);
  });

  it("treats refactoring-sprint (scaleStock on techDebt, factor < 1) as a debt-lowerer (Release 16)", () => {
    // Same shape as the test-suite case, but via the new scaleStock effect
    // instead of modifyDebtMultiplier: owning it should suppress
    // shifting-the-burden even with 2+ raisers owned and debt past the band.
    const c = content();
    const s = initialState(c);
    s.decisions.push(
      { instanceId: "i-agent", defId: "agent" },
      { instanceId: "i-copilot", defId: "copilot" },
      { instanceId: "i-sprint", defId: "refactoring-sprint" },
    );
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });

  it("does not misclassify a rate-only synergy provider on a debt-raiser as a debt-lowerer (Release 15 review guard)", () => {
    // Fixture: "raiser" multiplies debt above 1 (a debt-raiser, like agent).
    // Its synergy with "rate-only-provider" swaps in a rate-only effects
    // list -- no modifyDebtMultiplier term at all. Before the guard,
    // debtMulProduct's no-matching-terms fallback of 1 reads as "lower than
    // the raiser's baseDebt (1.2)", so the synergy would be wrongly
    // classified as debt-mitigating. With the guard, it must not be.
    const raiser: DecisionDef = {
      id: "raiser", name: "Raiser", description: "d", category: "ship-faster", cost: {}, removable: true,
      effects: [{ type: "modifyDebtMultiplier", op: "mul", value: 1.2 }],
      synergies: [
        {
          ifOwned: "rate-only-provider",
          effects: [{ type: "modifyRate", target: "all", op: "mul", value: 1.1 }],
        },
      ],
    };
    const raiser2: DecisionDef = {
      id: "raiser2", name: "Raiser 2", description: "d", category: "ship-faster", cost: {}, removable: true,
      effects: [{ type: "modifyDebtMultiplier", op: "mul", value: 1.3 }],
    };
    const rateOnlyProvider: DecisionDef = {
      id: "rate-only-provider", name: "Rate only provider", description: "d", category: "ship-faster",
      cost: {}, removable: true, effects: [{ type: "modifyRate", target: "all", op: "mul", value: 1.05 }],
    };
    const c: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [raiser, raiser2, rateOnlyProvider],
      challenges: [],
      projects: [],
    };
    const s = initialState(c);
    s.decisions.push(
      { instanceId: "i-raiser", defId: "raiser" },
      { instanceId: "i-raiser2", defId: "raiser2" },
      { instanceId: "i-provider", defId: "rate-only-provider" },
    );
    s.stocks.techDebt = 500; // past freeDebt (400)
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    // The provider must NOT be classified as a lowerer, so with 2 raisers
    // owned and zero real mitigation, shifting-the-burden still fires.
    expect(s.archetypesSeen).toContain("shifting-the-burden");
    expect(messages.some((m) => m.startsWith("Shifting the burden"))).toBe(true);
  });
});
