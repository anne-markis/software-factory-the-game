import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Alter the system is one vertical column at every viewport.
// Flatten left a wrapping grid plus leftover chain-row CSS
// (190px nodes, overflow-x: auto, 900px stack/rotate). Stacking is now
// the only layout — desktop and mobile share it. Each row is slim
// (left Buy column + hover/tap disclosure); this file pins list-flow
// and that shared Buy column.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.resolve(__dirname, "../../index.html");
const html = fs.readFileSync(indexHtmlPath, "utf-8");

function extractMaxWidth900Block(css: string): string | null {
  const startMatch = css.match(/@media\s*\(max-width:\s*900px\)\s*\{/);
  if (!startMatch || startMatch.index === undefined) return null;
  let i = startMatch.index + startMatch[0].length;
  let depth = 1;
  const start = i;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  return css.slice(start, i - 1);
}

describe("shop single-column layout", () => {
  it("stacks .tt-shop-grid as a column with no wrap", () => {
    expect(html).toMatch(/\.tt-shop-grid\s*\{[^}]*display:\s*flex/);
    expect(html).toMatch(/\.tt-shop-grid\s*\{[^}]*flex-direction:\s*column/);
    expect(html).not.toMatch(/\.tt-shop-grid[^{]*\{[^}]*flex-wrap:\s*wrap/);
  });

  it("makes shop cards fill the Alter the system column", () => {
    expect(html).toMatch(/\.tt-shop-grid\s+\.tt-node\s*\{[^}]*width:\s*100%/);
    // No leftover 190px node/tier widths from the old chain columns.
    expect(html).not.toMatch(/\.tt-(?:shop-grid|standalone-grid|tier)[^{]*\{[^}]*190px/);
    expect(html).not.toMatch(/min-width:\s*190px/);
  });

  it("does not create a horizontal scroll region inside the shop", () => {
    expect(html).not.toMatch(/\.tt-chain-row\s*\{[^}]*overflow-x:\s*auto/);
    expect(html).not.toMatch(/\.tt-shop-grid\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("retires leftover chain/grid chrome", () => {
    expect(html).not.toMatch(/\.tt-chain-row\b/);
    expect(html).not.toMatch(/\.tt-standalone-grid\b/);
    expect(html).not.toMatch(/\.tt-tier\b/);
    expect(html).not.toMatch(/\.tt-arrow\b/);
  });

  it("keeps the 900px page-layout query without tech-tree row/arrow special-cases", () => {
    const mobile = extractMaxWidth900Block(html);
    expect(mobile).not.toBeNull();
    expect(mobile!).toMatch(/\.cols\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(mobile!).not.toMatch(/\.tt-chain-row/);
    expect(mobile!).not.toMatch(/\.tt-tier/);
    expect(mobile!).not.toMatch(/\.tt-arrow/);
    expect(mobile!).not.toMatch(/\.tt-shop-grid/);
    expect(mobile!).not.toMatch(/rotate\(90deg\)/);
  });
});

describe("shop slim row layout", () => {
  it("puts every Buy in a shared left column", () => {
    expect(html).toMatch(/\.tt-node-row\s*\{[^}]*display:\s*grid/);
    expect(html).toMatch(/\.tt-node-row\s*\{[^}]*grid-template-columns:\s*3\.4rem\s+1fr/);
    expect(html).toMatch(/\.tt-buy\s*\{[^}]*min-width:\s*3\.4rem/);
  });

  it("hides description and derived effects until hover or tap", () => {
    expect(html).toMatch(/\.tt-node-details\s*\{[^}]*display:\s*none/);
    expect(html).toMatch(/\.tt-node\.tt-open\s+\.tt-node-details\s*\{[^}]*display:\s*block/);
    expect(html).toMatch(
      /@media\s*\(hover:\s*hover\)[\s\S]*\.tt-node-main:hover\s+\.tt-node-details\s*\{[^}]*display:\s*block/,
    );
  });

  it("does not use native title tooltips as the shop disclosure", () => {
    // Hover/tap CSS is the disclosure; a title= fallback on the name would
    // fight that. Gamble chip title (risk hint) is unrelated chrome.
    expect(html).not.toMatch(/\.tt-node-name[^{]*\{[^}]*title/);
  });
});
