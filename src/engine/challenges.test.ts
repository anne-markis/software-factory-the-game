import { describe, it, expect } from "vitest";
import { rollChallenges, resolveChoice } from "./challenges";
import { initialState } from "./engine";
import { applyDecision, removeDecision } from "./decisions";
import { parseStartConfig, parseChallenges, parseDecisions } from "./content";
import { challengesJson, decisionsJson, loadShippedContent, startJson } from "./loadShippedContent";
import { createRng, hashRoll, type Rng } from "./rng";
import type { GameContent } from "./types";

// The challenge phase no longer draws from the shared rng stream: each
// challenge rolls a stateless hashRoll keyed by its own id. This rng turns
// that into a hard invariant -- any next() during rollChallenges throws. Tests
// that also buy decisions pass a real stream to applyDecision (purchases still
// gamble off the shared rng).
const noRng: Rng = {
  next: () => {
    throw new Error("challenge phase must not draw from the shared rng stream");
  },
  getState: () => 0,
};

// content/start.json's seed, which initialState copies into state.gameSeed.
// Every hashRoll assertion below is computed against this seed; the specific
// days were found by scanning and are pinned with the value they produce.
const SEED = 20260714;

function content(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: parseChallenges(challengesJson),
    projects: [],
  };
}

describe("rollChallenges", () => {
  it("fires a challenge on a day whose hashed roll lands under its probability", () => {
    const c = content();
    const s = initialState(c);
    // RE-PINNED for the lean Studio pool (issue #89: scope-creep 1%/day, gated
    // on a completed project instead of minDay). Day 86 is the pinned day on
    // which, among this player's eligible challenges, only scope-creep rolls
    // under its probability: hashRoll(SEED, 86, "scope-creep") = 0.0089 < 0.01,
    // while model-deprecation (0.09) and runaway-agent-loop (0.82) are both
    // over theirs -- and gated out anyway with no agent owned. So backlog moves
    // by exactly scope-creep's +75.
    s.completedProjects = 1; // Launch beta shipped: scope-creep is live
    s.day = 86;
    expect(hashRoll(SEED, 86, "scope-creep")).toBeLessThan(0.01);
    rollChallenges(s, noRng, c);
    expect(s.stocks.backlog).toBe(375); // Studio start backlog 300 + 75
    expect(s.projects[0]!.remaining).toBe(375); // ADR 0009: scope creep is more contract work
    expect(s.log.some((l) => l.message.includes("Scope creep"))).toBe(true);
  });

  it("respects minCompletedProjects: scope-creep stays quiet until the first project ships (issue #89)", () => {
    const c = content();
    const s = initialState(c);
    // Same pinned firing day as above, but nothing has shipped yet.
    s.day = 86;
    expect(hashRoll(SEED, 86, "scope-creep")).toBeLessThan(0.01);
    rollChallenges(s, noRng, c);
    expect(s.stocks.backlog).toBe(300); // gated out entirely: no backlog spike
    expect(s.lastChallengeDay).toBeUndefined(); // nothing fired at all
  });

  it("respects conditions: agent challenges never fire with no agent owned", () => {
    const c = content();
    const s = initialState(c);
    s.completedProjects = 1;
    // Day 149 (pinned): runaway-agent-loop's roll is 0.0026 < its 0.008, so
    // only its requiresAnyDecision gate can keep it from firing.
    s.day = 149;
    expect(hashRoll(SEED, 149, "runaway-agent-loop")).toBeLessThan(0.008);
    rollChallenges(s, noRng, c);
    expect(s.stocks.budget).toBe(10000);
  });

  it("does not put Production incident in the Studio pool", () => {
    const c = content();
    expect(c.challenges.some((ch) => ch.id === "prod-incident")).toBe(false);
    const s = initialState(c);
    s.completedProjects = 1;
    s.day = 26;
    expect(hashRoll(SEED, 26, "prod-incident")).toBeLessThan(0.01);
    rollChallenges(s, noRng, c);
    expect(s.stocks.budget).toBe(10000);
    expect(s.log.some((l) => l.message.includes("Production incident"))).toBe(false);
  });

  it("fires Production incident from the Company catalog on a pinned day", () => {
    // Day 26: scope-creep's roll is 0.7731 (miss), agent challenges are gated
    // out with no agent owned, prod-incident's roll is 0.0010 < 0.01.
    const c = loadShippedContent("company");
    const s = initialState(c);
    s.completedProjects = 1;
    s.stocks.budget = 1_000_000;
    s.stocks.reputation = 5;
    s.stocks.users = 40;
    s.day = 26;
    expect(hashRoll(SEED, 26, "scope-creep")).toBeGreaterThanOrEqual(0.01);
    expect(hashRoll(SEED, 26, "prod-incident")).toBeLessThan(0.01);
    rollChallenges(s, noRng, c);
    expect(s.stocks.budget).toBe(992_000);
    expect(s.stocks.reputation).toBe(3);
    expect(s.stocks.users).toBe(25);
    expect(s.modifiers.some((m) => m.target === "allRates" && m.value === 0.8)).toBe(true);
    expect(s.log.some((l) => l.message.includes("Production incident"))).toBe(true);
  });

  it("holds Production incident until a project has shipped, even in Company", () => {
    const c = loadShippedContent("company");
    const s = initialState(c);
    s.stocks.budget = 1_000_000;
    s.day = 26;
    expect(hashRoll(SEED, 26, "prod-incident")).toBeLessThan(0.01);
    rollChallenges(s, noRng, c);
    expect(s.stocks.budget).toBe(1_000_000);
    expect(s.lastChallengeDay).toBeUndefined();
  });

  it("lets Company tech debt lift Production incident over a near-miss roll", () => {
    // Day 22: prod-incident rolls 0.0126, so base 1% misses and 2% (500 debt)
    // hits. scope-creep rolls 0.1896 and does not steal the slot.
    const c = loadShippedContent("company");
    const miss = initialState(c);
    miss.completedProjects = 1;
    miss.stocks.budget = 1_000_000;
    miss.stocks.techDebt = 0;
    miss.day = 22;
    expect(hashRoll(SEED, 22, "scope-creep")).toBeGreaterThanOrEqual(0.01);
    expect(hashRoll(SEED, 22, "prod-incident")).toBeGreaterThanOrEqual(0.01);
    expect(hashRoll(SEED, 22, "prod-incident")).toBeLessThan(0.02);
    rollChallenges(miss, noRng, c);
    expect(miss.stocks.budget).toBe(1_000_000);

    const hit = initialState(c);
    hit.completedProjects = 1;
    hit.stocks.budget = 1_000_000;
    hit.stocks.reputation = 5;
    hit.stocks.users = 40;
    hit.stocks.techDebt = 500;
    hit.day = 22;
    rollChallenges(hit, noRng, c);
    expect(hit.stocks.budget).toBe(992_000);
    expect(hit.log.some((l) => l.message.includes("Production incident"))).toBe(true);
  });

  it("scales probability with tech debt: a probScaling challenge fires only once debt lifts its probability", () => {
    // probScaling is the unit under test, isolated from roll luck: base p 0,
    // +0.5 per 500 debt. At debt 0 the probability is 0 (never fires); at debt
    // 1000 it is 1.0 (always fires), independent of the hashed roll value.
    const challenges = parseChallenges([
      {
        id: "debt-incident",
        name: "Debt incident",
        description: "desc",
        probabilityPerDay: 0,
        probScaling: { stat: "techDebt", per: 500, add: 0.5 },
        effects: [{ type: "addToStock", stock: "budget", value: -100 }],
      },
    ]);
    const c: GameContent = { start: parseStartConfig(startJson), decisions: [], challenges, projects: [] };

    const low = initialState(c);
    low.day = 20;
    low.stocks.techDebt = 0;
    rollChallenges(low, noRng, c);
    expect(low.stocks.budget).toBe(10000); // p 0: never

    const high = initialState(c);
    high.day = 20;
    high.stocks.techDebt = 1000;
    rollChallenges(high, noRng, c);
    expect(high.stocks.budget).toBe(9900); // p 1.0: always
  });

  it("queues a pending choice instead of applying effects, and expiry applies the default", () => {
    // Fixture with probability 1.0 so the queue/expiry flow is exercised
    // regardless of the roll value.
    const challenges = parseChallenges([
      {
        id: "always-choice",
        name: "Always Choice",
        description: "desc",
        probabilityPerDay: 1.0,
        cooldownDays: 5, // so the expiry-day default doesn't immediately re-queue
        effects: [],
        choice: {
          expiresInDays: 3,
          defaultOptionId: "default-opt",
          options: [
            { id: "pay", label: "Pay", effects: [{ type: "addToStock", stock: "budget", value: -150 }] },
            { id: "default-opt", label: "Default", effects: [{ type: "modifyRate", target: "all", op: "mul", value: 0.85, durationDays: 10 }] },
          ],
        },
      },
    ]);
    const c: GameContent = { start: parseStartConfig(startJson), decisions: [], challenges, projects: [] };
    const s = initialState(c);
    s.day = 20;
    rollChallenges(s, noRng, c);
    expect(s.pendingChoices).toHaveLength(1);
    expect(s.pendingChoices[0].expiresDay).toBe(23); // day 20 + expiresInDays 3
    expect(s.stocks.budget).toBe(10000); // nothing applied yet

    s.day = 23;
    rollChallenges(s, noRng, c); // expiry pass runs first, applies the default
    expect(s.pendingChoices).toHaveLength(0);
    expect(s.modifiers.some((m) => m.value === 0.85)).toBe(true); // default: let them go
  });

  it("resolveChoice applies the chosen option and clears the pending choice", () => {
    const c = content();
    const s = initialState(c);
    s.pendingChoices.push({ challengeId: "model-deprecation", expiresDay: 10 });
    resolveChoice(s, c, "model-deprecation", "pay-migration");
    expect(s.stocks.budget).toBe(9700); // 10000 - 300
    expect(s.pendingChoices).toHaveLength(0);
  });

  it("resolveChoice's other option applies its modifier instead of the cash cost", () => {
    const c = content();
    const s = initialState(c);
    s.pendingChoices.push({ challengeId: "model-deprecation", expiresDay: 10 });
    resolveChoice(s, c, "model-deprecation", "degraded-fallback");
    expect(s.stocks.budget).toBe(10000); // no cash paid
    expect(s.modifiers.some((m) => m.target === "finish" && m.op === "mul" && m.value === 0.7)).toBe(true);
  });

  // The shipped Studio pool has no removeHuman challenge (hire drama left with
  // issue #89's lean pool), so the effect's engine wiring is pinned against a
  // fixture rather than content. It stays supported for later eras.
  function poachChallenge() {
    return parseChallenges([
      {
        id: "key-dev-poached",
        name: "Key developer poached",
        description: "desc",
        probabilityPerDay: 1.0,
        condition: { minHumanDevs: 1 },
        cooldownDays: 60,
        effects: [],
        choice: {
          expiresInDays: 3,
          defaultOptionId: "let-them-go",
          options: [
            { id: "match-offer", label: "Match the offer ($150)", effects: [{ type: "addToStock", stock: "budget", value: -150 }] },
            {
              id: "let-them-go",
              label: "Let them go",
              effects: [{ type: "removeHuman" }, { type: "modifyRate", target: "all", op: "mul", value: 0.85, durationDays: 10 }],
            },
          ],
        },
      },
    ]);
  }

  function poachContent(): GameContent {
    return {
      start: { ...parseStartConfig(startJson), challengeSpacingDays: 0 },
      decisions: parseDecisions(decisionsJson),
      challenges: poachChallenge(),
      projects: [],
    };
  }

  it("a let-them-go choice removes the targeted human and keeps the disruption mul", () => {
    const c = poachContent();
    const s = initialState(c);
    applyDecision(s, c, "basic-dev", createRng(1));
    const human = s.decisions.find((d) => d.defId === "basic-dev")!;
    expect(human).toBeDefined();
    // Second non-human ownership stays so we can prove only the human left.
    applyDecision(s, c, "agent", createRng(2));
    const beforeCount = s.decisions.length;

    s.pendingChoices.push({
      challengeId: "key-dev-poached",
      expiresDay: 10,
      targetInstanceId: human.instanceId,
    });
    resolveChoice(s, c, "key-dev-poached", "let-them-go");

    expect(s.decisions.some((d) => d.instanceId === human.instanceId)).toBe(false);
    expect(s.decisions.some((d) => d.defId === "basic-dev")).toBe(false);
    expect(s.decisions.some((d) => d.defId === "agent")).toBe(true);
    expect(s.decisions.length).toBe(beforeCount - 1);
    expect(s.modifiers.some((m) => m.target === "allRates" && m.value === 0.85)).toBe(true);
    expect(s.log.some((l) => l.message.startsWith("Lost:"))).toBe(true);
  });

  it("an expiry default that removes a human still removes one (let-them-go is defaultOptionId)", () => {
    const c = poachContent();
    const s = initialState(c);
    applyDecision(s, c, "basic-dev", createRng(1));
    const human = s.decisions.find((d) => d.defId === "basic-dev")!;
    s.pendingChoices.push({
      challengeId: "key-dev-poached",
      expiresDay: 5,
      targetInstanceId: human.instanceId,
    });
    s.day = 5;
    rollChallenges(s, noRng, c);
    expect(s.pendingChoices).toHaveLength(0);
    expect(s.decisions.some((d) => d.defId === "basic-dev")).toBe(false);
    expect(s.modifiers.some((m) => m.value === 0.85)).toBe(true);
  });

  it("queuing a removeHuman choice pins targetInstanceId to a human on staff", () => {
    const c = poachContent();
    const s = initialState(c);
    applyDecision(s, c, "basic-dev", createRng(1));
    const humanId = s.decisions.find((d) => d.defId === "basic-dev")!.instanceId;
    s.day = 20;
    rollChallenges(s, noRng, c);
    expect(s.pendingChoices).toHaveLength(1);
    expect(s.pendingChoices[0].targetInstanceId).toBe(humanId);
  });

  it("perHumanDev challenges roll each human dev independently: same day, one instance sick and the other not", () => {
    // Fixture: the lean Studio pool ships no perHumanDev challenge (sickness
    // left with the hire drama, issue #89), but the per-instance roll keying is
    // engine behavior later eras rely on. The fixture keeps the "sickness" id so
    // the pinned rolls below are the same ones this test has always used.
    const challenges = parseChallenges([
      {
        id: "sickness",
        name: "Sickness",
        description: "desc",
        probabilityPerDay: 0.1,
        perHumanDev: true,
        condition: { minHumanDevs: 1 },
        effects: [{ type: "sickness", factor: 0.7, durationDays: 5 }],
      },
    ]);
    const c: GameContent = {
      start: parseStartConfig(startJson),
      decisions: parseDecisions(decisionsJson),
      challenges,
      projects: [],
    };
    const s = initialState(c);
    s.decisions.push({ instanceId: "i1", defId: "basic-dev" }, { instanceId: "i2", defId: "basic-dev" });
    // Day 30 is pinned so the two per-instance rolls land on opposite sides of
    // sickness's 0.1 probability, proving the rolls are independent per
    // instance (keyed by instanceId): i1 = 0.021 < 0.1 (sick), i2 = 0.113 (not).
    s.day = 30;
    expect(hashRoll(SEED, 30, "sickness:i1")).toBeLessThan(0.1);
    expect(hashRoll(SEED, 30, "sickness:i2")).toBeGreaterThanOrEqual(0.1);
    rollChallenges(s, noRng, c);
    expect(s.decisions[0].sickUntilDay).toBe(35); // day 30 + durationDays 5
    expect(s.decisions[1].sickUntilDay).toBeUndefined();
  });

  it("different challenges get independent rolls on the same day", () => {
    // Two challenges with identical probability 0.5 but distinct ids; on the
    // pinned day their hashed rolls diverge (one under, one over 0.5), so only
    // one fires. Positional draws could never produce this from a single day.
    const challenges = parseChallenges([
      { id: "chalA", name: "A", description: "d", probabilityPerDay: 0.5, effects: [{ type: "addToStock", stock: "backlog", value: 10 }] },
      { id: "chalB", name: "B", description: "d", probabilityPerDay: 0.5, effects: [{ type: "addToStock", stock: "done", value: 10 }] },
    ]);
    const c: GameContent = { start: parseStartConfig(startJson), decisions: [], challenges, projects: [] };
    const s = initialState(c);
    // Day 3: hashRoll(SEED, 3, "chalA") = 0.111 < 0.5 (fires); "chalB" = 0.527 (not).
    s.day = 3;
    expect(hashRoll(SEED, 3, "chalA")).toBeLessThan(0.5);
    expect(hashRoll(SEED, 3, "chalB")).toBeGreaterThanOrEqual(0.5);
    rollChallenges(s, noRng, c);
    expect(s.stocks.backlog).toBe(310); // chalA fired: +10 (Studio start backlog 300)
    expect(s.stocks.done).toBe(0); // chalB did not
  });

  it("KEY REGRESSION: adding a challenge to content does not change an existing challenge's roll or touch the shared stream", () => {
    // Before this task, challenge rolls were positional draws off the shared
    // seeded stream, so inserting any challenge reshuffled every later draw.
    // Now each challenge hashes on its own id, so an inserted challenge must
    // leave the original's outcome (and the untouched main stream) identical.
    const original = {
      id: "chalX",
      name: "X",
      description: "d",
      probabilityPerDay: 0.5,
      effects: [{ type: "addToStock" as const, stock: "budget" as const, value: -100 }],
    };
    const extra = {
      id: "chalExtra",
      name: "Extra",
      description: "d",
      probabilityPerDay: 1.0, // always fires; affects a different stock (backlog)
      effects: [{ type: "addToStock" as const, stock: "backlog" as const, value: 999 }],
    };

    const run = (defs: unknown[]) => {
      // challengeSpacingDays: 0 -- this test is about per-challenge hash
      // stability, not the global spacing gap (Release 9); at the shipped
      // spacing of 50 days, chalExtra firing first would break out of the
      // roll loop before chalX's turn, which is a different (also correct)
      // behavior this test doesn't intend to exercise. See the "global event
      // spacing" describe block below for that.
      const c: GameContent = {
        start: { ...parseStartConfig(startJson), challengeSpacingDays: 0 },
        decisions: [],
        challenges: parseChallenges(defs),
        projects: [],
      };
      const s = initialState(c);
      // Day 1: hashRoll(SEED, 1, "chalX") = 0.055 < 0.5, so chalX fires in both runs.
      s.day = 1;
      const rng = createRng(999);
      const rngBefore = rng.getState();
      rollChallenges(s, rng, c);
      return { budget: s.stocks.budget, rngAdvanced: rng.getState() !== rngBefore };
    };

    // Insert the extra challenge BEFORE chalX -- the position that positional
    // draws were most sensitive to.
    const a = run([original]);
    const b = run([extra, original]);

    expect(a.budget).toBe(9900); // chalX fired: -100
    expect(b.budget).toBe(9900); // identical despite the inserted challenge
    expect(a.rngAdvanced).toBe(false); // challenge phase never advances the shared stream
    expect(b.rngAdvanced).toBe(false);
  });
});

