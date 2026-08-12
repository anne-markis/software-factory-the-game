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

  it("parses the Release 17 reputation stock and milestones", () => {
    const cfg = parseStartConfig(startJson);
    expect(cfg.stocks.reputation).toBe(0);
    expect(cfg.initialProject.reputationReward).toBe(1);
    // Four ascending milestones, tuned in the balance sweep. trusted (5) and
    // established (15) key exactly to the mid- and top-tier reputation gates
    // (mobile-app/big-migration require 5, enterprise-replatform requires 15),
    // so a milestone banner and the tier it opens fire together.
    expect(cfg.milestones.map((m) => m.id)).toEqual(["trusted", "established", "leader", "titan"]);
    expect(cfg.milestones.map((m) => m.reputation)).toEqual([5, 15, 35, 70]);
    // Every milestone carries a player-facing name and a banner message.
    expect(cfg.milestones.every((m) => m.name.length > 0 && m.message.length > 0)).toBe(true);
  });

  it("rejects a negative reputation stock", () => {
    expect(() =>
      parseStartConfig({ ...startJson, stocks: { ...startJson.stocks, reputation: -1 } }),
    ).toThrow(/content\/start\.json/);
  });

  it("rejects a negative initialProject.reputationReward", () => {
    expect(() =>
      parseStartConfig({ ...startJson, initialProject: { ...startJson.initialProject, reputationReward: -1 } }),
    ).toThrow(/content\/start\.json/);
  });

  it("rejects duplicate milestone ids", () => {
    expect(() =>
      parseStartConfig({
        ...startJson,
        milestones: [
          { id: "dup", reputation: 5, name: "A", message: "a" },
          { id: "dup", reputation: 10, name: "B", message: "b" },
        ],
      }),
    ).toThrow(/duplicate milestone id "dup"/);
  });

  it("rejects milestone thresholds that are not strictly ascending", () => {
    expect(() =>
      parseStartConfig({
        ...startJson,
        milestones: [
          { id: "a", reputation: 10, name: "A", message: "a" },
          { id: "b", reputation: 10, name: "B", message: "b" },
        ],
      }),
    ).toThrow(/not strictly ascending/);
    expect(() =>
      parseStartConfig({
        ...startJson,
        milestones: [
          { id: "a", reputation: 10, name: "A", message: "a" },
          { id: "b", reputation: 5, name: "B", message: "b" },
        ],
      }),
    ).toThrow(/content\/start\.json/);
  });

  it("accepts an empty milestones array", () => {
    expect(() => parseStartConfig({ ...startJson, milestones: [] })).not.toThrow();
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
      "refactoring-sprint",
      "redesign-rebuild",
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

  it("pins the Release 16 debt-recovery decisions (refactoring-sprint, redesign-rebuild)", () => {
    const defs = parseDecisions(decisionsJson);

    const sprint = defs.find((d) => d.id === "refactoring-sprint")!;
    expect(sprint.category).toBe("tame-debt");
    expect(sprint.unique).toBeUndefined(); // repeat purchases are the point: debt regrows
    expect(sprint.removable).toBe(true);
    expect(sprint.cost).toEqual({ oneTime: 400 });
    expect(sprint.effects).toEqual([
      { type: "modifyRate", target: "all", op: "mul", value: 0.6, durationDays: 8 },
      { type: "scaleStock", stock: "techDebt", factor: 0.7 },
    ]);
    expect(sprint.requires).toBeUndefined(); // purchasable anytime

    const rebuild = defs.find((d) => d.id === "redesign-rebuild")!;
    expect(rebuild.category).toBe("tame-debt");
    expect(rebuild.unique).toBeUndefined();
    expect(rebuild.removable).toBe(true);
    expect(rebuild.cost).toEqual({ oneTime: 1200 });
    expect(rebuild.effects).toEqual([
      { type: "modifyRate", target: "all", op: "mul", value: 0.4, durationDays: 25 },
      { type: "scaleStock", stock: "techDebt", factor: 0.1 },
    ]);
    expect(rebuild.requires).toBeUndefined();
  });

  it("parses a valid scaleStock effect", () => {
    const defs = parseDecisions([
      {
        id: "x", name: "x", description: "x", category: "tame-debt", cost: {}, removable: true,
        effects: [{ type: "scaleStock", stock: "techDebt", factor: 0.5 }],
      },
    ]);
    expect(defs[0].effects[0]).toEqual({ type: "scaleStock", stock: "techDebt", factor: 0.5 });
  });

  it("rejects a scaleStock effect with a negative factor", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", category: "tame-debt", cost: {}, removable: true,
          effects: [{ type: "scaleStock", stock: "techDebt", factor: -0.1 }],
        },
      ]),
    ).toThrow(/content\/decisions\.json/);
  });

  it("rejects a gamble table whose probabilities do not sum to 1", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", category: "ship-faster", cost: {}, effects: [], removable: true,
          gamble: [{ probability: 0.5, label: "a", effects: [] }],
        },
      ]),
    ).toThrow(/gamble for "x" sums to 0.5/);
  });

  it("rejects a requires reference to an unknown decision id", () => {
    expect(() =>
      parseDecisions([
        { id: "x", name: "x", description: "x", category: "ship-faster", cost: {}, effects: [], removable: true, requires: ["ghost"] },
      ]),
    ).toThrow(/ghost/);
  });

  it("rejects duplicate decision ids", () => {
    expect(() =>
      parseDecisions([
        { id: "x", name: "x", description: "x", category: "ship-faster", cost: {}, effects: [], removable: true },
        { id: "x", name: "x2", description: "x2", category: "ship-faster", cost: {}, effects: [], removable: true },
      ]),
    ).toThrow(/duplicate/i);
  });

  it("parses a valid rampRate effect targeting a single rate", () => {
    const defs = parseDecisions([
      {
        id: "x", name: "x", description: "x", category: "ship-faster", cost: {}, removable: true,
        effects: [{ type: "rampRate", target: "finish", perDay: 0.1, cap: 2 }],
      },
    ]);
    expect(defs[0].effects[0]).toEqual({ type: "rampRate", target: "finish", perDay: 0.1, cap: 2 });
  });

  it("rejects a rampRate effect targeting \"all\" (a ramp targets exactly one rate)", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", category: "ship-faster", cost: {}, removable: true,
          effects: [{ type: "rampRate", target: "all", perDay: 0.1, cap: 1 }],
        },
      ]),
    ).toThrow(/content\/decisions\.json/);
  });

  it("rejects a rampRate effect with a negative perDay", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", category: "ship-faster", cost: {}, removable: true,
          effects: [{ type: "rampRate", target: "finish", perDay: -0.1, cap: 1 }],
        },
      ]),
    ).toThrow(/content\/decisions\.json/);
  });

  it("parses a continuousDeploy effect (no parameters)", () => {
    const defs = parseDecisions([
      { id: "x", name: "x", description: "x", category: "change-structure", cost: {}, removable: true, effects: [{ type: "continuousDeploy" }] },
    ]);
    expect(defs[0].effects[0]).toEqual({ type: "continuousDeploy" });
  });

  it("rejects a continuousDeploy effect with an unknown extra key (strict)", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", category: "change-structure", cost: {}, removable: true,
          effects: [{ type: "continuousDeploy", value: 1 }],
        },
      ]),
    ).toThrow(/content\/decisions\.json/);
  });

  it("rejects a decision missing the required category field", () => {
    expect(() =>
      parseDecisions([
        { id: "x", name: "x", description: "x", cost: {}, effects: [], removable: true },
      ]),
    ).toThrow(/category/);
  });

  it("rejects a decision with an unknown category value", () => {
    expect(() =>
      parseDecisions([
        { id: "x", name: "x", description: "x", category: "totally-not-a-category", cost: {}, effects: [], removable: true },
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
    // Release 17: prod-incident now also bleeds reputation alongside its
    // budget hit and rate slowdown.
    const incidentRep = incident.effects.find((e) => e.type === "addToStock" && e.stock === "reputation")!;
    expect(incidentRep).toMatchObject({ stock: "reputation", value: -2 });
  });

  it("pins the Release 17 security-breach challenge (the spiral's teeth)", () => {
    const defs = parseChallenges(challengesJson);
    const breach = defs.find((c) => c.id === "security-breach")!;
    // Debt-gated: only high-debt builds are exposed (minTechDebt 800), with a
    // day-15 grace band. Probability scales with tech debt, so the reinforcing
    // loop's governor is the debt drag already in play.
    expect(breach.condition).toEqual({ minTechDebt: 800, minDay: 15 });
    expect(breach.probScaling).toEqual({ stat: "techDebt", per: 500, add: 0.008 });
    expect(breach.cooldownDays).toBe(120);
    // A plain (non-choice) event: no choice, effects apply directly.
    expect(breach.choice).toBeUndefined();
    // Budget hit AND a 5-point reputation hit -- the largest reputation loss
    // in content, enough to drop a mid-tier build back below the 5 gate.
    expect(breach.effects.find((e) => e.type === "addToStock" && e.stock === "budget")).toMatchObject({ value: -300 });
    expect(breach.effects.find((e) => e.type === "addToStock" && e.stock === "reputation")).toMatchObject({ value: -5 });
    // Description names the reputation cost.
    expect(breach.description).toMatch(/reputation/i);
  });

  it("pins the content-wave challenge values", () => {
    const defs = parseChallenges(challengesJson);
    const ids = defs.map((c) => c.id);
    expect(ids).toEqual([
      "sickness", "ddos", "scope-creep", "prod-incident", "security-breach", "laptop-dies", "key-dev-poached",
      "model-deprecation", "api-price-hike", "runaway-agent-loop", "meeting-creep", "team-conflict",
      "cloud-credits", "open-source-windfall",
    ]);

    const deprecation = defs.find((c) => c.id === "model-deprecation")!;
    expect(deprecation.condition).toEqual({
      requiresAnyDecision: ["agent", "agent-harness", "agent-swarm", "swarm-orchestrator", "self-learning-agents"],
    });
    expect(deprecation.cooldownDays).toBe(90);
    const defaultOption = deprecation.choice!.options.find((o) => o.id === deprecation.choice!.defaultOptionId);
    expect(defaultOption).toBeDefined();
    expect(defaultOption!.id).toBe("pay-migration");

    expect(defs.find((c) => c.id === "meeting-creep")!.condition).toEqual({ minHumanDevs: 1 });
    expect(defs.find((c) => c.id === "team-conflict")!.condition).toEqual({ minHumanDevs: 1 });

    const windfall = defs.find((c) => c.id === "open-source-windfall")!;
    const windfallEffect = windfall.effects.find((e) => e.type === "addToStock")!;
    expect(windfallEffect).toMatchObject({ stock: "budget", value: 400 });
    expect(windfallEffect.value).toBeGreaterThan(0);

    const poached = defs.find((c) => c.id === "key-dev-poached")!;
    expect(poached.cooldownDays).toBe(60);
    const letGo = poached.choice!.options.find((o) => o.id === "let-them-go")!;
    expect(letGo.effects.some((e) => e.type === "removeHuman")).toBe(true);
    expect(letGo.label).toMatch(/lose the developer/i);
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

  it("rejects a removeHuman choice effect without minHumanDevs >= 1", () => {
    expect(() =>
      parseChallenges([
        {
          id: "bad",
          name: "bad",
          description: "bad",
          probabilityPerDay: 0.1,
          effects: [],
          choice: {
            expiresInDays: 3,
            defaultOptionId: "go",
            options: [{ id: "go", label: "go", effects: [{ type: "removeHuman" }] }],
          },
        },
      ]),
    ).toThrow(/removeHuman/);
  });

  it("accepts a removeHuman choice effect when minHumanDevs is at least 1", () => {
    const defs = parseChallenges([
      {
        id: "ok",
        name: "ok",
        description: "ok",
        probabilityPerDay: 0.1,
        condition: { minHumanDevs: 1 },
        effects: [],
        choice: {
          expiresInDays: 3,
          defaultOptionId: "go",
          options: [{ id: "go", label: "go", effects: [{ type: "removeHuman" }] }],
        },
      },
    ]);
    expect(defs[0].choice!.options[0].effects[0]).toEqual({ type: "removeHuman" });
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

  it("parses a non-empty requiresAnyDecision condition", () => {
    const defs = parseChallenges([
      {
        id: "x", name: "x", description: "x", probabilityPerDay: 0.1, effects: [],
        condition: { requiresAnyDecision: ["agent", "agent-harness"] },
      },
    ]);
    expect(defs[0].condition).toEqual({ requiresAnyDecision: ["agent", "agent-harness"] });
  });

  it("rejects an empty requiresAnyDecision condition", () => {
    expect(() =>
      parseChallenges([
        {
          id: "x", name: "x", description: "x", probabilityPerDay: 0.1, effects: [],
          condition: { requiresAnyDecision: [] },
        },
      ]),
    ).toThrow(/requiresAnyDecision/);
  });
});

describe("parseProjects", () => {
  it("parses the Release 17 reputationReward on every shipped project", () => {
    const defs = parseProjects(projectsJson);
    expect(defs.every((p) => typeof p.reputationReward === "number")).toBe(true);
    // Rewards scale with contract size (1500/5000/9000/20000/50000 pts):
    // first-contract 1, small-crm 5, mobile-app 6, big-migration 12,
    // enterprise 20. first (start.json) + small-crm = 6, clearing the
    // mid-tier gate of 5 the moment the entry contract completes.
    expect(defs.find((p) => p.id === "small-crm")!.reputationReward).toBe(5);
    expect(defs.find((p) => p.id === "mobile-app")!.reputationReward).toBe(6);
    expect(defs.find((p) => p.id === "big-migration")!.reputationReward).toBe(12);
    expect(defs.find((p) => p.id === "enterprise-replatform")!.reputationReward).toBe(20);
  });

  it("gates the top three tiers on reputation ALONGSIDE their completed-count floor (Release 17)", () => {
    const defs = parseProjects(projectsJson);
    // small-crm is the entry contract: no reputation gate, no completion floor.
    const crm = defs.find((p) => p.id === "small-crm")!;
    expect(crm.requiresReputation).toBeUndefined();
    // big-migration & mobile-app: 1 completion AND 5 reputation. enterprise:
    // 2 completions AND 15 reputation (the binding top-tier gate).
    const big = defs.find((p) => p.id === "big-migration")!;
    expect(big.requiresCompleted).toBe(1);
    expect(big.requiresReputation).toBe(5);
    const mobile = defs.find((p) => p.id === "mobile-app")!;
    expect(mobile.requiresCompleted).toBe(1);
    expect(mobile.requiresReputation).toBe(5);
    const ent = defs.find((p) => p.id === "enterprise-replatform")!;
    expect(ent.requiresCompleted).toBe(2);
    expect(ent.requiresReputation).toBe(15);
  });

  it("rejects a negative reputationReward", () => {
    expect(() =>
      parseProjects([
        { id: "x", name: "x", sizePoints: 1, upfrontCost: 0, payoutPerPoint: 1, completionBonus: 0, reputationReward: -1 },
      ]),
    ).toThrow(/content\/projects\.json/);
  });

  it("parses an optional requiresReputation and rejects a negative one", () => {
    const defs = parseProjects([
      {
        id: "x", name: "x", sizePoints: 1, upfrontCost: 0, payoutPerPoint: 1, completionBonus: 0,
        reputationReward: 0, requiresReputation: 5,
      },
    ]);
    expect(defs[0].requiresReputation).toBe(5);
    expect(() =>
      parseProjects([
        {
          id: "x", name: "x", sizePoints: 1, upfrontCost: 0, payoutPerPoint: 1, completionBonus: 0,
          reputationReward: 0, requiresReputation: -1,
        },
      ]),
    ).toThrow(/content\/projects\.json/);
  });
});

describe("validateContentGraph", () => {
  it("passes for shipped content when every challenge condition references real decision ids", () => {
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

  it("checks every requiresAnyDecision entry and rejects an unknown decision id", () => {
    const content: GameContent = {
      start: parseStartConfig(startJson),
      decisions: parseDecisions(decisionsJson),
      challenges: parseChallenges([
        {
          id: "agent-event", name: "Agent Event", description: "d", probabilityPerDay: 0.1, effects: [],
          condition: { requiresAnyDecision: ["agent", "no-such-decision"] },
        },
      ]),
      projects: [],
    };
    expect(() => validateContentGraph(content)).toThrow(/agent-event/);
    expect(() => validateContentGraph(content)).toThrow(/content\/challenges\.json/);
    expect(() => validateContentGraph(content)).toThrow(/no-such-decision/);
  });
});
