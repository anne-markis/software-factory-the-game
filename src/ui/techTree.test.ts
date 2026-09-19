import { describe, it, expect } from "vitest";
import { buildTechTree } from "./techTree";
import { loadShippedContent } from "../engine/loadShippedContent";
import type { GameContent } from "../engine/types";

function content(): GameContent {
  return loadShippedContent();
}

describe("buildTechTree", () => {
  it("groups the lean Studio content into one connected ladder and five standalone decisions", () => {
    const tree = buildTechTree(content());
    expect(tree.chains).toHaveLength(1);
    expect(tree.chains.map((c) => c.name)).toEqual(["Add test suite"]);
    expect(tree.standalone.map((d) => d.id).sort()).toEqual(
      ["basic-dev", "hack-day", "one-time-product", "subscription", "user-interviews"].sort(),
    );
  });

  it("assigns test-suite and agent as roots, ci-cd/harness/orchestration next, agent-ci-review last", () => {
    const tree = buildTechTree(content());
    const chain = tree.chains[0]!;
    expect(chain.tiers).toHaveLength(3);
    expect(chain.tiers[0].map((d) => d.id)).toEqual(["test-suite", "agent"]);
    expect(chain.tiers[1].map((d) => d.id)).toEqual(["ci-cd", "agent-harness", "agent-orchestration"]);
    expect(chain.tiers[2].map((d) => d.id)).toEqual(["agent-ci-review"]);
  });

  it("orders chains deterministically by their root's content-order position", () => {
    const tree = buildTechTree(content());
    // decisions.json order: test-suite, ci-cd, basic-dev, agent, ...
    expect(tree.chains.map((c) => c.name)).toEqual(["Add test suite"]);
  });

  it("is stable across repeated calls (deterministic ordering, not incidental)", () => {
    const c = content();
    const a = buildTechTree(c);
    const b = buildTechTree(c);
    expect(a).toEqual(b);
  });

  it("includes every decision exactly once across chains and standalone", () => {
    const c = content();
    const tree = buildTechTree(c);
    const seen: string[] = [];
    for (const chain of tree.chains) {
      for (const tier of chain.tiers) {
        for (const def of tier) seen.push(def.id);
      }
    }
    for (const def of tree.standalone) seen.push(def.id);
    expect(seen.sort()).toEqual(c.decisions.map((d) => d.id).sort());
    expect(new Set(seen).size).toBe(seen.length);
  });
});
