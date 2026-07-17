import { describe, it, expect } from "vitest";
import { rollChallenges, resolveChoice } from "./challenges";
import { initialState } from "./engine";
import { parseStartConfig, parseChallenges, parseDecisions } from "./content";
import startJson from "../../content/start.json";
import challengesJson from "../../content/challenges.json";
import decisionsJson from "../../content/decisions.json";
import type { GameContent } from "./types";
import type { Rng } from "./rng";

// counts how many times next() is drawn, always returning `value`; lets tests
// prove a cooldown-gated def is skipped WITHOUT consuming an rng draw
function countingRng(value: number): { rng: Rng; calls: () => number } {
  let n = 0;
  return { rng: { next: () => { n++; return value; }, getState: () => 0 }, calls: () => n };
}

function content(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: parseChallenges(challengesJson),
    projects: [],
  };
}

// rng that returns a scripted sequence, then 0.99 forever (nothing fires)
function scriptedRng(values: number[]): Rng {
  let i = 0;
  return { next: () => (i < values.length ? values[i++] : 0.99), getState: () => 0 };
}

describe("rollChallenges", () => {
  it("content order matches what the scripted rng sequences assume", () => {
    // every scripted array below encodes this order; if this fails, fix the scripts too
    expect(content().challenges.map((c) => c.id)).toEqual([
      "sickness", "ddos", "scope-creep", "prod-incident", "laptop-dies", "key-dev-poached",
    ]);
  });

  it("fires an unconditional challenge when the roll is under its probability", () => {
    const c = content();
    const s = initialState(c);
    // day 20: past the minDay:15 grace period so ddos/scope-creep/prod-incident/laptop-dies are live
    s.day = 20;
    // challenge order: sickness (skipped: 0 human devs), ddos 0.03, scope-creep 0.04, prod-incident, laptop-dies 0.01, poached (skipped)
    rollChallenges(s, scriptedRng([0.02]), c); // ddos fires
    expect(s.stocks.budget).toBe(9900);
    expect(s.log.some((l) => l.message.includes("DDoS"))).toBe(true);
  });

  it("respects conditions: sickness never fires with zero human devs", () => {
    const c = content();
    const s = initialState(c);
    s.day = 1;
    rollChallenges(s, scriptedRng([0.0, 0.99, 0.99, 0.99, 0.99, 0.99]), c);
    expect(s.decisions.every((d) => d.sickUntilDay === undefined)).toBe(true);
  });

  it("scales prod-incident probability with tech debt", () => {
    const c = content();
    const s = initialState(c);
    s.day = 20; // past the minDay:15 grace period
    s.stocks.techDebt = 2000; // 0.01 base + 4 * 0.01 = 0.05
    // skip ddos (0.99) and scope-creep (0.99), then 0.04 < 0.05 fires incident
    rollChallenges(s, scriptedRng([0.99, 0.99, 0.04]), c);
    expect(s.log.some((l) => l.message.includes("Production incident"))).toBe(true);
  });

  it("queues a pending choice instead of applying effects, and expiry applies the default", () => {
    const c = content();
    const s = initialState(c);
    s.decisions.push({ instanceId: "i1", defId: "basic-dev" });
    // day 20: past the minDay:15 grace period; laptop-dies is gated out here because
    // its condition requires maxHumanDevs:0 and this scenario has 1 human dev
    s.day = 20;
    // sickness roll for 1 human dev (0.99: no), ddos no, scope no, incident no, poached yes (0.01 < 0.02)
    rollChallenges(s, scriptedRng([0.99, 0.99, 0.99, 0.99, 0.01]), c);
    expect(s.pendingChoices).toHaveLength(1);
    expect(s.pendingChoices[0].expiresDay).toBe(23); // day 20 + expiresInDays 3
    expect(s.stocks.budget).toBe(10000); // nothing applied yet

    s.day = 23;
    rollChallenges(s, scriptedRng([]), c); // expiry pass runs first
    expect(s.pendingChoices).toHaveLength(0);
    expect(s.modifiers.some((m) => m.value === 0.85)).toBe(true); // default: let them go
  });

  it("resolveChoice applies the chosen option and clears the pending choice", () => {
    const c = content();
    const s = initialState(c);
    s.pendingChoices.push({ challengeId: "key-dev-poached", expiresDay: 10 });
    resolveChoice(s, c, "key-dev-poached", "match-offer");
    expect(s.stocks.budget).toBe(9850); // 10000 - 150
    expect(s.pendingChoices).toHaveLength(0);
  });

  it("sickness targets each human dev independently", () => {
    const c = content();
    const s = initialState(c);
    s.decisions.push({ instanceId: "i1", defId: "basic-dev" }, { instanceId: "i2", defId: "basic-dev" });
    // day 20: past the minDay:15 grace period; laptop-dies is gated out by maxHumanDevs:0 (2 devs here)
    s.day = 20;
    // per-dev rolls: i1 fires (0.05), i2 does not (0.99); remaining challenges no
    rollChallenges(s, scriptedRng([0.05, 0.99, 0.99, 0.99, 0.99, 0.99]), c);
    expect(s.decisions[0].sickUntilDay).toBe(25); // day 20 + durationDays 5
    expect(s.decisions[1].sickUntilDay).toBeUndefined();
  });
});

