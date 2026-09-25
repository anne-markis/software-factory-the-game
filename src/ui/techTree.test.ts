import { describe, it, expect } from "vitest";
import { buildTechTree } from "./techTree";
import { loadShippedContent } from "../engine/loadShippedContent";
import type { GameContent } from "../engine/types";

function content(): GameContent {
  return loadShippedContent();
}

describe("buildTechTree", () => {
  it("groups the lean Studio content into CI/CD and agent ladders plus standalone decisions", () => {
    const tree = buildTechTree(content());
    expect(tree.chains).toHaveLength(2);
    expect(tree.chains.map((c) => c.name)).toEqual(["Add test suite", "Add coding agent"]);
    expect(tree.standalone.map((d) => d.id).sort()).toEqual(
      ["basic-dev", "hack-day", "one-time-product", "raise-round", "sell-company", "subscription", "user-interviews"].sort(),
    );
  });

  it("puts agent-ci-review on the CI/CD chain, not behind orchestration", () => {
    const tree = buildTechTree(content());
    const [ciChain, agentChain] = tree.chains;
    expect(ciChain!.tiers.map((tier) => tier.map((d) => d.id))).toEqual([
      ["test-suite"],
      ["ci-cd"],
      ["agent-ci-review"],
    ]);
    expect(agentChain!.tiers.map((tier) => tier.map((d) => d.id))).toEqual([
      ["agent"],
      ["agent-harness", "agent-orchestration"],
    ]);
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