describe("model-deprecation (requiresAnyDecision)", () => {
  it("fires and queues its choice on a firing day once an agent-line decision is owned", () => {
    const c = content();
    const s = initialState(c);
    applyDecision(s, c, "agent", createRng(1));
    // Day 216: hashRoll(SEED, 216, "model-deprecation") ≈ 0.0007, under the
    // retuned 0.1%/day probability (issue #118).
    s.day = 216;
    expect(hashRoll(SEED, 216, "model-deprecation")).toBeLessThan(0.001);
    rollChallenges(s, noRng, c);
    const pending = s.pendingChoices.find((pc) => pc.challengeId === "model-deprecation");
    expect(pending).toBeDefined();
    expect(pending!.expiresDay).toBe(220); // day 216 + expiresInDays 4
  });

  it("stays eligible when agent is removed while the later agent-harness card remains owned", () => {
    const c = content();
    const s = initialState(c);
    applyDecision(s, c, "agent", createRng(1));
    applyDecision(s, c, "agent-harness", createRng(2));
    const agent = s.decisions.find((d) => d.defId === "agent")!;
    removeDecision(s, c, agent.instanceId);
    expect(s.decisions.map((d) => d.defId)).toContain("agent-harness");
    expect(s.decisions.map((d) => d.defId)).not.toContain("agent");

    s.day = 216;
    rollChallenges(s, noRng, c);
    expect(s.pendingChoices.some((pc) => pc.challengeId === "model-deprecation")).toBe(true);
  });

  it("is condition-gated: never fires without an agent-line decision owned, even at probability 1.0", () => {
    const challenges = parseChallenges([
      {
        id: "model-deprecation",
        name: "Model deprecation",
        description: "desc",
        probabilityPerDay: 1.0, // would always fire if the condition allowed a roll
        condition: {
          requiresAnyDecision: ["agent", "agent-harness", "agent-orchestration"],
        },
        cooldownDays: 80,
        effects: [],
        choice: {
          expiresInDays: 4,
          defaultOptionId: "pay-migration",
          options: [
            { id: "pay-migration", label: "Pay", effects: [] },
            { id: "degraded-fallback", label: "Degrade", effects: [] },
          ],
        },
      },
    ]);
    const c: GameContent = { start: parseStartConfig(startJson), decisions: [], challenges, projects: [] };
    const s = initialState(c);
    s.day = 20;
    rollChallenges(s, noRng, c);
    expect(s.pendingChoices).toHaveLength(0);
  });
});

