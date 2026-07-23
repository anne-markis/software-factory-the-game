import { describe, it, expect } from "vitest";
import { advance, MAX_TICKS_PER_FRAME, LARGE_GAP_THRESHOLD_MS, SPEED_OPTIONS, DEFAULT_SPEED } from "./tickDriver";

describe("advance", () => {
  it("at 1x, a 1000ms frame yields exactly one tick and an empty accumulator", () => {
    expect(advance(0, 1000, 1)).toEqual({ ticks: 1, accumulatorMs: 0 });
  });

  it("at 1x, a 100ms frame yields zero ticks but accumulates the remainder", () => {
    expect(advance(0, 100, 1)).toEqual({ ticks: 0, accumulatorMs: 100 });
  });

  it("carries a fractional remainder across frames until it crosses 1000ms", () => {
    const first = advance(0, 600, 1);
    expect(first).toEqual({ ticks: 0, accumulatorMs: 600 });
    const second = advance(first.accumulatorMs, 500, 1);
    expect(second).toEqual({ ticks: 1, accumulatorMs: 100 });
  });

  it("at 5x, a 1000ms frame yields five ticks", () => {
    expect(advance(0, 1000, 5)).toEqual({ ticks: 5, accumulatorMs: 0 });
  });

  it("at 5x, a 100ms frame yields zero ticks but accumulates at the sped-up rate", () => {
    expect(advance(0, 100, 5)).toEqual({ ticks: 0, accumulatorMs: 500 });
  });

  it("treats elapsed time beyond the large-gap threshold as a gap: zero ticks, reset accumulator", () => {
    expect(advance(500, LARGE_GAP_THRESHOLD_MS + 1, 1)).toEqual({ ticks: 0, accumulatorMs: 0 });
  });

  it("does not treat exactly the threshold as a gap", () => {
    const result = advance(0, LARGE_GAP_THRESHOLD_MS, 1);
    expect(result.ticks).toBeGreaterThan(0);
  });

  it("caps ticks per call at MAX_TICKS_PER_FRAME and drops the excess so it cannot compound", () => {
    // 1900ms * 20 speed = 38000ms of accumulated time, i.e. 38 ticks' worth --
    // well under the large-gap threshold's elapsed-time check (1900 < 2000)
    // but far over the tick cap once multiplied by speed.
    const result = advance(0, 1900, 20);
    expect(result.ticks).toBe(MAX_TICKS_PER_FRAME);
    expect(result.accumulatorMs).toBe(0);
  });

  it("does not let a capped frame's dropped excess reappear on the next call", () => {
    const first = advance(0, 1900, 20);
    const second = advance(first.accumulatorMs, 0, 1);
    expect(second).toEqual({ ticks: 0, accumulatorMs: 0 });
  });

  it("exports the UI-layer speed options, not sourced from engine content", () => {
    expect(SPEED_OPTIONS).toEqual([1, 2, 5]);
    expect(DEFAULT_SPEED).toBe(1);
  });
});
