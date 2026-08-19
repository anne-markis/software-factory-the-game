import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Issue #99: top-bar Budget + runway overflowed into Points/Day because
// auto-fill kept empty 170px tracks. Pin the layout rules that stop the blend.

const html = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../index.html"), "utf-8");

describe("top stats layout (issue #99)", () => {
  it("uses auto-fit so empty tracks do not pin slots at the minmax floor", () => {
    expect(html).toMatch(/\.stats\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,/);
    expect(html).not.toMatch(/\.stats\s*\{[^}]*auto-fill/);
  });

  it("gives each slot enough minmax for Budget plus runway days", () => {
    const m = html.match(/\.stats\s*\{[^}]*minmax\((\d+(?:\.\d+)?)rem/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(16);
  });

  it("keeps a Budget value slot wider than the fresh-game runway string", () => {
    const m = html.match(/\.stat-value\.v-budget\s*\{[^}]*min-width:\s*(\d+)ch/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(22);
  });

  it("separates neighboring stats with a column gap of at least 1rem", () => {
    const m = html.match(/\.stats\s*\{[^}]*gap:\s*[\d.]+rem\s+([\d.]+)rem/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1);
  });
});
