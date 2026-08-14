import { describe, it, expect } from "vitest";
import { summarizeDecisionEffects } from "./effectSummary";
import { parseDecisions } from "../engine/content";
import { decisionsJson } from "../engine/loadShippedContent";
import type { DecisionDef } from "../engine/types";

function base(overrides: Partial<DecisionDef>): DecisionDef {
  return {
    id: "x",
    name: "x",
    description: "x",
    category: "ship-faster",
    cost: {},
    effects: [],
    removable: true,
    ...overrides,
  };
}

describe("summarizeDecisionEffects", () => {
  it("modifyRate mul on all", () => {
    const def = base({ effects: [{ type: "modifyRate", target: "all", op: "mul", value: 1.8 }] });
    expect(summarizeDecisionEffects(def)).toBe("all rates x1.8");
  });

  it("modifyRate mul on a single rate", () => {
    const def = base({ effects: [{ type: "modifyRate", target: "finish", op: "mul", value: 1.2 }] });
    expect(summarizeDecisionEffects(def)).toBe("finish x1.2");
  });

  it("modifyRate add on all, whole-number-friendly formatting", () => {
    const def = base({ effects: [{ type: "modifyRate", target: "all", op: "add", value: 0.1 }] });
    expect(summarizeDecisionEffects(def)).toBe("all rates +0.1/day");
  });

  it("modifyRate add on a single rate keeps whole numbers whole", () => {
    const def = base({ effects: [{ type: "modifyRate", target: "pull", op: "add", value: 1.0 }] });
    expect(summarizeDecisionEffects(def)).toBe("pull +1/day");
  });

  it("modifyRate add with a negative value keeps its sign", () => {
    const def = base({ effects: [{ type: "modifyRate", target: "pull", op: "add", value: -0.5 }] });
    expect(summarizeDecisionEffects(def)).toBe("pull -0.5/day");
  });

  it("modifyDebtMultiplier", () => {
    const def = base({ effects: [{ type: "modifyDebtMultiplier", op: "mul", value: 0.5 }] });
    expect(summarizeDecisionEffects(def)).toBe("debt x0.5");
  });

  it("addToStock preserves sign", () => {
    const def = base({ effects: [{ type: "addToStock", stock: "budget", value: -100 }] });
    expect(summarizeDecisionEffects(def)).toBe("budget -100");
  });

  it("scaleStock with factor < 1 renders a reduction percentage", () => {
    const def = base({ effects: [{ type: "scaleStock", stock: "techDebt", factor: 0.7 }] });
    expect(summarizeDecisionEffects(def)).toBe("debt -30%");
  });

  it("scaleStock with factor > 1 renders an increase percentage", () => {
    const def = base({ effects: [{ type: "scaleStock", stock: "techDebt", factor: 1.5 }] });
    expect(summarizeDecisionEffects(def)).toBe("debt +50%");
  });

  it("rampRate", () => {
    const def = base({ effects: [{ type: "rampRate", target: "finish", perDay: 0.02, cap: 1.4 }] });
    expect(summarizeDecisionEffects(def)).toBe("finish +0.02/day up to +1.4");
  });

  it("continuousDeploy", () => {
    const def = base({ effects: [{ type: "continuousDeploy" }] });
    expect(summarizeDecisionEffects(def)).toBe("removes the Done stage");
  });

  it("incomePerDay is included as a def field, not an effect", () => {
    const def = base({ effects: [], incomePerDay: 8 });
    expect(summarizeDecisionEffects(def)).toBe("+$8/day");
  });

  // Studio monetization (issue #88): cards telegraph that they scale with a
  // stock so a 0-users card reads as "income per user", not a blank line.
  it("incomeFromStock summarises as per-unit-of-stock income", () => {
    const def = base({ effects: [], incomeFromStock: { stock: "users", perUnit: 0.75 } });
    expect(summarizeDecisionEffects(def)).toBe("+$0.75/user/day");
  });

  it("burstFromStock summarises as a chance-based burst per unit of stock", () => {
    const def = base({ effects: [], burstFromStock: { stock: "users", probabilityPerDay: 0.08, perUnit: 1.2 } });
    expect(summarizeDecisionEffects(def)).toBe("~8%/day burst of $1.2/user");
  });

  it("the shipped subscription and one-time-product cards summarise their user-scaled income", () => {
    const decisions = parseDecisions(decisionsJson);
    const sub = decisions.find((d) => d.id === "subscription")!;
    expect(summarizeDecisionEffects(sub)).toBe("+$0.75/user/day");
    const otp = decisions.find((d) => d.id === "one-time-product")!;
    expect(summarizeDecisionEffects(otp)).toBe("~8%/day burst of $1.2/user");
  });

  // Issue #89: the agent ladder is the shop's headline retune, so pin what its
  // three cards claim on their own faces -- a stacking agent reads as a flat
  // per-copy delta, the two force multipliers as multipliers.
  it("the shipped agent ladder summarises stacking adds and global multipliers", () => {
    const decisions = parseDecisions(decisionsJson);
    const agent = decisions.find((d) => d.id === "agent")!;
    expect(summarizeDecisionEffects(agent)).toBe("finish +0.2/day, debt +0.1");
    const harness = decisions.find((d) => d.id === "agent-harness")!;
    expect(summarizeDecisionEffects(harness)).toBe("finish x1.25, debt x0.7");
    const orchestration = decisions.find((d) => d.id === "agent-orchestration")!;
    expect(summarizeDecisionEffects(orchestration)).toBe("finish x1.45, debt x0.55");
  });

  it("joins multiple effects with a comma", () => {
    const def = base({
      effects: [
        { type: "modifyRate", target: "finish", op: "mul", value: 1.2 },
        { type: "modifyDebtMultiplier", op: "mul", value: 1.2 },
      ],
    });
    expect(summarizeDecisionEffects(def)).toBe("finish x1.2, debt x1.2");
  });

  it("felt-duration conversion: durationDays 6 renders as 'for 5d' (CONTENT-AUTHORING's purchase-time off-by-one)", () => {
    const def = base({
      effects: [{ type: "modifyRate", target: "all", op: "mul", value: 0.5, durationDays: 6 }],
    });
    expect(summarizeDecisionEffects(def)).toBe("all rates x0.5 for 5d");
  });

  // No shipped Studio card is effect-free any more (issue #89), but the
  // summariser still has to handle one: it returns "" so the caller omits the
  // line entirely rather than printing "no direct effect", which reads as
  // "this does nothing" on a purchase that costs real money.
  it("a decision with no effects, gamble, or incomePerDay summarises to empty so the line is omitted", () => {
    const def = base({ effects: [] });
    expect(summarizeDecisionEffects(def)).toBe("");
  });

  it("sickness on a decision's own effects is inert and filtered out", () => {
    const def = base({ effects: [{ type: "sickness", factor: 0.7, durationDays: 5 }] });
    expect(summarizeDecisionEffects(def)).toBe("");
  });

  describe("gamble range form", () => {
    it("uniform outcomes collapse to an 'all rates X to Y' range (the card's gamble chip carries the label)", () => {
      const def = base({
        effects: [],
        gamble: [
          {
            probability: 0.4,
            label: "Exceptional hire",
            effects: [
              { type: "modifyRate", target: "pull", op: "add", value: 2.0 },
              { type: "modifyRate", target: "finish", op: "add", value: 2.0 },
            ],
          },
          {
            probability: 0.3,
            label: "Strong hire",
            effects: [
              { type: "modifyRate", target: "pull", op: "add", value: 1.0 },
              { type: "modifyRate", target: "finish", op: "add", value: 1.0 },
            ],
          },
          {
            probability: 0.2,
            label: "Solid hire",
            effects: [
              { type: "modifyRate", target: "pull", op: "add", value: 0.5 },
              { type: "modifyRate", target: "finish", op: "add", value: 0.5 },
            ],
          },
          {
            probability: 0.1,
            label: "Poor fit",
            effects: [
              { type: "modifyRate", target: "pull", op: "add", value: -0.5 },
              { type: "modifyRate", target: "finish", op: "add", value: -0.5 },
            ],
          },
        ],
      });
      expect(summarizeDecisionEffects(def)).toBe("all rates +2.0 to -0.5");
    });

    it("heterogeneous outcomes fall back to naming the best and worst outcome", () => {
      const def = base({
        effects: [],
        gamble: [
          { probability: 0.5, label: "Jackpot", effects: [{ type: "addToStock", stock: "budget", value: 500 }] },
          {
            probability: 0.5,
            label: "Bust",
            effects: [{ type: "modifyRate", target: "pull", op: "mul", value: 0.8 }],
          },
        ],
      });
      expect(summarizeDecisionEffects(def)).toBe("Jackpot to Bust");
    });
  });

  describe("sweep over shipped content", () => {
    // The guard that matters: an effect type nobody taught the summariser
    // about must not silently vanish. So every decision that HAS something
    // renderable must render something. Sickness is excluded because it is
    // inert on a decision (only challenges target instances).
    it("every shipped decision with renderable effects produces a non-empty summary", () => {
      const decisions = parseDecisions(decisionsJson);
      expect(decisions.length).toBeGreaterThan(0);
      for (const def of decisions) {
        const renderable =
          def.effects.some((e) => e.type !== "sickness") ||
          (def.gamble?.length ?? 0) > 0 ||
          def.incomePerDay !== undefined;
        if (!renderable) continue;
        const summary = summarizeDecisionEffects(def);
        expect(summary, `decision "${def.id}" produced an empty summary`).not.toBe("");
      }
    });

    // Issue #89 emptied the intended empty set: the lean Studio shop dropped
    // the pure synergy targets and challenge-gate cards, and agent-harness /
    // agent-orchestration now carry their own multipliers. Every shipped card
    // therefore has numbers of its own to show. A future card that summarises
    // to blank fails here and prompts a look at whether the summariser needs
    // teaching, rather than silently shipping an empty derived line.
    it("no shipped Studio card summarises to empty", () => {
      const decisions = parseDecisions(decisionsJson);
      const empty = decisions.filter((d) => summarizeDecisionEffects(d) === "").map((d) => d.id).sort();
      expect(empty).toEqual([]);
    });
  });
});
