import { describe, expect, it } from "vitest";
import { sampleIndependentHits } from "./binomial";
import { createRng } from "./rng";

describe("sampleIndependentHits", () => {
  it("returns 0 and consumes no RNG when stock or p is 0", () => {
    const rng = createRng(1);
    const before = rng.getState();
    expect(sampleIndependentHits(rng, 0, 0.5)).toBe(0);
    expect(sampleIndependentHits(rng, 10, 0)).toBe(0);
    expect(rng.getState()).toBe(before);
  });

  it("never exceeds ceil(stock) and stays a whole number", () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const hits = sampleIndependentHits(rng, 5.4, 0.4);
      expect(Number.isInteger(hits)).toBe(true);
      expect(hits).toBeGreaterThanOrEqual(0);
      expect(hits).toBeLessThanOrEqual(6);
    }
  });

  it("matches expected hits stock * p over many trials", () => {
    const rng = createRng(42);
    const stock = 25;
    const p = 0.08;
    const n = 8000;
    let total = 0;
    for (let i = 0; i < n; i++) total += sampleIndependentHits(rng, stock, p);
    expect(total / n).toBeCloseTo(stock * p, 1);
  });

  it("is deterministic for the same seed", () => {
    const a = createRng(99);
    const b = createRng(99);
    const seqA = Array.from({ length: 20 }, () => sampleIndependentHits(a, 12, 0.3));
    const seqB = Array.from({ length: 20 }, () => sampleIndependentHits(b, 12, 0.3));
    expect(seqA).toEqual(seqB);
  });
});
