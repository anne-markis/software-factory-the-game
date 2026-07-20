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

  it("parses the Release 15 debtDrag config", () => {
    const cfg = parseStartConfig(startJson);
    expect(cfg.debtDrag).toEqual({ freeDebt: 400, dragPerPoint: 0.00015, maxDrag: 0.4 });
  });

  it("rejects a debtDrag with maxDrag at or above 1", () => {
    expect(() =>
      parseStartConfig({ ...startJson, debtDrag: { freeDebt: 200, dragPerPoint: 0.0004, maxDrag: 1 } }),
    ).toThrow(/content\/start\.json/);
  });

  it("rejects a debtDrag with a non-positive dragPerPoint", () => {
    expect(() =>
      parseStartConfig({ ...startJson, debtDrag: { freeDebt: 200, dragPerPoint: 0, maxDrag: 0.5 } }),
    ).toThrow(/content\/start\.json/);
  });

  it("rejects a debtDrag with an unknown key (strict schema)", () => {
    expect(() =>
      parseStartConfig({ ...startJson, debtDrag: { freeDebt: 200, dragPerPoint: 0.0004, maxDrag: 0.5, typo: 1 } }),
    ).toThrow(/content\/start\.json/);
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
    // Release 13: every shipped decision must carry a required category so
    // the shop can group them into sections.
    expect(defs.every((d) => d.category)).toBe(true);
  });

  it("categorizes every shipped decision for the shop's sectioned layout (Release 13)", () => {
    const defs = parseDecisions(decisionsJson);
    expect(defs.find((d) => d.id === "test-suite")!.category).toBe("tame-debt");
    expect(defs.find((d) => d.id === "support-retainer")!.category).toBe("earn-income");
    expect(defs.find((d) => d.id === "ci-cd")!.category).toBe("change-structure");
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
    // Release 11: ci-cd's permanent deploy speedup (modifyRate mul 1.1) is
    // replaced by the structural continuousDeploy marker; the temporary
    // setup slowdown is unchanged.
    const cicd = defs.find((d) => d.id === "ci-cd")!;
    expect(cicd.effects).toEqual([
      { type: "modifyRate", target: "all", op: "mul", value: 0.5, durationDays: 2 },
      { type: "continuousDeploy" },
    ]);
  });

  it("pins the Release 15 deploy-bottleneck split: dev/senior/contractor boost pull+finish, not deploy", () => {
    const defs = parseDecisions(decisionsJson);
    // A hire's every rate-boosting outcome now targets pull and finish with
    // the same value (human capacity no longer speeds deploy). No "all"
    // modifyRate survives on these three; deploy is left to ci-cd's scaling.
    const splitTargets = (effects: { type: string; target?: string }[]) =>
      effects.filter((e) => e.type === "modifyRate").map((e) => e.target).sort();

    const dev = defs.find((d) => d.id === "basic-dev")!;
    // base Strong hire: pull +1 and finish +1
    expect(dev.gamble![0].effects).toEqual([
      { type: "modifyRate", target: "pull", op: "add", value: 1.0 },
      { type: "modifyRate", target: "finish", op: "add", value: 1.0 },
    ]);
    for (const o of dev.gamble!) expect(splitTargets(o.effects)).toEqual(["finish", "pull"]);
    for (const o of dev.synergies![0].gamble!) expect(splitTargets(o.effects)).toEqual(["finish", "pull"]);

    const senior = defs.find((d) => d.id === "senior-dev")!;
    for (const o of senior.gamble!) expect(splitTargets(o.effects)).toEqual(["finish", "pull"]);
    for (const o of senior.synergies![0].gamble!) expect(splitTargets(o.effects)).toEqual(["finish", "pull"]);

    // contractor: base effects split, debt modifier retained
    const contractor = defs.find((d) => d.id === "contractor")!;
    expect(contractor.effects).toEqual([
      { type: "modifyRate", target: "pull", op: "add", value: 1.0 },
      { type: "modifyRate", target: "finish", op: "add", value: 1.0 },
      { type: "modifyDebtMultiplier", op: "mul", value: 1.1 },
    ]);

    // better-tooling deliberately KEEPS "all" (tooling plausibly speeds
    // releases too); support-retainer's slowdown likewise stays "all".
    expect(defs.find((d) => d.id === "better-tooling")!.effects).toEqual([
      { type: "modifyRate", target: "all", op: "add", value: 0.1 },
    ]);
    expect(defs.find((d) => d.id === "support-retainer")!.effects).toEqual([
      { type: "modifyRate", target: "all", op: "mul", value: 0.95 },
    ]);
  });

  it("rejects a gamble table whose probabilities do not sum to 1", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", tags: [], category: "ship-faster", cost: {}, effects: [], removable: true,
          gamble: [{ probability: 0.5, label: "a", effects: [] }],
        },
      ]),
    ).toThrow(/gamble for "x" sums to 0.5/);
  });

  it("rejects a requires reference to an unknown decision id", () => {
    expect(() =>
      parseDecisions([
        { id: "x", name: "x", description: "x", tags: [], category: "ship-faster", cost: {}, effects: [], removable: true, requires: ["ghost"] },
      ]),
    ).toThrow(/ghost/);
  });

  it("rejects duplicate decision ids", () => {
    expect(() =>
      parseDecisions([
        { id: "x", name: "x", description: "x", tags: [], category: "ship-faster", cost: {}, effects: [], removable: true },
        { id: "x", name: "x2", description: "x2", tags: [], category: "ship-faster", cost: {}, effects: [], removable: true },
      ]),
    ).toThrow(/duplicate/i);
  });

  it("parses a valid rampRate effect targeting a single rate", () => {
    const defs = parseDecisions([
      {
        id: "x", name: "x", description: "x", tags: [], category: "ship-faster", cost: {}, removable: true,
        effects: [{ type: "rampRate", target: "finish", perDay: 0.1, cap: 2 }],
      },
    ]);
    expect(defs[0].effects[0]).toEqual({ type: "rampRate", target: "finish", perDay: 0.1, cap: 2 });
  });

  it("rejects a rampRate effect targeting \"all\" (a ramp targets exactly one rate)", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", tags: [], category: "ship-faster", cost: {}, removable: true,
          effects: [{ type: "rampRate", target: "all", perDay: 0.1, cap: 1 }],
        },
      ]),
    ).toThrow(/content\/decisions\.json/);
  });

  it("rejects a rampRate effect with a negative perDay", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", tags: [], category: "ship-faster", cost: {}, removable: true,
          effects: [{ type: "rampRate", target: "finish", perDay: -0.1, cap: 1 }],
        },
      ]),
    ).toThrow(/content\/decisions\.json/);
  });

  it("parses a continuousDeploy effect (no parameters)", () => {
    const defs = parseDecisions([
      { id: "x", name: "x", description: "x", tags: [], category: "change-structure", cost: {}, removable: true, effects: [{ type: "continuousDeploy" }] },
    ]);
    expect(defs[0].effects[0]).toEqual({ type: "continuousDeploy" });
  });

  it("rejects a continuousDeploy effect with an unknown extra key (strict)", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", tags: [], category: "change-structure", cost: {}, removable: true,
          effects: [{ type: "continuousDeploy", value: 1 }],
        },
      ]),
    ).toThrow(/content\/decisions\.json/);
  });

  it("rejects a decision missing the required category field", () => {
    expect(() =>
      parseDecisions([
        { id: "x", name: "x", description: "x", tags: [], cost: {}, effects: [], removable: true },
      ]),
    ).toThrow(/category/);
  });

  it("rejects a decision with an unknown category value", () => {
    expect(() =>
      parseDecisions([
        { id: "x", name: "x", description: "x", tags: [], category: "totally-not-a-category", cost: {}, effects: [], removable: true },
      ]),
    ).toThrow(/category/);
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
