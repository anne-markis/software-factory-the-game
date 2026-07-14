import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ENGINE_DIR = join(__dirname);
const FORBIDDEN = [/\bdocument\b/, /\bwindow\b/, /\blocalStorage\b/, /from "\.\.\/ui/, /from '\.\.\/ui/];

describe("engine purity", () => {
  it("engine sources never touch the DOM or import from ui", () => {
    const files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(join(ENGINE_DIR, file), "utf-8");
      for (const pattern of FORBIDDEN) {
        expect(src, `${file} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
