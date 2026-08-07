import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Issue #18: on narrow viewports, each .tt-chain-row was a horizontal flex
// row with overflow-x: auto and 190px min-width tiers. Phones (~390px) got
// one sideways scroll region per chain, truncating card text at the
// viewport edge. The fix stacks tiers in the existing max-width: 900px
// media query (same breakpoint as the single-column page layout).

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

describe("tech-tree mobile layout (issue #18)", () => {
  const mobile = extractMaxWidth900Block(html);

  it("declares a max-width: 900px media query", () => {
    expect(mobile).not.toBeNull();
  });

  it("stacks .tt-chain-row as a column without horizontal overflow scroll", () => {
    expect(mobile!).toMatch(/\.tt-chain-row\s*\{[^}]*flex-direction:\s*column/);
    expect(mobile!).toMatch(/\.tt-chain-row\s*\{[^}]*overflow-x:\s*visible/);
  });

  it("lets tier cards fill the narrow viewport width", () => {
    expect(mobile!).toMatch(/\.tt-tier\s*\{[^}]*min-width:\s*0/);
    expect(mobile!).toMatch(/\.tt-tier\s*\{[^}]*width:\s*100%/);
    expect(mobile!).toMatch(/\.tt-tier\s*\.tt-node\s*\{[^}]*width:\s*100%/);
  });

  it("reorients chain arrows for the vertical stack", () => {
    expect(mobile!).toMatch(/\.tt-arrow\s*\{[^}]*transform:\s*rotate\(90deg\)/);
  });
});
