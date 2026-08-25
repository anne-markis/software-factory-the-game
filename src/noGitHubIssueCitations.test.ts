import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = join(__dirname, "..");
// Split so this file does not itself contain a ticket citation.
const TICKET = new RegExp(String.raw`\bissues?\s*` + "#" + String.raw`\d+`, "i");
const TICKET_URL = /github\.com\/[^\s)'"]+\/issues\/\d+/i;

const ROOTS = [
  "src",
  "index.html",
  ".github",
  "AGENTS.md",
  "docs/ARCHITECTURE.md",
  "docs/CONTENT-AUTHORING.md",
  "docs/CONTEXT.md",
  "docs/OPEN-DECISIONS.md",
  "docs/adr",
];

function walk(abs: string, acc: string[]): void {
  const st = statSync(abs);
  if (st.isDirectory()) {
    for (const name of readdirSync(abs)) {
      if (name === "node_modules" || name === "dist") continue;
      walk(join(abs, name), acc);
    }
    return;
  }
  if (/\.(ts|html|yml|md)$/.test(abs)) acc.push(abs);
}

describe("no GitHub issue citations in code or living guidance", () => {
  it("does not cite ticket numbers or issue URLs", () => {
    const files: string[] = [];
    for (const root of ROOTS) {
      walk(join(REPO, root), files);
    }
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf-8");
      for (const [i, line] of text.split("\n").entries()) {
        if (TICKET.test(line) || TICKET_URL.test(line)) {
          hits.push(`${relative(REPO, file)}:${i + 1}:${line.trim()}`);
        }
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("fixer prompts treat only the current issue and existing code as context", () => {
    for (const name of ["issue-fixer-bugs-prompt.md", "issue-fixer-enhancements-prompt.md"]) {
      const text = readFileSync(join(REPO, "scripts", name), "utf-8");
      expect(text, name).toContain("## Code is the context");
      expect(text, name).toMatch(/Do \*\*not\*\* look up, cite, or follow old GitHub issues/);
      expect(text, name).toContain("existing code");
      expect(text, name).not.toMatch(TICKET);
      expect(text, name).not.toMatch(TICKET_URL);
    }
  });
});
