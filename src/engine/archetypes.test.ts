import { describe, it, expect } from "vitest";
import { detectArchetypes } from "./archetypes";
import { initialState } from "./engine";
import { applyDecision } from "./decisions";
import { createRng } from "./rng";
import { parseStartConfig, parseDecisions } from "./content";
import { decisionsJson, startJson } from "./loadShippedContent";
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
    // Two debt-raising instances -- since the stacking agent card is
    // the shop's debt raiser, and each copy adds +0.1 to the multiplier. No
    // debt-lowering decision owned, techDebt past freeDebt (400).
    s.decisions.push({ instanceId: "i-agent", defId: "agent" }, { instanceId: "i-agent-2", defId: "agent" });
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
      { instanceId: "i-agent-2", defId: "agent" },
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
    s.decisions.push({ instanceId: "i-agent", defId: "agent" }, { instanceId: "i-agent-2", defId: "agent" });
    s.stocks.techDebt = 300; // below freeDebt 400
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });

  // Studio content ships no synergies since (the agent/harness synergy became a pair of global multipliers), so the per-instance synergy
  // accounting from is pinned against a fixture: "worker" raises debt,
  // and only a worker bought while "provider" was owned got the cut variant.
  // Provider itself has no debt effect of its own.
  function synergyContent(): GameContent {
    const worker: DecisionDef = {
      id: "worker", name: "Worker", description: "d", category: "ship-faster", cost: {}, removable: true,
      effects: [{ type: "modifyDebtMultiplier", op: "mul", value: 1.2 }],
      synergies: [{ ifOwned: "provider", effects: [{ type: "modifyDebtMultiplier", op: "mul", value: 1.1 }] }],
    };
    const provider: DecisionDef = {
      id: "provider", name: "Provider", description: "d", category: "tame-debt", cost: {}, removable: true,
      effects: [], unique: true,
    };
    return { start: parseStartConfig(startJson), decisions: [worker, provider], challenges: [], projects: [] };
  }

  it("still fires shifting-the-burden when a synergy provider is owned but no instance was bought under it", () => {
    const c = synergyContent();
    const s = initialState(c);
    s.decisions.push(
      { instanceId: "i-worker", defId: "worker" },
      { instanceId: "i-worker-2", defId: "worker" },
      { instanceId: "i-provider", defId: "provider" },
    );
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).toContain("shifting-the-burden");
    expect(messages.some((m) => m.startsWith("Shifting the burden"))).toBe(true);
  });

  it("does not fire shifting-the-burden once an instance was actually bought under a debt-lowering synergy", () => {
    const c = synergyContent();
    const s = initialState(c);
    s.decisions.push(
      { instanceId: "i-worker", defId: "worker" },
      { instanceId: "i-provider", defId: "provider" },
      { instanceId: "i-worker-2", defId: "worker", appliedSynergyIfOwned: "provider" },
    );
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });

  it("fires shifting-the-burden through real purchases of stacked agents", () => {
    // End-to-end through applyDecision rather than hand-built instances: two
    // agents and nothing that tames them is the shape the archetype is about.
    const c = content();
    const s = initialState(c);
    const rng = createRng(c.start.seed);
    applyDecision(s, c, "agent", rng);
    applyDecision(s, c, "agent", rng);
    expect(s.decisions.every((d) => d.appliedSynergyIfOwned === undefined)).toBe(true);
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).toContain("shifting-the-burden");
    expect(messages.some((m) => m.startsWith("Shifting the burden"))).toBe(true);
  });

  it("suppresses shifting-the-burden once the harness is bought, whenever the agents were", () => {
    // The harness now cuts debt through its own effects (mul 0.7) rather than
    // through a purchase-time synergy on the agent, so it mitigates every
    // agent -- including the ones bought before it, which the old synergy
    // shape left permanently untamed.
    const c = content();
    const s = initialState(c);
    const rng = createRng(c.start.seed);
    applyDecision(s, c, "agent", rng);
    applyDecision(s, c, "agent", rng);
    applyDecision(s, c, "agent-harness", rng);
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

  it("treats a scaleStock-on-techDebt decision (factor < 1) as a debt-lowerer (Release 16)", () => {
    // Same shape as the test-suite case, but via the scaleStock effect instead
    // of modifyDebtMultiplier: owning it should suppress shifting-the-burden
    // even with 2+ raisers owned and debt past the band. Fixture-based since
    // the refactor/rebuild pair left Studio.
    const raiser: DecisionDef = {
      id: "raiser", name: "Raiser", description: "d", category: "ship-faster", cost: {}, removable: true,
      effects: [{ type: "modifyDebtMultiplier", op: "add", value: 0.1 }],
    };
    const sprint: DecisionDef = {
      id: "sprint", name: "Sprint", description: "d", category: "tame-debt", cost: {}, removable: true,
      effects: [{ type: "scaleStock", stock: "techDebt", factor: 0.7 }],
    };
    const c: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [raiser, sprint],
      challenges: [],
      projects: [],
    };
    const s = initialState(c);
    s.decisions.push(
      { instanceId: "i-raiser", defId: "raiser" },
      { instanceId: "i-raiser-2", defId: "raiser" },
      { instanceId: "i-sprint", defId: "sprint" },
    );
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });

  it("counts an additive debt raiser (op add, value > 0) as a raiser", () => {
    // The stacking agent card raises debt by adding to the multiplier rather
    // than multiplying it. Originally, raisesDebt only looked at mul ops,
    // which would have made the shipped Studio shop archetype-blind.
    const defs = parseDecisions(decisionsJson);
    const agent = defs.find((d) => d.id === "agent")!;
    expect(agent.effects).toContainEqual({ type: "modifyDebtMultiplier", op: "add", value: 0.1 });
    const c = content();
    const s = initialState(c);
    s.decisions.push({ instanceId: "i-a", defId: "agent" }, { instanceId: "i-b", defId: "agent" });
    s.stocks.techDebt = 500;
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    expect(messages.some((m) => m.startsWith("Shifting the burden"))).toBe(true);
  });

  it("does not misclassify a rate-only synergy provider on a debt-raiser as a debt-lowerer (Release 15 review guard)", () => {
    // Fixture: "raiser" multiplies debt above 1 (a debt-raiser, like agent).
    // Its synergy with "rate-only-provider" swaps in a rate-only effects
    // list -- no modifyDebtMultiplier term at all, so it leaves the debt
    // multiplier at the content's base, which reads as "lower than the raiser's
    // own outcome" and would wrongly classify the synergy as debt-mitigating.
    // With the guard, it must not be.
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

  // review: the synergy comparison weighs add-op debt terms too, the
  // same way effectiveDebtMultiplier does (adds first, then muls, from the
  // content's base). Fixture: an additive raiser whose synergy variant adds
  // less. Both variants are add-only, so a mul-only comparison would score them
  // identically and credit no mitigation at all.
  it("counts an additive synergy variant as mitigation when it adds less debt than the base", () => {
    const raiser: DecisionDef = {
      id: "raiser", name: "Raiser", description: "d", category: "ship-faster", cost: {}, removable: true,
      effects: [{ type: "modifyDebtMultiplier", op: "add", value: 0.2 }],
      synergies: [{ ifOwned: "tamer", effects: [{ type: "modifyDebtMultiplier", op: "add", value: 0.05 }] }],
    };
    const tamer: DecisionDef = {
      id: "tamer", name: "Tamer", description: "d", category: "tame-debt", cost: {}, removable: true,
      effects: [], unique: true,
    };
    const c: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [raiser, tamer],
      challenges: [],
      projects: [],
    };
    const s = initialState(c);
    s.decisions.push(
      { instanceId: "i-raiser", defId: "raiser" },
      { instanceId: "i-tamer", defId: "tamer" },
      { instanceId: "i-raiser-2", defId: "raiser", appliedSynergyIfOwned: "tamer" },
    );
    s.stocks.techDebt = 500; // past freeDebt (400)
    const { messages, log } = collect();
    detectArchetypes(s, c, log);
    // One instance was genuinely bought under the cheaper variant, so something
    // is paying the debt down and the archetype must stay quiet.
    expect(s.archetypesSeen).not.toContain("shifting-the-burden");
    expect(messages).toHaveLength(0);
  });
});
