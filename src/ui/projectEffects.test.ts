import { describe, it, expect } from "vitest";
import { projectEffectChips } from "./projectEffects";

describe("projectEffectChips", () => {
  it("omits a zero reputation reward", () => {
    expect(projectEffectChips({ reputationReward: 0 })).toEqual([]);
  });

  it("labels a positive reputation reward", () => {
    expect(projectEffectChips({ reputationReward: 1 })).toEqual([{ tone: "rep", text: "+1 rep" }]);
  });

  it("renders a tech-debt grant as a debt chip, not a raw stock key", () => {
    expect(
      projectEffectChips({
        reputationReward: 0,
        completionStockGrants: [{ stock: "techDebt", amount: -50 }],
      }),
    ).toEqual([{ tone: "debt", text: "debt −50" }]);
  });

  it("renders user grants and lasting acquire mods as user chips", () => {
    expect(
      projectEffectChips({
        reputationReward: 2,
        completionStockGrants: [{ stock: "users", amount: 20 }],
        stockFlowMods: [{ stock: "users", acquirePerDayDelta: 1 }],
      }),
    ).toEqual([
      { tone: "rep", text: "+2 rep" },
      { tone: "users", text: "+20 users" },
      { tone: "users", text: "+1 users/day" },
    ]);
  });
});
