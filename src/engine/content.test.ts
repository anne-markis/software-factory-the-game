import { describe, it, expect } from "vitest";
import { parseStartConfig, parseDecisions, parseChallenges, parseProjects, validateContentGraph } from "./content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import challengesJson from "../../content/challenges.json";
import projectsJson from "../../content/projects.json";
import type { GameContent } from "./types";

describe("parseStartConfig", () => {
  it("parses the shipped start.json", () => {
    const cfg = parseStartConfig(startJson);
    expect(cfg.stocks.backlog).toBe(1500);
    expect(cfg.stocks.budget).toBe(10000);
    expect(cfg.debtMultiplier).toBe(0.5);
    expect(cfg.baseRates.pull).toBe(1);
    expect(cfg.challengeSpacingDays).toBe(50);
  });

  it("names the file in validation errors", () => {
    expect(() => parseStartConfig({ nope: true })).toThrow(/content\/start\.json/);
  });

  it("rejects contextSwitchFactor above 1", () => {
    expect(() => parseStartConfig({ ...startJson, contextSwitchFactor: 1.5 })).toThrow(/content\/start\.json/);
  });

  it("rejects negative debtMultiplier", () => {
    expect(() => parseStartConfig({ ...startJson, debtMultiplier: -1 })).toThrow(/content\/start\.json/);
  });

  it("rejects unknown top-level keys", () => {
    expect(() => parseStartConfig({ ...startJson, typoKey: 1 })).toThrow(/content\/start\.json/);
  });
});

describe("parseDecisions", () => {
  it("parses the shipped decisions.json", () => {
    const defs = parseDecisions(decisionsJson);
    const ids = defs.map((d) => d.id);
    expect(ids).toEqual([
      "test-suite",
      "ci-cd",
      "basic-dev",
      "agent",
      "agent-harness",
      "better-tooling",
      "copilot",
      "senior-dev",
      "contractor",
      "eng-manager",
      "standup",
      "agent-swarm",
      "swarm-orchestrator",
      "self-learning-agents",
      "support-retainer",
      "ddos-protection",
    ]);
    const dev = defs.find((d) => d.id === "basic-dev")!;
    expect(dev.cost.perDay).toBe(7);
    expect(dev.gamble!.reduce((sum, o) => sum + o.probability, 0)).toBeCloseTo(1);
  });

  it("pins the content-wave decision values", () => {
    const defs = parseDecisions(decisionsJson);
    // senior-dev: base and manager-tightened gamble tables both sum to 1
    const senior = defs.find((d) => d.id === "senior-dev")!;
    expect(senior.gamble!.map((o) => o.probability)).toEqual([0.4, 0.3, 0.2, 0.1]);
    expect(senior.gamble!.reduce((sum, o) => sum + o.probability, 0)).toBeCloseTo(1);
    expect(senior.synergies![0].ifOwned).toBe("eng-manager");
    expect(senior.synergies![0].gamble!.reduce((sum, o) => sum + o.probability, 0)).toBeCloseTo(1);
    // basic-dev gained a manager synergy with a full restated table summing to 1
    const dev = defs.find((d) => d.id === "basic-dev")!;
    expect(dev.synergies![0].ifOwned).toBe("eng-manager");
    expect(dev.synergies![0].gamble!.map((o) => o.probability)).toEqual([0.55, 0.3, 0.13, 0.02]);
    // support-retainer is the first content use of incomePerDay
    const retainer = defs.find((d) => d.id === "support-retainer")!;
    expect(retainer.incomePerDay).toBe(8);
    expect(retainer.cost.oneTime).toBeUndefined();
    // self-learning-agents ramps the whole pipeline (Task 6 balance: a
    // finish-only ramp left automation builds pull/deploy-bound at ~1 pt/day
    // and structurally insolvent; per-rate cap 1.4 keeps the matured build
    // from overwhelming the human track)
    const sla = defs.find((d) => d.id === "self-learning-agents")!;
    expect(sla.effects).toEqual([
      { type: "rampRate", target: "pull", perDay: 0.02, cap: 1.4 },
      { type: "rampRate", target: "finish", perDay: 0.02, cap: 1.4 },
      { type: "rampRate", target: "deploy", perDay: 0.02, cap: 1.4 },
    ]);
    // agent-swarm's synergy forward-references swarm-orchestrator, which
    // appears later in the array; parseDecisions collects ids first, so the
    // shipped file must parse with the reference intact
    const swarm = defs.find((d) => d.id === "agent-swarm")!;
    expect(swarm.synergies![0].ifOwned).toBe("swarm-orchestrator");
  });

  it("rejects a gamble table whose probabilities do not sum to 1", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", tags: [], cost: {}, effects: [], removable: true,
          gamble: [{ probability: 0.5, label: "a", effects: [] }],
        },
      ]),
    ).toThrow(/gamble for "x" sums to 0.5/);
  });

  it("rejects a requires reference to an unknown decision id", () => {
    expect(() =>
      parseDecisions([
        { id: "x", name: "x", description: "x", tags: [], cost: {}, effects: [], removable: true, requires: ["ghost"] },
      ]),
    ).toThrow(/ghost/);
  });

  it("rejects duplicate decision ids", () => {
    expect(() =>
      parseDecisions([
        { id: "x", name: "x", description: "x", tags: [], cost: {}, effects: [], removable: true },
        { id: "x", name: "x2", description: "x2", tags: [], cost: {}, effects: [], removable: true },
      ]),
    ).toThrow(/duplicate/i);
  });

  it("parses a valid rampRate effect targeting a single rate", () => {
    const defs = parseDecisions([
      {
        id: "x", name: "x", description: "x", tags: [], cost: {}, removable: true,
        effects: [{ type: "rampRate", target: "finish", perDay: 0.1, cap: 2 }],
      },
    ]);
    expect(defs[0].effects[0]).toEqual({ type: "rampRate", target: "finish", perDay: 0.1, cap: 2 });
  });

  it("rejects a rampRate effect targeting \"all\" (a ramp targets exactly one rate)", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", tags: [], cost: {}, removable: true,
          effects: [{ type: "rampRate", target: "all", perDay: 0.1, cap: 1 }],
        },
      ]),
    ).toThrow(/content\/decisions\.json/);
  });

  it("rejects a rampRate effect with a negative perDay", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", tags: [], cost: {}, removable: true,
          effects: [{ type: "rampRate", target: "finish", perDay: -0.1, cap: 1 }],
        },
      ]),
    ).toThrow(/content\/decisions\.json/);
  });
});