describe("challenge cooldowns", () => {
  it("a non-choice challenge fires, is blocked for the cooldown window, then fires again once it elapses", () => {
    const challenges = parseChallenges([
      {
        id: "test-cooldown",
        name: "Test Cooldown",
        description: "desc",
        probabilityPerDay: 1.0, // always fires whenever actually rolled
        cooldownDays: 5,
        effects: [{ type: "addToStock", stock: "budget", value: -10 }],
      },
    ]);
    // challengeSpacingDays: 0 -- this test is about cooldownDays (5 days),
    // orthogonal to the global spacing gap (Release 9), which at the shipped
    // 50 days would swallow this challenge's whole re-fire window.
    const c: GameContent = { start: { ...parseStartConfig(startJson), challengeSpacingDays: 0 }, decisions: [], challenges, projects: [] };
    const s = initialState(c);

    s.day = 20;
    rollChallenges(s, noRng, c);
    expect(s.stocks.budget).toBe(9990);
    expect(s.challengeLastFired["test-cooldown"]).toBe(20);

    for (let day = 21; day <= 24; day++) {
      s.day = day;
      rollChallenges(s, noRng, c);
      expect(s.stocks.budget).toBe(9990); // unchanged: still cooling down
    }

    s.day = 25;
    rollChallenges(s, noRng, c);
    expect(s.stocks.budget).toBe(9980);
    expect(s.challengeLastFired["test-cooldown"]).toBe(25);
  });

  it("a resolved choice challenge cannot re-queue until its cooldown elapses, then re-queues", () => {
    const challenges = parseChallenges([
      {
        id: "test-choice-cooldown",
        name: "Test Choice Cooldown",
        description: "desc",
        probabilityPerDay: 1.0,
        cooldownDays: 4,
        effects: [],
        choice: {
          expiresInDays: 3,
          defaultOptionId: "opt-default",
          options: [
            { id: "opt-a", label: "Option A", effects: [{ type: "addToStock", stock: "budget", value: -10 }] },
            { id: "opt-default", label: "Default", effects: [{ type: "addToStock", stock: "budget", value: -20 }] },
          ],
        },
      },
    ]);
    // challengeSpacingDays: 0 -- isolates cooldownDays (4 days) from the
    // global spacing gap; see the "KEY REGRESSION" test above for the
    // rationale.
    const c: GameContent = { start: { ...parseStartConfig(startJson), challengeSpacingDays: 0 }, decisions: [], challenges, projects: [] };
    const s = initialState(c);

    s.day = 20;
    rollChallenges(s, noRng, c); // queues the pending choice; queueing alone does not start the clock
    expect(s.pendingChoices).toHaveLength(1);
    expect(s.challengeLastFired["test-choice-cooldown"]).toBeUndefined();

    resolveChoice(s, c, "test-choice-cooldown", "opt-a");
    expect(s.stocks.budget).toBe(9990);
    expect(s.challengeLastFired["test-choice-cooldown"]).toBe(20); // resolution starts the clock

    for (let day = 21; day <= 23; day++) {
      s.day = day;
      rollChallenges(s, noRng, c);
      expect(s.pendingChoices).toHaveLength(0); // still cooling down: no re-queue
    }

    s.day = 24;
    rollChallenges(s, noRng, c);
    expect(s.pendingChoices).toHaveLength(1); // cooldown elapsed: re-queues
  });

  it("an expired choice challenge starts its cooldown clock at the expiry day", () => {
    const challenges = parseChallenges([
      {
        id: "test-choice-expiry-cooldown",
        name: "Test Choice Expiry Cooldown",
        description: "desc",
        probabilityPerDay: 1.0,
        cooldownDays: 4,
        effects: [],
        choice: {
          expiresInDays: 3,
          defaultOptionId: "opt-default",
          options: [
            { id: "opt-a", label: "Option A", effects: [{ type: "addToStock", stock: "budget", value: -10 }] },
            { id: "opt-default", label: "Default", effects: [{ type: "addToStock", stock: "budget", value: -20 }] },
          ],
        },
      },
    ]);
    // challengeSpacingDays: 0 -- isolates cooldownDays (4 days) from the
    // global spacing gap; see the "KEY REGRESSION" test above for the
    // rationale.
    const c: GameContent = { start: { ...parseStartConfig(startJson), challengeSpacingDays: 0 }, decisions: [], challenges, projects: [] };
    const s = initialState(c);

    s.day = 20;
    rollChallenges(s, noRng, c); // queues; expiresDay = 23
    expect(s.pendingChoices).toHaveLength(1);

    s.day = 23;
    rollChallenges(s, noRng, c); // expiry pass applies the default, then the per-def loop is now cooling down
    expect(s.pendingChoices).toHaveLength(0);
    expect(s.stocks.budget).toBe(9980);
    expect(s.challengeLastFired["test-choice-expiry-cooldown"]).toBe(23); // clock starts at the expiry day

    s.day = 26; // 26 < 23 + 4
    rollChallenges(s, noRng, c);
    expect(s.pendingChoices).toHaveLength(0); // still cooling down: no re-queue

    s.day = 27; // cooldown elapsed
    rollChallenges(s, noRng, c);
    expect(s.pendingChoices).toHaveLength(1); // re-queues
  });
});

