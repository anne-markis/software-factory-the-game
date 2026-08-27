import { describe, expect, it } from "vitest";
import { formatProjectEta, projectEtaDays } from "./projectEta";

describe("projectEtaDays", () => {
  it("ceil-divides remaining by points/day", () => {
    expect(projectEtaDays(1500, 1)).toBe(1500);
    expect(projectEtaDays(1497, 1)).toBe(1497);
    expect(projectEtaDays(10, 3)).toBe(4);
  });

  it("uses the WIP slice (points/day / n) so a second contract doubles days", () => {
    expect(projectEtaDays(100, 1, 1)).toBe(100);
    expect(projectEtaDays(100, 1, 2)).toBe(200);
    expect(projectEtaDays(100, 10, 2)).toBe(20);
  });

  it("returns null when rate is ~0 or non-finite", () => {
    expect(projectEtaDays(1500, 0)).toBeNull();
    expect(projectEtaDays(1500, -1)).toBeNull();
    expect(projectEtaDays(1500, Number.NaN)).toBeNull();
  });

  it("returns 0 when nothing remains at a positive rate", () => {
    expect(projectEtaDays(0, 1)).toBe(0);
  });
});

describe("formatProjectEta", () => {
  it("shows ~N days at current rate", () => {
    expect(formatProjectEta(1500, 1)).toBe("~1,500 days at current rate");
    expect(formatProjectEta(10, 3)).toBe("~4 days at current rate");
  });

  it("uses singular day", () => {
    expect(formatProjectEta(1, 1)).toBe("~1 day at current rate");
    expect(formatProjectEta(0.5, 1)).toBe("~1 day at current rate");
  });

  it("shows stalled when rate is ~0", () => {
    expect(formatProjectEta(1500, 0)).toBe("stalled");
  });

  it("lengthens copy when in-flight count rises at the same factory rate", () => {
    expect(formatProjectEta(100, 1, 1)).toBe("~100 days at current rate");
    expect(formatProjectEta(100, 1, 2)).toBe("~200 days at current rate");
  });
});
