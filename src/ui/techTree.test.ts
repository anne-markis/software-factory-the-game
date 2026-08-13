import { describe, it, expect } from "vitest";
import { buildTechTree } from "./techTree";
import { loadShippedContent } from "../engine/loadShippedContent";
import type { GameContent } from "../engine/types";

function content(): GameContent {
  return loadShippedContent();
}

describe("buildTechTree", () => {
  it("groups the lean Studio content into two chains and four standalone decisions", () => {
    const tree = buildTechTree(content());
    expect(tree.chains).toHaveLength(2);
    expect(tree.chains.map((c) => c.name)).toEqual(["Add test suite", "Add coding agent"]);
    // Studio shop (issue #89): the hire chain lost its senior-dev/eng-manager
    // tiers, so basic-dev is now a standalone card alongside better-tooling and
    // the two monetization cards (issue #88).
    expect(tree.standalone.map((d) => d.id).sort()).toEqual(
      ["basic-dev", "better-tooling", "one-time-product", "subscription"].sort(),
    );
  });

  it("assigns test-suite/ci-cd tiers 0 and 1", () => {
    const tree = buildTechTree(content());
    const chain = tree.chains.find((c) => c.name === "Add test suite")!;
    expect(chain.tiers).toHaveLength(2);
    expect(chain.tiers[0].map((d) => d.id)).toEqual(["test-suite"]);
    expect(chain.tiers[1].map((d) => d.id)).toEqual(["ci-cd"]);
  });

  // Issue #89: agent-orchestration's prerequisite is a count gate
  // (requiresCounts: 2x agent) rather than a plain requires, so this also pins
  // that count gates place a card in the tree the same way requires does.
  it("assigns the agent chain tiers: agent 0, harness and orchestration 1", () => {
    const tree = buildTechTree(content());
    const chain = tree.chains.find((c) => c.name === "Add coding agent")!;
    expect(chain.tiers).toHaveLength(2);
    expect(chain.tiers[0].map((d) => d.id)).toEqual(["agent"]);
    // content order: agent-harness appears before agent-orchestration
    expect(chain.tiers[1].map((d) => d.id)).toEqual(["agent-harness", "agent-orchestration"]);
  });

  it("orders chains deterministically by their root's content-order position", () => {
    const tree = buildTechTree(content());
    // decisions.json order: test-suite, ci-cd, basic-dev, agent, ...
    expect(tree.chains.map((c) => c.name)).toEqual(["Add test suite", "Add coding agent"]);
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