describe("global event spacing (challengeSpacingDays)", () => {
  // Two always-fire (probabilityPerDay 1.0), no-cooldown challenges with
  // distinct effects (budget vs. backlog) so we can tell which one, if
  // either, actually fired. challengeA is first in the array, so on any day
  // both are eligible it wins the roll and (with spacing > 0) the same-tick
  // break stops challengeB from ever getting a turn -- that IS the feature
  // under test, not a gap in the fixture.
  function spacingChallenges() {
    return parseChallenges([
      {
        id: "challengeA",
        name: "A",
        description: "d",
        probabilityPerDay: 1.0,
        effects: [{ type: "addToStock", stock: "budget", value: -100 }],
      },
      {
        id: "challengeB",
        name: "B",
        description: "d",
        probabilityPerDay: 1.0,
        effects: [{ type: "addToStock", stock: "backlog", value: 50 }],
      },
    ]);
  }

  it("day 20 first challenge fires and breaks the tick; the gap blocks everything through day 29; day 30 fires again", () => {
    const challenges = spacingChallenges();
    const c: GameContent = {
      start: { ...parseStartConfig(startJson), challengeSpacingDays: 10 },
      decisions: [],
      challenges,
      projects: [],
    };
    const s = initialState(c);

    s.day = 20;
    rollChallenges(s, noRng, c);
    expect(s.stocks.budget).toBe(9900); // challengeA fired
    expect(s.stocks.backlog).toBe(300); // challengeB never got a turn: same-tick break (Studio start backlog 300)
    expect(s.lastChallengeDay).toBe(20);

    for (let day = 21; day <= 29; day++) {
      s.day = day;
      rollChallenges(s, noRng, c);
      expect(s.stocks.budget).toBe(9900); // gap active: no challenge rolled at all
      expect(s.stocks.backlog).toBe(300);
      expect(s.lastChallengeDay).toBe(20); // untouched while the gap holds
    }

    s.day = 30;
    rollChallenges(s, noRng, c); // day 30 >= lastChallengeDay(20) + spacingDays(10): gap clears
    expect(s.stocks.budget).toBe(9800); // challengeA fires again
    expect(s.lastChallengeDay).toBe(30);
  });

  it("expiry-default application during the gap still applies and does not reset the gap", () => {
    const challenges = parseChallenges([
      {
        id: "gap-choice",
        name: "Gap Choice",
        description: "d",
        probabilityPerDay: 1.0,
        effects: [],
        choice: {
          expiresInDays: 3,
          defaultOptionId: "default-opt",
          options: [
            { id: "pay", label: "Pay", effects: [{ type: "addToStock", stock: "budget", value: -150 }] },
            { id: "default-opt", label: "Default", effects: [{ type: "addToStock", stock: "budget", value: -300 }] },
          ],
        },
      },
    ]);
    const c: GameContent = {
      start: { ...parseStartConfig(startJson), challengeSpacingDays: 10 },
      decisions: [],
      challenges,
      projects: [],
    };
    const s = initialState(c);

    s.day = 20;
    rollChallenges(s, noRng, c); // queues; expiresDay = 23; queueing starts the gap
    expect(s.pendingChoices).toHaveLength(1);
    expect(s.lastChallengeDay).toBe(20);

    s.day = 23; // inside the gap (23 < 20 + 10)
    rollChallenges(s, noRng, c); // expiry pass runs regardless of the gap
    expect(s.pendingChoices).toHaveLength(0);
    expect(s.stocks.budget).toBe(9700); // default applied: -300
    expect(s.lastChallengeDay).toBe(20); // expiry-default does NOT reset the gap

    for (let day = 24; day <= 29; day++) {
      s.day = day;
      rollChallenges(s, noRng, c);
      expect(s.pendingChoices).toHaveLength(0); // gap still active: no re-queue
    }

    s.day = 30; // gap clears: fresh fire
    rollChallenges(s, noRng, c);
    expect(s.pendingChoices).toHaveLength(1);
    expect(s.lastChallengeDay).toBe(30);
  });

  it("challengeSpacingDays: 0 disables the gap and preserves legacy same-tick multi-fire", () => {
    const challenges = spacingChallenges();
    const c: GameContent = {
      start: { ...parseStartConfig(startJson), challengeSpacingDays: 0 },
      decisions: [],
      challenges,
      projects: [],
    };
    const s = initialState(c);

    s.day = 20;
    rollChallenges(s, noRng, c);
    expect(s.stocks.budget).toBe(9900); // challengeA fired
    expect(s.stocks.backlog).toBe(350); // challengeB ALSO fired: no break when spacing is 0 (Studio start backlog 300)
    expect(s.lastChallengeDay).toBe(20); // still tracked even though it's inert at spacing 0

    s.day = 21; // day after a fire: would be blocked at spacing > 0, but 0 disables the gap
    rollChallenges(s, noRng, c);
    expect(s.stocks.budget).toBe(9800); // fires again immediately, same as pre-Release-9 behavior
  });
});

