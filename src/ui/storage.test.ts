import { describe, it, expect } from "vitest";
import { normalizeSpeed } from "./storage";

// storage.ts's saveSpeed/loadGame etc. touch localStorage, which doesn't
// exist in the node test environment, so the validation logic is extracted
// into this pure, directly-testable normaliser (see design doc section 6:
// "an invalid or missing stored value falls back to 1x").
describe("normalizeSpeed", () => {
  it("accepts each allowed speed option unchanged", () => {
    expect(normalizeSpeed(1)).toBe(1);
    expect(normalizeSpeed(2)).toBe(2);
    expect(normalizeSpeed(5)).toBe(5);
  });

  it("accepts the string form localStorage actually returns", () => {
    expect(normalizeSpeed("2")).toBe(2);
    expect(normalizeSpeed("5")).toBe(5);
  });

  it("falls back to 1 for a missing value", () => {
    expect(normalizeSpeed(null)).toBe(1);
    expect(normalizeSpeed(undefined)).toBe(1);
  });

  it("falls back to 1 for a non-numeric value", () => {
    expect(normalizeSpeed("fast")).toBe(1);
    expect(normalizeSpeed("NaN")).toBe(1);
  });

  it("falls back to 1 for a numeric value outside the allowed options", () => {
    expect(normalizeSpeed(3)).toBe(1);
    expect(normalizeSpeed(10)).toBe(1);
    expect(normalizeSpeed(0)).toBe(1);
    expect(normalizeSpeed(-1)).toBe(1);
  });
});
