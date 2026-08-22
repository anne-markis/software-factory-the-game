import { describe, it, expect } from "vitest";
import {
  parseStartConfig,
  parseDecisions,
  parseChallenges,
  parseProjects,
  parseErasConfig,
  validateContentGraph,
  loadActiveContent,
} from "./content";
import { Engine } from "./engine";
import {
  challengesJson,
  decisionsJson,
  erasJson,
  loadShippedContent,
  projectsJson,
  startJson,
} from "./loadShippedContent";
import type { GameContent } from "./types";

describe("parseStartConfig", () => {
  it("parses the shipped start.json", () => {
    const cfg = parseStartConfig(startJson);
    // Studio spine (issue #88): backlog matches the 300-point Launch beta so
    // the beta gets a clean burndown; users start at 0.
    expect(cfg.stocks.backlog).toBe(300);
    expect(cfg.stocks.users).toBe(0);
    expect(cfg.stocks.budget).toBe(10000);
    expect(cfg.debtMultiplier).toBe(0.5);
    // Pull headroom (issue #89): pull runs at 2/day against finish and deploy at
    // 1/day, so the slowest stage is downstream of pull and the shop's
    // finish-side agent ladder has somewhere to put its capacity. With pull also
    // at 1 the ladder bought nothing: throughput is the min across the stages,
    // so a tripled finish rate could not move a single extra point.
    expect(cfg.baseRates).toEqual({ pull: 2, finish: 1, deploy: 1 });
    // Studio lean challenge pool (issue #89): a 35-day global gap, down from
    // 50 -- the pool shrank to three events, so a shorter gap keeps them from
    // disappearing entirely without crowding a short era.
    expect(cfg.challengeSpacingDays).toBe(35);
  });

  it("parses the Studio spine start config: launch-beta project, stock drags and flows (issue #88)", () => {
    const cfg = parseStartConfig(startJson);
    // Launch beta: $0-ish client fiction (payoutPerPoint 0), a cash bonus, and
    // a users grant on completion -- the only thing that lifts users off 0.
    expect(cfg.initialProject.id).toBe("launch-beta");
    expect(cfg.initialProject.name).toBe("Launch beta");
    expect(cfg.initialProject.sizePoints).toBe(300);
    expect(cfg.initialProject.payoutPerPoint).toBe(0);
    expect(cfg.initialProject.completionBonus).toBe(800);
    expect(cfg.initialProject.reputationReward).toBe(1);
    expect(cfg.initialProject.completionStockGrants).toEqual([{ stock: "users", amount: 30 }]);
    // Always-on support drag on users above a 25-user free band.
    expect(cfg.stockDrags).toEqual([
      { stock: "users", freeBand: 25, dragPerPoint: 0.004, maxDrag: 0.35, target: "all" },
    ]);
    // Organic acquisition only after the first project completes.
    expect(cfg.stockFlows).toEqual([
      {
        stock: "users",
        condition: { minCompletedProjects: 1 },
        acquirePerDay: 1.5,
        acquirePerStock: { stock: "reputation", perUnit: 0.1 },
        churnRatePerDay: 0.01,
      },
    ]);
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
    // established (15) key exactly to the Company/Megacorp reputation gates
    // (big-migration requires 5, enterprise-replatform requires 15),
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

  // ADR 0009: the seed Ready queue is the starting contract. Independently
  // authored stocks.backlog vs initialProject.sizePoints is how the two
  // ledgers first diverge.
  it("rejects stocks.backlog that does not match initialProject.sizePoints", () => {
    expect(() =>
      parseStartConfig({ ...startJson, stocks: { ...startJson.stocks, backlog: 299 } }),
    ).toThrow(/stocks\.backlog \(299\) must equal initialProject\.sizePoints \(300\)/);
  });
});

describe("parseDecisions", () => {
  it("parses the shipped decisions.json: the lean Studio shop (issue #89)", () => {
    const defs = parseDecisions(decisionsJson);
    const ids = defs.map((d) => d.id);
    // The Studio spine's whole shop, in content order. Everything else (the
    // copilot, the org ladder, agent-swarm/self-learning, ddos-protection, the
    // refactor/rebuild pair, support-retainer) is pushed to a later era.
    expect(ids).toEqual([
      "test-suite",
      "ci-cd",
      "basic-dev",
      "agent",
      "agent-harness",
      "agent-orchestration",
      "better-tooling",
      "subscription",
      "one-time-product",
    ]);
    const dev = defs.find((d) => d.id === "basic-dev")!;
    expect(dev.cost.perDay).toBe(7);
    expect(dev.gamble!.reduce((sum, o) => sum + o.probability, 0)).toBeCloseTo(1);
    // The hire is always in the shop: no requires, no count gate (§5.2.2).
    expect(dev.requires).toBeUndefined();
    expect(dev.requiresCounts).toBeUndefined();
    // Every shipped decision must carry a required category (schema);
    // the player shop no longer groups by it.
    expect(defs.every((d) => d.category)).toBe(true);
  });

  it("categorizes every shipped decision (required schema field)", () => {
    const defs = parseDecisions(decisionsJson);
    expect(defs.find((d) => d.id === "test-suite")!.category).toBe("tame-debt");
    expect(defs.find((d) => d.id === "subscription")!.category).toBe("earn-income");
    expect(defs.find((d) => d.id === "ci-cd")!.category).toBe("change-structure");
  });

  it("pins the Studio agent ladder: stackable agents, unique harness, count-gated orchestration (issue #89)", () => {
    const defs = parseDecisions(decisionsJson);

    // agent is the only repeatable card in the shop: no `unique`, and its
    // effects are additive so N copies are worth N times one copy. +0.2
    // finish/day and +0.1 debt multiplier per copy carry the power the old
    // single mul (x1.2 finish on a base rate of 1) used to hold.
    const agent = defs.find((d) => d.id === "agent")!;
    expect(agent.unique).toBeUndefined();
    expect(agent.effects).toEqual([
      { type: "modifyRate", target: "finish", op: "add", value: 0.2 },
      { type: "modifyDebtMultiplier", op: "add", value: 0.1 },
    ]);
    // No synergies: harness and orchestration are global multipliers now, so
    // an agent bought before them still gets their benefit.
    expect(agent.synergies).toBeUndefined();
    expect(agent.description).toMatch(/each agent/i);

    // agent-harness: one global multiplier pair, unique, gated on owning any
    // agent. Its old shape (empty effects + a synergy on agent) meant only
    // agents bought AFTER it were ever tamed.
    const harness = defs.find((d) => d.id === "agent-harness")!;
    expect(harness.unique).toBe(true);
    expect(harness.requires).toEqual(["agent"]);
    expect(harness.effects).toEqual([
      { type: "modifyRate", target: "finish", op: "mul", value: 1.25 },
      { type: "modifyDebtMultiplier", op: "mul", value: 0.7 },
    ]);
    expect(harness.synergies).toBeUndefined();

    // agent-orchestration (replacing swarm-orchestrator): the same KIND of
    // effect as the harness with a bigger speed multiplier and a deeper debt
    // cut, gated on >= 2 agents rather than on the harness.
    const orch = defs.find((d) => d.id === "agent-orchestration")!;
    expect(orch.unique).toBe(true);
    expect(orch.requires).toBeUndefined();
    expect(orch.requiresCounts).toEqual([{ id: "agent", count: 2 }]);
    expect(orch.effects).toEqual([
      { type: "modifyRate", target: "finish", op: "mul", value: 1.45 },
      { type: "modifyDebtMultiplier", op: "mul", value: 0.55 },
    ]);
    // Worth the gate: strictly more speed than the harness, and a higher
    // ongoing burn so it stays a real budget decision rather than a strict
    // upgrade you buy the moment you can afford it.
    expect(orch.cost.perDay!).toBeGreaterThan(harness.cost.perDay!);
  });

  it("pins the Studio monetization and delivery cards (issues #88, #89)", () => {
    const defs = parseDecisions(decisionsJson);
    // Release 11: ci-cd's permanent deploy speedup (modifyRate mul 1.1) is
    // replaced by the structural continuousDeploy marker; the temporary
    // setup slowdown is unchanged.
    const cicd = defs.find((d) => d.id === "ci-cd")!;
    expect(cicd.requires).toEqual(["test-suite"]);
    expect(cicd.effects).toEqual([
      { type: "modifyRate", target: "all", op: "mul", value: 0.5, durationDays: 2 },
      { type: "continuousDeploy" },
    ]);
    // Both monetization cards read the users stock and are ordinary purchases
    // (no project gate) -- they simply do nothing at 0 users.
    const sub = defs.find((d) => d.id === "subscription")!;
    expect(sub.incomeFromStock).toEqual({ stock: "users", perUnit: 0.75 });
    expect(sub.requires).toBeUndefined();
    const oneTime = defs.find((d) => d.id === "one-time-product")!;
    expect(oneTime.burstFromStock).toEqual({ stock: "users", probabilityPerDay: 0.08, perUnit: 1.2 });
    expect(oneTime.requires).toBeUndefined();
    // Nothing in the lean shop uses the flat incomePerDay any more
    // (support-retainer, its only user, is out of Studio).
    expect(defs.every((d) => d.incomePerDay === undefined)).toBe(true);
  });

  it("keeps the Release 15 deploy-bottleneck split on the hire, and \"all\" on tooling", () => {
    const defs = parseDecisions(decisionsJson);
    // A hire's every rate-boosting outcome targets pull and finish with the
    // same value (human capacity does not speed deploy). No "all" modifyRate
    // survives on it; deploy is left to ci-cd's structural change.
    const splitTargets = (effects: { type: string; target?: string }[]) =>
      effects.filter((e) => e.type === "modifyRate").map((e) => e.target).sort();

    const dev = defs.find((d) => d.id === "basic-dev")!;
    // base Strong hire: pull +1 and finish +1
    expect(dev.gamble![0].effects).toEqual([
      { type: "modifyRate", target: "pull", op: "add", value: 1.0 },
      { type: "modifyRate", target: "finish", op: "add", value: 1.0 },
    ]);
    for (const o of dev.gamble!) expect(splitTargets(o.effects)).toEqual(["finish", "pull"]);
    // The eng-manager odds synergy left Studio with the manager itself.
    expect(dev.synergies).toBeUndefined();

    // The agent ladder is finish-only for the same reason: agents write code,
    // they do not run the release.
    for (const id of ["agent", "agent-harness", "agent-orchestration"]) {
      expect(splitTargets(defs.find((d) => d.id === id)!.effects)).toEqual(["finish"]);
    }

    // better-tooling deliberately KEEPS "all" (tooling plausibly speeds
    // releases too).
    expect(defs.find((d) => d.id === "better-tooling")!.effects).toEqual([
      { type: "modifyRate", target: "all", op: "add", value: 0.1 },
    ]);
  });

  it("parses a requiresCounts gate and rejects malformed ones (issue #89)", () => {
    const base = { name: "x", description: "x", category: "ship-faster" as const, cost: {}, effects: [], removable: true };
    const defs = parseDecisions([
      { ...base, id: "seat" },
      { ...base, id: "planner", requiresCounts: [{ id: "seat", count: 2 }] },
    ]);
    expect(defs[1].requiresCounts).toEqual([{ id: "seat", count: 2 }]);

    // unknown id, named in the error like `requires` does
    expect(() =>
      parseDecisions([{ ...base, id: "planner", requiresCounts: [{ id: "ghost", count: 2 }] }]),
    ).toThrow(/ghost/);
    // count below 1 is not a gate at all
    expect(() =>
      parseDecisions([
        { ...base, id: "seat" },
        { ...base, id: "planner", requiresCounts: [{ id: "seat", count: 0 }] },
      ]),
    ).toThrow(/content\/decisions\.json/);
    // a >1 count on a unique decision can never be satisfied
    expect(() =>
      parseDecisions([
        { ...base, id: "seat", unique: true },
        { ...base, id: "planner", requiresCounts: [{ id: "seat", count: 2 }] },
      ]),
    ).toThrow(/unique/);
    // strict schema: no stray keys on a gate
    expect(() =>
      parseDecisions([
        { ...base, id: "seat" },
        { ...base, id: "planner", requiresCounts: [{ id: "seat", count: 2, typo: 1 }] },
      ]),
    ).toThrow(/content\/decisions\.json/);
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

  it("allows a later-era card to require an inherited id", () => {
    const prior = parseDecisions([
      { id: "test-suite", name: "Tests", description: "x", category: "tame-debt", cost: {}, effects: [], removable: true },
    ]);
    const defs = parseDecisions(
      [
        {
          id: "ci-cd",
          name: "CI",
          description: "x",
          category: "change-structure",
          cost: {},
          effects: [],
          removable: true,
          requires: ["test-suite"],
        },
      ],
      "content/eras/company/decisions.json",
      prior,
    );
    expect(defs.map((d) => d.id)).toEqual(["ci-cd"]);
  });

  it("rejects copying an inherited decision id into a later era file", () => {
    const prior = parseDecisions([
      { id: "agent", name: "Agent", description: "x", category: "ship-faster", cost: {}, effects: [], removable: true },
    ]);
    expect(() =>
      parseDecisions(
        [{ id: "agent", name: "Agent", description: "x", category: "ship-faster", cost: {}, effects: [], removable: true }],
        "content/eras/company/decisions.json",
        prior,
      ),
    ).toThrow(/inherited/);
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
  it("ships exactly the three lean Studio challenges (issue #89)", () => {
    const defs = parseChallenges(challengesJson);
    // The lean pool: one delivery event, one agent finish drag, one agent cash
    // hit. Hire drama (sickness, key-dev-poached), org/calendar pain
    // (meeting-creep, team-conflict), free money (cloud-credits,
    // open-source-windfall), ddos, security-breach, api-price-hike,
    // laptop-dies and prod-incident all leave Studio (§5.4).
    expect(defs.map((c) => c.id)).toEqual(["scope-creep", "model-deprecation", "runaway-agent-loop"]);
    // Issue #118: shipped challenges are immediate (no Decision-needed / expiry).
    expect(defs.every((c) => c.choice === undefined)).toBe(true);
    // Nothing left in the pool rolls per human dev or scales on tech debt, so
    // the hire is a pure budget/delivery tradeoff and debt bites only through
    // the always-on drag.
    expect(defs.every((c) => c.perHumanDev === undefined)).toBe(true);
    expect(defs.every((c) => c.probScaling === undefined)).toBe(true);
    // Every event is spaced by its own cooldown on top of the global gap.
    expect(defs.every((c) => c.cooldownDays !== undefined)).toBe(true);
  });

  it("ships Production incident only as a Company delta, inherited into Megacorp", () => {
    const studio = loadShippedContent("studio");
    const company = loadShippedContent("company");
    const megacorp = loadShippedContent("megacorp");
    expect(studio.challenges.some((c) => c.id === "prod-incident")).toBe(false);
    const incident = company.challenges.find((c) => c.id === "prod-incident");
    expect(incident).toMatchObject({
      name: "Production incident",
      probabilityPerDay: 0.01,
      cooldownDays: 60,
      condition: { minCompletedProjects: 1 },
      probScaling: { stat: "techDebt", per: 500, add: 0.01 },
    });
    expect(incident!.effects).toEqual([
      { type: "addToStock", stock: "budget", value: -8000 },
      { type: "addToStock", stock: "reputation", value: -2 },
      { type: "addToStock", stock: "users", value: -15 },
      { type: "modifyRate", target: "all", op: "mul", value: 0.8, durationDays: 3 },
    ]);
    expect(company.challenges.filter((c) => c.id === "prod-incident")).toHaveLength(1);
    expect(megacorp.challenges.find((c) => c.id === "prod-incident")).toEqual(incident);
  });

  it("pins the playtest-locked lean challenge rates (issue #86 knobs)", () => {
    const defs = parseChallenges(challengesJson);

    // scope-creep: 1%/day, 45-day cooldown, and held back until the Launch
    // beta has shipped so the opening tutorial stretch stays quiet (the old
    // minDay 15 gate could fire mid-beta).
    const scope = defs.find((c) => c.id === "scope-creep")!;
    expect(scope.probabilityPerDay).toBe(0.01);
    expect(scope.cooldownDays).toBe(45);
    expect(scope.condition).toEqual({ minCompletedProjects: 1 });
    expect(scope.effects).toEqual([{ type: "addToStock", stock: "backlog", value: 75 }]);

    // model-deprecation: 0.1%/day, 365-day cooldown, gated on owning anything
    // from the agent ladder; immediate finish drag (no choice / expiry, #118).
    const deprecation = defs.find((c) => c.id === "model-deprecation")!;
    expect(deprecation.probabilityPerDay).toBe(0.001);
    expect(deprecation.cooldownDays).toBe(365);
    expect(deprecation.condition).toEqual({
      requiresAnyDecision: ["agent", "agent-harness", "agent-orchestration"],
    });
    expect(deprecation.choice).toBeUndefined();
    expect(deprecation.effects).toEqual([
      { type: "modifyRate", target: "finish", op: "mul", value: 0.7, durationDays: 30 },
    ]);
    expect(deprecation.description.toLowerCase()).toContain("finish");
    expect(deprecation.description.toLowerCase()).toContain("30");

    // runaway-agent-loop: same agent gate; the cash hit came down from $200 to
    // $60 (a survivable slip on a Studio budget) and the copy names the amount.
    const runaway = defs.find((c) => c.id === "runaway-agent-loop")!;
    expect(runaway.condition).toEqual({
      requiresAnyDecision: ["agent", "agent-harness", "agent-orchestration"],
    });
    expect(runaway.cooldownDays).toBe(45);
    expect(runaway.effects).toEqual([{ type: "addToStock", stock: "budget", value: -60 }]);
    expect(runaway.description).toContain("$60");
  });

  it("parses a minCompletedProjects condition and rejects a fractional one (issue #89)", () => {
    const defs = parseChallenges([
      {
        id: "x", name: "x", description: "x", probabilityPerDay: 0.1, effects: [],
        condition: { minCompletedProjects: 2 },
      },
    ]);
    expect(defs[0].condition).toEqual({ minCompletedProjects: 2 });
    expect(() =>
      parseChallenges([
        {
          id: "x", name: "x", description: "x", probabilityPerDay: 0.1, effects: [],
          condition: { minCompletedProjects: 1.5 },
        },
      ]),
    ).toThrow(/content\/challenges\.json/);
  });

  it("pins the Studio tiny gigs and unique version ladder", () => {
    const defs = parseProjects(projectsJson);
    const bugfix = defs.find((p) => p.id === "gig-bugfix")!;
    expect(bugfix).toMatchObject({
      name: "Weekend bugfix",
      sizePoints: 100,
      upfrontCost: 0,
      payoutPerPoint: 18,
      completionBonus: 200,
      reputationReward: 1,
    });
    expect(bugfix.unique).toBeUndefined();
    const refactor = defs.find((p) => p.id === "small-refactor")!;
    expect(refactor).toMatchObject({
      name: "Small refactor",
      sizePoints: 50,
      upfrontCost: 0,
      payoutPerPoint: 0,
      completionBonus: 0,
      reputationReward: 0,
    });
    expect(refactor.unique).toBeUndefined();
    expect(refactor.completionStockGrants).toEqual([{ stock: "techDebt", amount: -50 }]);
    const v1 = defs.find((p) => p.id === "ship-v1")!;
    expect(v1).toMatchObject({
      name: "Ship v1",
      sizePoints: 400,
      payoutPerPoint: 0,
      unique: true,
      requiresCompletedId: "launch-beta",
    });
    expect(v1.completionStockGrants).toEqual([{ stock: "users", amount: 20 }]);
    expect(defs.find((p) => p.id === "ship-v5")!.requiresCompletedId).toBe("ship-v4");
    expect(defs.some((p) => p.id === "small-crm")).toBe(false);
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
  it("parses reputationReward on every shipped Studio project", () => {
    const defs = parseProjects(projectsJson);
    expect(defs.every((p) => typeof p.reputationReward === "number")).toBe(true);
    expect(defs.find((p) => p.id === "gig-bugfix")!.reputationReward).toBe(1);
    expect(defs.find((p) => p.id === "gig-plugin")!.reputationReward).toBe(2);
    expect(defs.find((p) => p.id === "ship-v1")!.reputationReward).toBe(2);
    expect(defs.find((p) => p.id === "ship-v5")!.reputationReward).toBe(4);
  });

  it("keeps the old contract ladder as Company/Megacorp deltas, not Studio offers", () => {
    const studio = loadShippedContent();
    expect(studio.projects.map((p) => p.id)).toEqual([
      "gig-bugfix",
      "gig-landing-page",
      "gig-plugin",
      "small-refactor",
      "ship-v1",
      "ship-v2",
      "ship-v3",
      "ship-v4",
      "ship-v5",
    ]);
    const company = loadShippedContent("company");
    const crm = company.projects.find((p) => p.id === "small-crm")!;
    expect(crm.requiresReputation).toBeUndefined();
    const big = company.projects.find((p) => p.id === "big-migration")!;
    expect(big.requiresCompleted).toBe(1);
    expect(big.requiresReputation).toBe(5);
    expect(company.projects.some((p) => p.id === "mobile-app")).toBe(false);
    const mega = loadShippedContent("megacorp");
    const ent = mega.projects.find((p) => p.id === "enterprise-replatform")!;
    expect(ent.requiresCompleted).toBe(2);
    expect(ent.requiresReputation).toBe(15);
    expect(ent.reputationReward).toBe(20);
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
    const content: GameContent = loadShippedContent();
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

  it("accepts requiresCompletedId pointing at the start project or another catalog id", () => {
    const content: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [],
      challenges: [],
      projects: parseProjects([
        {
          id: "v1",
          name: "v1",
          sizePoints: 1,
          upfrontCost: 0,
          payoutPerPoint: 0,
          completionBonus: 0,
          reputationReward: 0,
          unique: true,
          requiresCompletedId: "launch-beta",
        },
      ]),
    };
    expect(() => validateContentGraph(content)).not.toThrow();
  });

  it("rejects requiresCompletedId that is unknown or self-referential", () => {
    const unknown: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [],
      challenges: [],
      projects: parseProjects([
        {
          id: "v1",
          name: "v1",
          sizePoints: 1,
          upfrontCost: 0,
          payoutPerPoint: 0,
          completionBonus: 0,
          reputationReward: 0,
          requiresCompletedId: "no-such-project",
        },
      ]),
    };
    expect(() => validateContentGraph(unknown)).toThrow(/no-such-project/);
    const loop: GameContent = {
      start: parseStartConfig(startJson),
      decisions: [],
      challenges: [],
      projects: parseProjects([
        {
          id: "v1",
          name: "v1",
          sizePoints: 1,
          upfrontCost: 0,
          payoutPerPoint: 0,
          completionBonus: 0,
          reputationReward: 0,
          requiresCompletedId: "v1",
        },
      ]),
    };
    expect(() => validateContentGraph(loop)).toThrow(/cannot reference itself/);
  });
});

describe("per-era content layout (issue #90)", () => {
  it("parses eras.json with Studio start and later-era entry shells", () => {
    const eras = parseErasConfig(erasJson);
    expect(eras.startingEraId).toBe("studio");
    expect(eras.eras.map((e) => e.id)).toEqual(["studio", "company", "megacorp"]);
    expect(eras.eras[0].entryAnyOf).toBeUndefined();
    expect(eras.eras[1].entryAnyOf).toEqual([{ minBudget: 1000000 }]);
    expect(eras.eras[1].silentEntry).toBeUndefined();
    expect(eras.eras[2].entryAnyOf).toEqual([{ minBudget: 100000000 }]);
    expect(eras.eras[2].silentEntry).toBeUndefined();
  });

  it("keeps silentEntry false when a later era opts into an announced crossing", () => {
    const cfg = parseErasConfig({
      startingEraId: "studio",
      eras: [
        { id: "studio", name: "Studio" },
        { id: "loud", name: "Loud", silentEntry: false, entryAnyOf: [{ minBudget: 1 }] },
      ],
    });
    expect(cfg.eras[1].silentEntry).toBe(false);
  });

  it("rejects a starting era that declares entry criteria", () => {
    expect(() =>
      parseErasConfig({
        startingEraId: "studio",
        eras: [{ id: "studio", name: "Studio", entryAnyOf: [{ minBudget: 1 }] }],
      }),
    ).toThrow(/starting era/);
  });

  it("loadShippedContent inherits Studio catalogs into Company and Megacorp deltas", () => {
    const studio = loadShippedContent();
    expect(studio.eraId).toBe("studio");
    expect(studio.decisions.length).toBeGreaterThan(0);
    expect(studio.challenges.length).toBeGreaterThan(0);
    expect(studio.projects.length).toBeGreaterThan(0);

    const company = loadShippedContent("company");
    expect(company.eraId).toBe("company");
    expect(company.decisions.map((d) => d.id)).toEqual(studio.decisions.map((d) => d.id));
    expect(company.challenges.map((d) => d.id)).toEqual([
      ...studio.challenges.map((d) => d.id),
      "prod-incident",
    ]);
    expect(company.projects.map((d) => d.id)).toEqual([
      ...studio.projects.map((d) => d.id),
      "small-crm",
      "big-migration",
    ]);

    const megacorp = loadShippedContent("megacorp");
    expect(megacorp.eraId).toBe("megacorp");
    expect(megacorp.decisions.map((d) => d.id)).toEqual(studio.decisions.map((d) => d.id));
    expect(megacorp.challenges.map((d) => d.id)).toEqual(company.challenges.map((d) => d.id));
    expect(megacorp.projects.map((d) => d.id)).toEqual([
      ...company.projects.map((d) => d.id),
      "enterprise-replatform",
    ]);
  });

  it("loadActiveContent merges prior-era catalogs so later folders stay deltas", () => {
    const card = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      name: id,
      description: id,
      category: "ship-faster",
      cost: {},
      effects: [],
      removable: true,
      ...extra,
    });
    const eras = {
      startingEraId: "studio",
      eras: [
        { id: "studio", name: "Studio" },
        { id: "company", name: "Company", entryAnyOf: [{ minBudget: 1 }] },
      ],
    };
    const bundles = {
      studio: { decisions: [card("agent")], challenges: [], projects: [] },
      company: {
        decisions: [card("autonomous-pull", { requires: ["agent"] })],
        challenges: [],
        projects: [],
      },
    };
    const company = loadActiveContent(startJson, eras, bundles, "company");
    expect(company.decisions.map((d) => d.id)).toEqual(["agent", "autonomous-pull"]);
    const studio = loadActiveContent(startJson, eras, bundles, "studio");
    expect(studio.decisions.map((d) => d.id)).toEqual(["agent"]);
  });

  it("loadActiveContent refuses unknown era ids without hardcoding names in tick", () => {
    expect(() =>
      loadActiveContent(startJson, erasJson, { studio: { decisions: [], challenges: [], projects: [] } }, "nope"),
    ).toThrow(/Unknown era id/);
  });

  it("loadActiveContent refuses an era listed in eras.json with no registered bundle", () => {
    expect(() =>
      loadActiveContent(
        startJson,
        erasJson,
        { studio: { decisions: decisionsJson, challenges: challengesJson, projects: projectsJson } },
        "company",
      ),
    ).toThrow(/No content bundle registered/);
  });

  it("stays in Studio across early ticks when entry floors are not met", () => {
    const e = new Engine(loadShippedContent(), undefined, loadShippedContent);
    expect(e.getState().eraId).toBe("studio");
    for (let i = 0; i < 50; i++) e.tick();
    expect(e.getState().eraId).toBe("studio");
  });
});