describe("lacksDecision condition", () => {
  function lacksDecisionChallenge() {
    // "agent" is a real shipped decision id (content/decisions.json); reusing
    // it here avoids inventing shipped content for a fixture-only check
    // (Task 34 adds a real content use). probabilityPerDay 1.0 makes the
    // condition gate the only variable.
    return parseChallenges([
      {
        id: "no-agent-yet",
        name: "No Agent Yet",
        description: "d",
        probabilityPerDay: 1.0,
        condition: { lacksDecision: "agent" },
        effects: [{ type: "addToStock", stock: "budget", value: -50 }],
      },
    ]);
  }

  it("fires while the decision is unowned", () => {
    const c: GameContent = {
      start: { ...parseStartConfig(startJson), challengeSpacingDays: 0 },
      decisions: parseDecisions(decisionsJson),
      challenges: lacksDecisionChallenge(),
      projects: [],
    };
    const s = initialState(c);
    s.day = 20;
    rollChallenges(s, noRng, c);
    expect(s.stocks.budget).toBe(9950);
  });

  it("never rolls once the decision is owned", () => {
    const c: GameContent = {
      start: { ...parseStartConfig(startJson), challengeSpacingDays: 0 },
      decisions: parseDecisions(decisionsJson),
      challenges: lacksDecisionChallenge(),
      projects: [],
    };
    const s = initialState(c);
    applyDecision(s, c, "agent", createRng(1)); // $10 oneTime cost: budget -> 9990
    s.day = 20;
    rollChallenges(s, noRng, c);
    expect(s.stocks.budget).toBe(9990); // unchanged by the challenge: condition gates it out entirely
  });
});
