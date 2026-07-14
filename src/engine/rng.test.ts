import { describe, it, expect } from "vitest";
import { createRng } from "./rng";

describe("createRng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it("produces values in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("can be resumed from saved state", () => {
    const a = createRng(42);
    a.next();
    const resumed = createRng(a.getState(), true);
    const b = createRng(42);
    b.next();
    expect(resumed.next()).toBe(b.next());
  });
});
