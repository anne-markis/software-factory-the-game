import { describe, it, expect } from "vitest";
import { formatBuiltAt, getBuildInfo } from "./buildInfo";

describe("buildInfo (issue #45)", () => {
  it("exposes version, builtAt, and repo URL from the Vite-injected constants", () => {
    const info = getBuildInfo();
    expect(info.version.length).toBeGreaterThan(0);
    expect(info.builtAt.length).toBeGreaterThan(0);
    expect(info.repoUrl).toBe("https://github.com/anne-markis/software-factory-the-game");
  });

  it("formats a UTC ISO timestamp for the stamp without a trailing Z", () => {
    expect(formatBuiltAt("2026-08-05T20:15:30.123Z")).toBe("2026-08-05 20:15:30 UTC");
  });

  it("passes through an unparseable builtAt string unchanged", () => {
    expect(formatBuiltAt("not-a-date")).toBe("not-a-date");
  });
});
