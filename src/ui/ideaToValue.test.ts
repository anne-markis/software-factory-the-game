import { describe, expect, it } from "vitest";
import { formatIdeaToValue, ideaToValueDays, ideaToValuePoints } from "./ideaToValue";
import type { GameState, PlanItem } from "../engine/types";

function stocks(partial: Partial<GameState["stocks"]> = {}): GameState["stocks"] {
  return {
    backlog: 0,
    inProgress: 0,
    inReview: 0,
    done: 0,
    shipped: 0,
    budget: 0,
    techDebt: 0,
    reputation: 0,
    users: 0,
    ideas: 0,
    plan: 0,
    morale: 0,
    oversight: 0,
    ...partial,
  };
}

function planItem(partial: Partial<PlanItem> & Pick<PlanItem, "size">): PlanItem {
  return {
    defId: "ship-v1",
    name: "Ship v1",
    progress: 0,
    ...partial,
  };
}

describe("ideaToValuePoints", () => {
  it("sums Plan item sizes and unshipped pipeline work", () => {
    expect(
      ideaToValuePoints({
        stocks: stocks({ backlog: 80, inProgress: 2, inReview: 18, done: 4 }),
        plan: [planItem({ size: 400, progress: 10 }), planItem({ defId: "ship-vnext", name: "Ship next feature", size: 600 })],
      }),
    ).toBe(1104);
  });

  it("ignores the Ideas wallet and Plan fill progress", () => {
    const committed = {
      stocks: stocks({ ideas: 202470, plan: 10, backlog: 624 }),
      plan: [planItem({ size: 400, progress: 10 })],
    };
    expect(ideaToValuePoints(committed)).toBe(1024);
    committed.stocks.ideas = 0;
    committed.plan[0]!.progress = 0;
    expect(ideaToValuePoints(committed)).toBe(1024);
  });
});

describe("ideaToValueDays", () => {
  it("ceil-divides the pile by points/day", () => {
    expect(ideaToValueDays(462, 6.4)).toBe(73);
    expect(ideaToValueDays(10, 3)).toBe(4);
  });

  it("returns null when rate is ~0 or non-finite", () => {
    expect(ideaToValueDays(462, 0)).toBeNull();
    expect(ideaToValueDays(462, -1)).toBeNull();
    expect(ideaToValueDays(462, Number.NaN)).toBeNull();
  });

  it("returns 0 when the pile is empty at a positive rate", () => {
    expect(ideaToValueDays(0, 1)).toBe(0);
  });
});

describe("formatIdeaToValue", () => {
  it("shows ~Nd from committed work, not banked Ideas", () => {
    expect(
      formatIdeaToValue({
        stocks: stocks({ ideas: 202470, backlog: 624 }),
        plan: [],
        pointsPerDay: 7.8,
      }),
    ).toBe("~80d");
    expect(
      formatIdeaToValue({
        stocks: stocks({ ideas: 100, backlog: 300 }),
        plan: [],
        pointsPerDay: 0.8,
      }),
    ).toBe("~375d");
  });

  it("counts a Plan item's full size so filling it does not move the clock", () => {
    const state = {
      stocks: stocks(),
      plan: [planItem({ size: 400, progress: 10 })],
      pointsPerDay: 1,
    };
    expect(formatIdeaToValue(state)).toBe("~400d");
    state.plan[0]!.progress = 399;
    expect(formatIdeaToValue(state)).toBe("~400d");
  });

  it("shows an em dash when ship rate is ~0", () => {
    expect(formatIdeaToValue({ stocks: stocks({ ideas: 100 }), plan: [], pointsPerDay: 0 })).toBe("—");
  });

  it("shows ~0d when nothing is committed at a positive rate", () => {
    expect(formatIdeaToValue({ stocks: stocks({ ideas: 5000 }), plan: [], pointsPerDay: 1 })).toBe("~0d");
  });
});
