import { describe, it, expect } from "vitest";
import { parseStartConfig, parseDecisions, parseChallenges } from "./content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import challengesJson from "../../content/challenges.json";

describe("parseStartConfig", () => {
  it("parses the shipped start.json", () => {
    const cfg = parseStartConfig(startJson);
    expect(cfg.stocks.backlog).toBe(1500);
    expect(cfg.stocks.budget).toBe(10000);
    expect(cfg.debtMultiplier).toBe(0.5);
    expect(cfg.baseRates.pull).toBe(1);
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
    expect(ids).toEqual(["test-suite", "ci-cd", "basic-dev", "agent", "agent-harness"]);
    const dev = defs.find((d) => d.id === "basic-dev")!;
    expect(dev.cost.perDay).toBe(7);
    expect(dev.gamble!.reduce((sum, o) => sum + o.probability, 0)).toBeCloseTo(1);
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
});
