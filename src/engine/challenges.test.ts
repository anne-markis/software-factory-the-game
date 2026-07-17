import { describe, it, expect } from "vitest";
import { rollChallenges, resolveChoice } from "./challenges";
import { initialState } from "./engine";
import { parseStartConfig, parseChallenges, parseDecisions } from "./content";
import startJson from "../../content/start.json";
import challengesJson from "../../content/challenges.json";
import decisionsJson from "../../content/decisions.json";
import type { GameContent } from "./types";
import type { Rng } from "./rng";

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
