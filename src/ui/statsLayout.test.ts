import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Issue #113: Budget + runway still painted into Points/Day under
// auto-fit/minmax. Pin a fixed 4-column template so each stat stays in
// its track (no auto-fit / auto-fill / ch-width arms races).

const html = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../index.html"), "utf-8");

describe("top stats layout (issue #113)", () => {
  it("uses a fixed 4-column grid so each stat owns one track", () => {
    expect(html).toMatch(/\.stats\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    expect(html).not.toMatch(/\.stats\s*\{[^}]*auto-fit/);
    expect(html).not.toMatch(/\.stats\s*\{[^}]*auto-fill/);
  });

  it("separates neighboring stats with a column gap of at least 1rem", () => {
    const m = html.match(/\.stats\s*\{[^}]*gap:\s*[\d.]+rem\s+([\d.]+)rem/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1);
  });

  it("keeps tabular nums so ticking values do not reflow the loops below", () => {
    expect(html).toMatch(/\.stat-value\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  // A large ch min-width + text-align:right left an empty gap after the
  // Budget label while the amount clipped away inside the cell.
  it("does not pin Budget to a wide ch min-width that wastes the cell", () => {
    expect(html).not.toMatch(/\.stat-value\.v-budget\s*\{[^}]*min-width:\s*\d+ch/);
  });
});

describe("chrome row layout", () => {
  it("puts Start/speed and Reset on one flex row with Reset offset to the right", () => {
    expect(html).toMatch(/\.chrome-row\s*\{[^}]*display:\s*flex/);
    expect(html).toMatch(/\.chrome-row\s*\{[^}]*justify-content:\s*space-between/);
    expect(html).toMatch(/\.chrome-row #reset\s*\{[^}]*margin-left:\s*auto/);
    expect(html).not.toMatch(/\.era-kicker/);
    expect(html).not.toMatch(/\.next-goal/);
  });
});
