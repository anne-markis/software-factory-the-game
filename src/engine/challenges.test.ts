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
  it("fires an unconditional challenge when the roll is under its probability", () => {
    const c = content();
    const s = initialState(c);
    s.day = 1;
    // challenge order: sickness (skipped: 0 human devs), ddos 0.05, scope-creep 0.1, prod-incident, laptop-dies 0.03, poached (skipped)
    rollChallenges(s, scriptedRng([0.04]), c); // ddos fires
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
    s.day = 1;
    s.stocks.techDebt = 2000; // 0.01 base + 4 * 0.01 = 0.05
    // skip ddos (0.99) and scope-creep (0.99), then 0.04 < 0.05 fires incident
    rollChallenges(s, scriptedRng([0.99, 0.99, 0.04]), c);
    expect(s.log.some((l) => l.message.includes("Production incident"))).toBe(true);
  });

  it("queues a pending choice instead of applying effects, and expiry applies the default", () => {
    const c = content();
    const s = initialState(c);
    s.decisions.push({ instanceId: "i1", defId: "basic-dev" });
    s.day = 1;
    // sickness roll for 1 human dev (0.99: no), ddos no, scope no, incident no, poached yes (0.01 < 0.02)
    rollChallenges(s, scriptedRng([0.99, 0.99, 0.99, 0.99, 0.01]), c);
    expect(s.pendingChoices).toHaveLength(1);
    expect(s.pendingChoices[0].expiresDay).toBe(4);
    expect(s.stocks.budget).toBe(10000); // nothing applied yet

    s.day = 4;
    rollChallenges(s, scriptedRng([]), c); // expiry pass runs first
    expect(s.pendingChoices).toHaveLength(0);
    expect(s.modifiers.some((m) => m.value === 0.85)).toBe(true); // default: let them go
  });

  it("resolveChoice applies the chosen option and clears the pending choice", () => {
    const c = content();
    const s = initialState(c);
    s.pendingChoices.push({ challengeId: "key-dev-poached", expiresDay: 10 });
    resolveChoice(s, c, "key-dev-poached", "match-offer");
    expect(s.stocks.budget).toBe(9200);
    expect(s.pendingChoices).toHaveLength(0);
  });

  it("sickness targets each human dev independently", () => {
    const c = content();
    const s = initialState(c);
    s.decisions.push({ instanceId: "i1", defId: "basic-dev" }, { instanceId: "i2", defId: "basic-dev" });
    s.day = 1;
    // per-dev rolls: i1 fires (0.05), i2 does not (0.99); remaining challenges no
    rollChallenges(s, scriptedRng([0.05, 0.99, 0.99, 0.99, 0.99, 0.99]), c);
    expect(s.decisions[0].sickUntilDay).toBe(6);
    expect(s.decisions[1].sickUntilDay).toBeUndefined();
  });
});
