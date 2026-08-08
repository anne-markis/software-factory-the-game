import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Issue #10: index.html never declares `color-scheme` or explicit
// foreground/background colors, so under prefers-color-scheme: dark the
// browser's forced-dark heuristic inverts the default canvas + default text
// pairing (body has no authored color/background) while every *authored*
// hex value in the stylesheet (#666, #999, #a60, #c00, #444, #fdd, ...)
// stays exactly as written -- because color-scheme's auto-adjustment only
// ever touches the default canvas/text pairing, never explicit author
// colors. That mismatch is what collapses contrast to near-invisible.
//
// This test reads index.html's raw source, resolves the actual colors used
// for a fixed catalog of foreground/background pairs (walking through CSS
// custom properties once they exist), and asserts WCAG AA contrast (4.5:1
// normal text, 3:1 UI components/borders) holds in both light mode and this
// simulated dark mode. It is written to work unmodified both before and
// after the fix: pre-fix, colors resolve to literal hex values that don't
// change between light/dark (reproducing the bug); post-fix, they resolve
// through --custom-properties overridden inside
// @media (prefers-color-scheme: dark), which is exactly what the fix adds.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.resolve(__dirname, "../../index.html");
const html = fs.readFileSync(indexHtmlPath, "utf-8");

// ---------------------------------------------------------------------------
// WCAG contrast math (relative luminance / contrast ratio, per the spec).
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Narrow, purpose-built CSS extraction. Not a general CSS parser -- it only
// knows the exact selectors/properties this stylesheet uses (see the color
// catalog in index.html's :root / dark-mode blocks), and resolves var(--token)
// references against the :root custom-property block(s) so the same
// extraction works whether a color is a literal hex or a custom property.
// ---------------------------------------------------------------------------

function extractRootVars(cssScope: string): Record<string, string> {
  const rootMatch = cssScope.match(/:root\s*\{([^}]*)\}/);
  const vars: Record<string, string> = {};
  if (!rootMatch) return vars;
  const re = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rootMatch[1]))) vars[m[1]] = m[2];
  return vars;
}

// Returns the raw text inside the first @media (prefers-color-scheme: dark)
// block, or null if the stylesheet has none yet (the pre-fix state).
function extractDarkMediaBlock(css: string): string | null {
  const startMatch = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/);
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Finds `selector { ... property: value; ... }` and returns the raw value
// text (e.g. "1px solid #999" for a border shorthand). Only matches
// non-nested rule blocks, which is all this stylesheet has.
//
// A plain first-match regex isn't enough: this stylesheet has compound
// selector lists like ".tt-standalone-grid .tt-node, .tt-tier .tt-node"
// which also contain the literal substring ".tt-node {" (at the end of the
// combinator chain) and would be matched before the real standalone
// ".tt-node { border: ... }" rule. So each candidate match is checked for
// isolation: walking backward from it (skipping whitespace) must land on a
// rule/block boundary ("{", "}", ";", or the "<style>" tag's ">"), not on
// another selector token that means this is part of a compound selector.
function isIsolatedSelectorMatch(cssScope: string, matchIndex: number): boolean {
  let j = matchIndex - 1;
  while (j >= 0 && /\s/.test(cssScope[j])) j--;
  const prevChar = j >= 0 ? cssScope[j] : null;
  // "/" covers a preceding "*/" comment close (this stylesheet has several
  // block comments directly above rules, e.g. above .tt-gamble/.tt-effects).
  return (
    prevChar === null ||
    prevChar === "{" ||
    prevChar === "}" ||
    prevChar === ";" ||
    prevChar === ">" ||
    prevChar === "/"
  );
}

function findDeclaration(cssScope: string, selector: string, property: string): string | null {
  const selRe = new RegExp(escapeRegExp(selector) + "\\s*\\{([^}]*)\\}", "g");
  let match: RegExpExecArray | null;
  while ((match = selRe.exec(cssScope))) {
    if (!isIsolatedSelectorMatch(cssScope, match.index)) continue;
    const propRe = new RegExp(`(?:^|[\\s;{])${escapeRegExp(property)}\\s*:\\s*([^;]+);`);
    const propMatch = match[1].match(propRe);
    if (propMatch) return propMatch[1].trim();
  }
  return null;
}

