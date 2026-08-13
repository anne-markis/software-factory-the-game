import { describe, it, expect } from "vitest";
import { buildTechTree } from "./techTree";
import { parseStartConfig, parseDecisions, parseChallenges, parseProjects } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import challengesJson from "../../content/challenges.json";
import projectsJson from "../../content/projects.json";
import type { GameContent } from "../engine/types";

function content(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: parseChallenges(challengesJson),
    projects: parseProjects(projectsJson),
  };
}

describe("buildTechTree", () => {
  it("groups the real content into the three known chains and 10 standalone decisions", () => {
    const tree = buildTechTree(content());
    expect(tree.chains).toHaveLength(3);
    expect(tree.chains.map((c) => c.name)).toEqual(["Add test suite", "Hire basic developer", "Add coding agent"]);
    // Studio spine (issue #88): subscription + one-time-product are standalone
    // monetization cards (no requires, not required by anything).
    expect(tree.standalone).toHaveLength(10);
    expect(tree.standalone.map((d) => d.id).sort()).toEqual(
      [
        "better-tooling",
        "copilot",
        "contractor",
        "standup",
        "subscription",
        "one-time-product",
        "support-retainer",
        "ddos-protection",
        "refactoring-sprint",
        "redesign-rebuild",
      ].sort(),
    );
  });

  it("assigns test-suite/ci-cd tiers 0 and 1", () => {
    const tree = buildTechTree(content());
    const chain = tree.chains.find((c) => c.name === "Add test suite")!;
    expect(chain.tiers).toHaveLength(2);
    expect(chain.tiers[0].map((d) => d.id)).toEqual(["test-suite"]);
    expect(chain.tiers[1].map((d) => d.id)).toEqual(["ci-cd"]);
  });

  it("assigns basic-dev tier 0 with senior-dev and eng-manager both at tier 1", () => {
    const tree = buildTechTree(content());
    const chain = tree.chains.find((c) => c.name === "Hire basic developer")!;
    expect(chain.tiers).toHaveLength(2);
    expect(chain.tiers[0].map((d) => d.id)).toEqual(["basic-dev"]);
    // content order: senior-dev appears before eng-manager in decisions.json
    expect(chain.tiers[1].map((d) => d.id)).toEqual(["senior-dev", "eng-manager"]);
  });

  it("assigns the agent chain tiers: agent 0, harness 1, swarm/orchestrator 2, self-learning-agents 3", () => {
    const tree = buildTechTree(content());
    const chain = tree.chains.find((c) => c.name === "Add coding agent")!;
    expect(chain.tiers).toHaveLength(4);
    expect(chain.tiers[0].map((d) => d.id)).toEqual(["agent"]);
    expect(chain.tiers[1].map((d) => d.id)).toEqual(["agent-harness"]);
    expect(chain.tiers[2].map((d) => d.id)).toEqual(["agent-swarm", "swarm-orchestrator"]);
    expect(chain.tiers[3].map((d) => d.id)).toEqual(["self-learning-agents"]);
  });

  it("orders chains deterministically by their root's content-order position", () => {
    const tree = buildTechTree(content());
    // decisions.json order: test-suite, ci-cd, basic-dev, agent, ...
    expect(tree.chains.map((c) => c.name)).toEqual(["Add test suite", "Hire basic developer", "Add coding agent"]);
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