describe("parseChallenges", () => {
  it("parses the shipped challenges.json", () => {
    const defs = parseChallenges(challengesJson);
    const ids = defs.map((c) => c.id);
    expect(ids).toContain("sickness");
    expect(ids).toContain("ddos");
    const poached = defs.find((c) => c.id === "key-dev-poached")!;
    expect(poached.choice!.options.map((o) => o.id)).toContain(poached.choice!.defaultOptionId);
    const sickness = defs.find((c) => c.id === "sickness")!;
    expect(sickness.probabilityPerDay).toBe(0.1);
    expect(sickness.perHumanDev).toBe(true);
    const incident = defs.find((c) => c.id === "prod-incident")!;
    expect(incident.probScaling).toEqual({ stat: "techDebt", per: 500, add: 0.01 });
  });

  it("pins the content-wave challenge values", () => {
    const defs = parseChallenges(challengesJson);
    const ids = defs.map((c) => c.id);
    expect(ids).toEqual([
      "sickness", "ddos", "scope-creep", "prod-incident", "laptop-dies", "key-dev-poached",
      "model-deprecation", "api-price-hike", "runaway-agent-loop", "meeting-creep", "team-conflict",
      "cloud-credits", "open-source-windfall",
    ]);

    const deprecation = defs.find((c) => c.id === "model-deprecation")!;
    expect(deprecation.condition).toEqual({ hasTag: "darkfactory" });
    expect(deprecation.cooldownDays).toBe(90);
    const defaultOption = deprecation.choice!.options.find((o) => o.id === deprecation.choice!.defaultOptionId);
    expect(defaultOption).toBeDefined();
    expect(defaultOption!.id).toBe("pay-migration");

    const windfall = defs.find((c) => c.id === "open-source-windfall")!;
    const windfallEffect = windfall.effects.find((e) => e.type === "addToStock")!;
    expect(windfallEffect).toMatchObject({ stock: "budget", value: 400 });
    expect(windfallEffect.value).toBeGreaterThan(0);

    const poached = defs.find((c) => c.id === "key-dev-poached")!;
    expect(poached.cooldownDays).toBe(60);
  });

  it("pins the mobile-app project gate", () => {
    const defs = parseProjects(projectsJson);
    const mobileApp = defs.find((p) => p.id === "mobile-app")!;
    expect(mobileApp).toMatchObject({
      name: "Mobile app build",
      sizePoints: 9000,
      upfrontCost: 3000,
      payoutPerPoint: 22,
      completionBonus: 4000,
      requiresCompleted: 1,
    });
  });

  it("rejects a choice challenge with top-level effects", () => {
    expect(() =>
      parseChallenges([
        {
          id: "bad", name: "bad", description: "bad", probabilityPerDay: 0.1,
          effects: [{ type: "addToStock", stock: "budget", value: -1 }],
          choice: { expiresInDays: 3, defaultOptionId: "a", options: [{ id: "a", label: "a", effects: [] }] },
        },
      ]),
    ).toThrow(/silently ignored/);
  });

  it("rejects a sickness effect without perHumanDev", () => {
    expect(() =>
      parseChallenges([
        {
          id: "bad", name: "bad", description: "bad", probabilityPerDay: 0.1,
          effects: [{ type: "sickness", factor: 0.7, durationDays: 5 }],
        },
      ]),
    ).toThrow(/perHumanDev/);
  });

  it("rejects a choice whose default option id does not exist", () => {
    expect(() =>
      parseChallenges([
        {
          id: "bad", name: "bad", description: "bad", probabilityPerDay: 0.1, effects: [],
          choice: { expiresInDays: 3, defaultOptionId: "ghost", options: [{ id: "a", label: "a", effects: [] }] },
        },
      ]),
    ).toThrow(/ghost/);
  });

  it("rejects duplicate challenge ids", () => {
    expect(() =>
      parseChallenges([
        { id: "x", name: "x", description: "x", probabilityPerDay: 0.1, effects: [] },
        { id: "x", name: "x2", description: "x2", probabilityPerDay: 0.1, effects: [] },
      ]),
    ).toThrow(/duplicate/i);
  });

  it("parses a lacksDecision condition", () => {
    const defs = parseChallenges([
      {
        id: "x", name: "x", description: "x", probabilityPerDay: 0.1, effects: [],
        condition: { lacksDecision: "agent" },
      },
    ]);
    expect(defs[0].condition).toEqual({ lacksDecision: "agent" });
  });
});

describe("validateContentGraph", () => {
  it("passes for the shipped content (every lacksDecision reference is a real decision id)", () => {
    const content: GameContent = {
      start: parseStartConfig(startJson),
      decisions: parseDecisions(decisionsJson),
      challenges: parseChallenges(challengesJson),
      projects: parseProjects(projectsJson),
    };
    expect(() => validateContentGraph(content)).not.toThrow();
  });

  it("throws, naming the challenge and the file, for a lacksDecision referencing an unknown decision id", () => {
    const content: GameContent = {
      start: parseStartConfig(startJson),
      decisions: parseDecisions(decisionsJson),
      challenges: parseChallenges([
        {
          id: "ghost-check", name: "Ghost Check", description: "d", probabilityPerDay: 0.1, effects: [],
          condition: { lacksDecision: "no-such-decision" },
        },
      ]),
      projects: [],
    };
    expect(() => validateContentGraph(content)).toThrow(/ghost-check/);
    expect(() => validateContentGraph(content)).toThrow(/content\/challenges\.json/);
    expect(() => validateContentGraph(content)).toThrow(/no-such-decision/);
  });
});