function resolveColor(raw: string, vars: Record<string, string>): string {
  const varMatch = raw.match(/var\(--([\w-]+)\)/);
  if (varMatch) {
    const resolved = vars[varMatch[1]];
    if (!resolved) throw new Error(`Unresolved custom property --${varMatch[1]} (raw: "${raw}")`);
    return resolved;
  }
  const hexMatch = raw.match(/#[0-9a-fA-F]{3,8}/);
  if (!hexMatch) throw new Error(`No color found in declaration value: "${raw}"`);
  return hexMatch[0];
}

// ---------------------------------------------------------------------------
// Resolve the palette.
//
// Important: a dark-mode fix expresses overrides as custom-property values
// re-declared inside `@media (prefers-color-scheme: dark) { :root { ... } }`
// -- it does NOT redeclare each selector a second time inside that block.
// So resolving a token for "dark" mode means: look up the *same* selector
// declaration used for light mode (there's only one), then resolve any
// var(--x) it contains against the dark-cascaded variable map instead of
// the light one. A literal hex value (no var(), the pre-fix state) resolves
// to the exact same string regardless of which vars map is passed in, which
// is exactly the bug this test is meant to catch: authored hex values that
// don't adapt between light and dark.
// ---------------------------------------------------------------------------

const lightVars = extractRootVars(html);
const darkBlock = extractDarkMediaBlock(html);
const darkVarsOwn = darkBlock ? extractRootVars(darkBlock) : {};
// A custom property not redefined inside the dark block still cascades from
// :root's light value -- mirror that here.
const darkVars = { ...lightVars, ...darkVarsOwn };

// UA-default-canvas approximation used only as a fallback when index.html
// declares no dark-mode background at all (the pre-fix, buggy state): a
// forced-dark browser heuristic flips the default canvas to near-black even
// though the page never asked for it, while leaving default text where it
// was (see the file-level comment above). This constant is NOT used once
// the fix adds an explicit --bg override for dark mode.
const UA_FORCED_DARK_CANVAS = "#121212";

function varsFor(mode: "light" | "dark"): Record<string, string> {
  return mode === "light" ? lightVars : darkVars;
}

function colorFor(mode: "light" | "dark", selector: string, property: string): string | null {
  const raw = findDeclaration(html, selector, property);
  if (raw === null) return null;
  return resolveColor(raw, varsFor(mode));
}

type Pair = {
  label: string;
  fg: (mode: "light" | "dark") => string;
  bg: (mode: "light" | "dark") => string;
  category: "text" | "ui";
};

function tokenColor(selector: string, property: "color" | "border"): Pair["fg"] {
  return (mode) => {
    const val = colorFor(mode, selector, property);
    if (val === null) throw new Error(`No ${property} found for "${selector}"`);
    return val;
  };
}

// Body: the only element relying on UA defaults instead of an authored
// value pre-fix (no explicit color/background at all).
function bodyFg(mode: "light" | "dark"): string {
  const val = colorFor(mode, "body", "color");
  if (val !== null) return val;
  // No explicit body color declared: UA default text is black, and per the
  // issue, it does not adapt when the OS is in dark mode -- that
  // non-adaptation (paired with the forced-dark canvas below) is the bug.
  return "#000000";
}

function bodyBg(mode: "light" | "dark"): string {
  const val = colorFor(mode, "body", "background");
  if (val !== null) return val;
  if (mode === "light") return "#ffffff"; // UA default canvas
  return UA_FORCED_DARK_CANVAS; // UA forces the canvas dark even though the page never asked for it
}

const bg = (mode: "light" | "dark") => bodyBg(mode);

const PAIRS: Pair[] = [
  { label: "body text on body background", fg: bodyFg, bg, category: "text" },
  { label: ".stat-label on body background", fg: tokenColor(".stat-label", "color"), bg, category: "text" },
  { label: ".panel h4 small on body background", fg: tokenColor(".panel h4 small", "color"), bg, category: "text" },
  { label: ".tt-arrow on body background", fg: tokenColor(".tt-arrow", "color"), bg, category: "text" },
  { label: ".tt-node-meta on body background", fg: tokenColor(".tt-node-meta", "color"), bg, category: "text" },
  { label: ".tt-gamble on body background", fg: tokenColor(".tt-gamble", "color"), bg, category: "text" },
  { label: ".tt-node-desc on body background", fg: tokenColor(".tt-node-desc", "color"), bg, category: "text" },
  { label: ".tt-effects on body background", fg: tokenColor(".tt-effects", "color"), bg, category: "text" },
  { label: ".tt-reason on body background", fg: tokenColor(".tt-reason", "color"), bg, category: "text" },
  {
    label: ".tt-node.tt-cannot-afford .tt-reason on body background",
    fg: tokenColor(".tt-node.tt-cannot-afford .tt-reason", "color"),
    bg,
    category: "text",
  },
  // Issue #37: low-runway Budget warning reuses --accent-red.
  { label: ".stat-value.budget-low on body background", fg: tokenColor(".stat-value.budget-low", "color"), bg, category: "text" },
  // Issue #67: hire/gamble reveal outcome reuses --accent-amber.
  { label: ".gamble-reveal-outcome on body background", fg: tokenColor(".gamble-reveal-outcome", "color"), bg, category: "text" },
];

// .stall has its own background and (pre-fix) an inherited foreground.
const stallBg: Pair["fg"] = (mode) => {
  const val = colorFor(mode, ".stall", "background");
  if (val === null) throw new Error('No background found for ".stall"');
  return val;
};
const stallFg: Pair["fg"] = (mode) => {
  const val = colorFor(mode, ".stall", "color");
  // No explicit .stall color: it inherits body's resolved text color.
  return val ?? bodyFg(mode);
};
PAIRS.push({ label: ".stall text on .stall background", fg: stallFg, bg: stallBg, category: "text" });

// Borders are UI components (3:1), not text (4.5:1). .panel's light-mode
// border (#999 on #fff, ~2.85:1) is a pre-existing, out-of-scope shortfall
// unrelated to issue #10 (dark mode) -- flagged in the handoff note rather
// than silently changed, since the ticket is dark-mode-only and light mode
// must stay visually unchanged. Only dark mode is gated here.
const UI_PAIRS: Pair[] = [
  { label: ".panel border on body background", fg: tokenColor(".panel", "border"), bg, category: "ui" },
  { label: ".tt-node border on body background", fg: tokenColor(".tt-node", "border"), bg, category: "ui" },
];

const AA_TEXT = 4.5;
const AA_UI = 3.0;

describe("index.html dark-mode contrast (WCAG AA)", () => {
  for (const pair of PAIRS) {
    it(`${pair.label} meets ${AA_TEXT}:1 in light mode`, () => {
      const ratio = contrastRatio(pair.fg("light"), pair.bg("light"));
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });
    it(`${pair.label} meets ${AA_TEXT}:1 in dark mode`, () => {
      const ratio = contrastRatio(pair.fg("dark"), pair.bg("dark"));
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }

  for (const pair of UI_PAIRS) {
    it(`${pair.label} meets ${AA_UI}:1 in dark mode`, () => {
      const ratio = contrastRatio(pair.fg("dark"), pair.bg("dark"));
      expect(ratio).toBeGreaterThanOrEqual(AA_UI);
    });
    it(`${pair.label} is at least as good in dark mode as light mode (non-regression)`, () => {
      const darkRatio = contrastRatio(pair.fg("dark"), pair.bg("dark"));
      const lightRatio = contrastRatio(pair.fg("light"), pair.bg("light"));
      expect(darkRatio).toBeGreaterThanOrEqual(lightRatio);
    });
  }

  it("declares color-scheme: light dark so UA form controls/scrollbars follow suit", () => {
    expect(html).toMatch(/color-scheme\s*:\s*light\s+dark/);
  });
});
