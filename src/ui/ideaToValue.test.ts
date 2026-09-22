import { describe, expect, it } from "vitest";
import { formatIdeaToValue, ideaToValueDays, ideaToValuePoints } from "./ideaToValue";
import type { GameState } from "../engine/types";

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
    ...partial,
  };
}

describe("ideaToValuePoints", () => {
  it("sums named Plan sizes and unshipped pipeline work, ignoring idle Ideas", () => {
    expect(
      ideaToValuePoints({
        stocks: stocks({ ideas: 310, plan: 48, backlog: 80, inProgress: 2, inReview: 18, done: 4 }),
        plan: [{ defId: "late", name: "Late", progress: 48, size: 400 }],
      }),
    ).toBe(504);
  });

  it("at a one-project start counts only the seeded Ready work, not the Ideas wallet", () => {
    expect(
      ideaToValuePoints({
        stocks: stocks({ ideas: 100, plan: 0, backlog: 300 }),
        plan: [],
      }),
    ).toBe(300);
  });

  it("counts a Plan item's full size, not just filled progress", () => {
    expect(
      ideaToValuePoints({
        stocks: stocks({ ideas: 0, plan: 10, backlog: 300 }),
        plan: [{ defId: "v1", name: "Ship v1", progress: 10, size: 400 }],
      }),
    ).toBe(700);
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
  it("shows ~Nd from Plan onward, not idle Ideas", () => {
    expect(
      formatIdeaToValue({
        stocks: stocks({ ideas: 310, plan: 48, backlog: 80, inProgress: 2, inReview: 18, done: 4 }),
        plan: [{ defId: "late", name: "Late", progress: 48, size: 400 }],
        pointsPerDay: 6.4,
      }),
    ).toBe("~79d");
  });

  it("shows an em dash when ship rate is ~0", () => {
    expect(formatIdeaToValue({ stocks: stocks({ ideas: 100 }), pointsPerDay: 0 })).toBe("—");
  });

  it("shows ~0d when nothing remains at a positive rate", () => {
    expect(formatIdeaToValue({ stocks: stocks(), pointsPerDay: 1 })).toBe("~0d");
  });
});