describe("challenge cooldowns", () => {
  it("a non-choice challenge fires, then is blocked for the cooldown window without consuming an rng draw, then fires again once it elapses", () => {
    const challenges = parseChallenges([
      {
        id: "test-cooldown",
        name: "Test Cooldown",
        description: "desc",
        probabilityPerDay: 1.0,
        cooldownDays: 5,
        effects: [{ type: "addToStock", stock: "budget", value: -10 }],
      },
    ]);
    const c: GameContent = { start: parseStartConfig(startJson), decisions: [], challenges, projects: [] };
    const s = initialState(c);
    const { rng, calls } = countingRng(0.0); // always < probability 1.0, so it fires whenever actually rolled

    s.day = 20;
    rollChallenges(s, rng, c);
    expect(s.stocks.budget).toBe(9990);
    expect(s.challengeLastFired["test-cooldown"]).toBe(20);
    expect(calls()).toBe(1);

    for (let day = 21; day <= 24; day++) {
      s.day = day;
      rollChallenges(s, rng, c);
      expect(s.stocks.budget).toBe(9990); // unchanged: still cooling down
      expect(calls()).toBe(1); // no rng draw consumed while cooling, same rule as minDay/condition gates
    }

    s.day = 25;
    rollChallenges(s, rng, c);
    expect(s.stocks.budget).toBe(9980);
    expect(s.challengeLastFired["test-cooldown"]).toBe(25);
    expect(calls()).toBe(2);
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
    const c: GameContent = { start: parseStartConfig(startJson), decisions: [], challenges, projects: [] };
    const s = initialState(c);
    const rng = scriptedRng([]); // fallback 0.99 < probability 1.0, always fires when actually rolled

    s.day = 20;
    rollChallenges(s, rng, c); // queues the pending choice; queueing alone does not start the clock
    expect(s.pendingChoices).toHaveLength(1);
    expect(s.challengeLastFired["test-choice-cooldown"]).toBeUndefined();

    resolveChoice(s, c, "test-choice-cooldown", "opt-a");
    expect(s.stocks.budget).toBe(9990);
    expect(s.challengeLastFired["test-choice-cooldown"]).toBe(20); // resolution starts the clock

    for (let day = 21; day <= 23; day++) {
      s.day = day;
      rollChallenges(s, rng, c);
      expect(s.pendingChoices).toHaveLength(0); // still cooling down: no re-queue
    }

    s.day = 24;
    rollChallenges(s, rng, c);
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
    const c: GameContent = { start: parseStartConfig(startJson), decisions: [], challenges, projects: [] };
    const s = initialState(c);
    const rng = scriptedRng([]); // fallback 0.99 < probability 1.0, always fires when actually rolled

    s.day = 20;
    rollChallenges(s, rng, c); // queues; expiresDay = 23
    expect(s.pendingChoices).toHaveLength(1);

    s.day = 23;
    rollChallenges(s, rng, c); // expiry pass applies the default, then the per-def loop tries to re-queue but is now cooling down
    expect(s.pendingChoices).toHaveLength(0);
    expect(s.stocks.budget).toBe(9980);
    expect(s.challengeLastFired["test-choice-expiry-cooldown"]).toBe(23); // clock starts at the expiry day

    s.day = 26; // 26 < 23 + 4
    rollChallenges(s, rng, c);
    expect(s.pendingChoices).toHaveLength(0); // still cooling down: no re-queue

    s.day = 27; // cooldown elapsed
    rollChallenges(s, rng, c);
    expect(s.pendingChoices).toHaveLength(1); // re-queues
  });
});
