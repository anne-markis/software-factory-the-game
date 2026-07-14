import { describe, it, expect } from "vitest";
import { parseStartConfig } from "./content";
import startJson from "../../content/start.json";

describe("parseStartConfig", () => {
  it("parses the shipped start.json", () => {
    const cfg = parseStartConfig(startJson);
    expect(cfg.stocks.backlog).toBe(10000);
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
