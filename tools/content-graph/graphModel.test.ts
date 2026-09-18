import { describe, expect, it } from "vitest";
import { loadShippedContent } from "../../src/engine/loadShippedContent";
import type { DecisionDef, GameContent } from "../../src/engine/types";
import {
  buildGraphModel,
  decisionAvailability,
  formatDecisionCost,
  formatEffect,
  formatEraEntryPredicate,
  formatProbabilityPerDay,
  primaryParentId,
  type StudioTreeNode,
} from "./graphModel";

function shippedEraBundles(): GameContent[] {
  const active = loadShippedContent();
  if (!active.eras) throw new Error("Expected shipped content to include eras");
  return active.eras.eras.map((era) => loadShippedContent(era.id));
}

function findTreeNode(roots: readonly StudioTreeNode[], nodeId: string): StudioTreeNode | undefined {
  for (const root of roots) {
    if (root.nodeId === nodeId) return root;
    const found = findTreeNode(root.children, nodeId);
    if (found) return found;
  }
  return undefined;
}

describe("content graph model", () => {
  it("formats decision costs and compound era-entry predicates from fixtures", () => {
    const decision = (cost: DecisionDef["cost"]): DecisionDef => ({
      id: "fixture",
      name: "Fixture",
      description: "Fixture decision",
      category: "ship-faster",
      cost,
      effects: [],
      removable: true,
    });

    expect(formatDecisionCost(decision({}))).toBe("Free");
    expect(formatDecisionCost(decision({ oneTime: 1250.5, perDay: 2.25 }))).toBe(
      "$1,250.5 once + $2.25/day",
    );
    expect(
      formatEraEntryPredicate({
        minBudget: 12345.67,
        minReputation: 8.5,
        minCompletedProjects: 3,
        minUsers: 1250,
      }),
    ).toBe(
      "Budget ≥ $12,345.67 AND Reputation ≥ 8.5 AND Completed projects ≥ 3 AND Users ≥ 1,250",
    );
  });

  it("derives Studio decision nodes, costs, requires, and count gates from shipped parsed content", () => {
    const model = buildGraphModel(shippedEraBundles());
    const studioDecisions = model.nodes.filter(
      (node) => node.kind === "decision" && node.eraId === "studio",
    );

    expect(studioDecisions.length).toBeGreaterThan(0);
    expect(studioDecisions.map((node) => node.sourceId)).toEqual(
      expect.arrayContaining(["test-suite", "ci-cd", "agent", "agent-orchestration"]),
    );
    const ciCd = studioDecisions.find((node) => node.sourceId === "ci-cd");
    expect(ciCd?.tier).toBeGreaterThan(0);
    expect(ciCd?.criteria.some((criterion) => criterion.startsWith("Cost: "))).toBe(true);
    expect(ciCd?.criteria.some((criterion) => criterion.startsWith("Requires: "))).toBe(true);

    expect(model.edges).toContainEqual(
      expect.objectContaining({
        kind: "requires",
        from: "decision:studio:test-suite",
        to: "decision:studio:ci-cd",
      }),
    );
    expect(model.edges).toContainEqual(
      expect.objectContaining({
        kind: "requires-count",
        from: "decision:studio:agent",
        to: "decision:studio:agent-orchestration",
      }),
    );
  });

  it("does not repeat inherited Studio decisions as Company or Megacorp nodes", () => {
    const model = buildGraphModel(shippedEraBundles());
    const studioIds = model.nodes
      .filter((node) => node.kind === "decision" && node.eraId === "studio")
      .map((node) => node.sourceId);
    expect(studioIds).toContain("test-suite");
    expect(
      model.nodes.filter((node) => node.kind === "decision" && node.eraId === "company"),
    ).toEqual([]);
    expect(
      model.nodes.filter((node) => node.kind === "decision" && node.eraId === "megacorp"),
    ).toEqual([]);
  });

  it("turns every shipped entryAnyOf path into a labeled edge between era nodes", () => {
    const model = buildGraphModel(shippedEraBundles());
    const eraEdges = model.edges.filter((edge) => edge.kind === "era-entry");

    expect(eraEdges.length).toBeGreaterThan(0);
    expect(eraEdges).toContainEqual(
      expect.objectContaining({
        from: "era:studio",
        to: "era:company",
      }),
    );
    expect(eraEdges).toContainEqual(
      expect.objectContaining({
        from: "era:company",
        to: "era:megacorp",
      }),
    );
    const companyCriteria = model.nodes.find((node) => node.id === "era:company")?.criteria;
    expect(companyCriteria?.length).toBeGreaterThan(0);
    expect(companyCriteria?.every((criterion) => criterion.startsWith("Entry path "))).toBe(true);
  });

  it("models a synergy ifOwned as a dashed-provider edge when authored", () => {
    const bundles = shippedEraBundles();
    const studio = bundles.find((content) => content.eraId === "studio")!;
    const withSynergy: GameContent = {
      ...studio,
      decisions: studio.decisions.map((decision) =>
        decision.id === "agent"
          ? {
              ...decision,
              synergies: [{ ifOwned: "better-tooling", effects: [] }],
            }
          : decision,
      ),
    };
    const model = buildGraphModel(
      bundles.map((content) => (content.eraId === "studio" ? withSynergy : content)),
    );

    expect(model.edges).toContainEqual(
      expect.objectContaining({
        kind: "synergy",
        from: "decision:studio:better-tooling",
        to: "decision:studio:agent",
      }),
    );
    expect(
      model.nodes
        .find((node) => node.id === "decision:studio:agent")
        ?.criteria.some((criterion) => criterion.startsWith("Synergy if owned: ")),
    ).toBe(true);
  });

  it("labels always-available vs gated and unique vs repeatable from shipped flags", () => {
    const model = buildGraphModel(shippedEraBundles());
    const agent = model.nodes.find((node) => node.id === "decision:studio:agent");
    const ciCd = model.nodes.find((node) => node.id === "decision:studio:ci-cd");
    const hackDay = model.nodes.find((node) => node.id === "decision:studio:hack-day");
    const hire = model.nodes.find((node) => node.id === "decision:studio:basic-dev");

    expect(agent?.availability).toBe("always-available");
    expect(agent?.ownership).toBe("repeatable");
    expect(ciCd?.availability).toBe("gated");
    expect(ciCd?.ownership).toBe("unique");
    expect(hackDay?.ownership).toBe("repeatable");
    expect(hire?.human).toBe(true);
    expect(hire?.chips.map((chip) => chip.label)).toEqual(
      expect.arrayContaining(["always available", "repeatable", "human", "gamble"]),
    );
    expect(decisionAvailability({ requires: ["x"] } as DecisionDef)).toBe("gated");
    expect(primaryParentId({ requiresCounts: [{ id: "agent", count: 2 }] } as DecisionDef)).toBe("agent");
  });

  it("nests gated Studio cards under their primary parent instead of a flat tier grid", () => {
    const model = buildGraphModel(shippedEraBundles());
    const studio = model.columns.find((column) => column.eraId === "studio");
    expect(studio).toBeDefined();
    const testSuite = findTreeNode(studio!.decisionRoots, "decision:studio:test-suite");
    const agent = findTreeNode(studio!.decisionRoots, "decision:studio:agent");
    expect(testSuite?.children.map((child) => child.nodeId)).toContain("decision:studio:ci-cd");
    expect(agent?.children.map((child) => child.nodeId)).toEqual(
      expect.arrayContaining([
        "decision:studio:review-agent",
        "decision:studio:agent-harness",
        "decision:studio:agent-orchestration",
      ]),
    );
    expect(studio!.decisionRoots.some((root) => root.nodeId === "decision:studio:ci-cd")).toBe(false);
  });

  it("adds native challenge nodes, ambient vs card-gated, and requiresAnyDecision edges", () => {
    const model = buildGraphModel(shippedEraBundles());
    const scopeCreep = model.nodes.find((node) => node.id === "challenge:studio:scope-creep");
    const deprecation = model.nodes.find((node) => node.id === "challenge:studio:model-deprecation");
    const incident = model.nodes.find((node) => node.id === "challenge:company:prod-incident");
    const studio = model.columns.find((column) => column.eraId === "studio");
    const company = model.columns.find((column) => column.eraId === "company");

    expect(scopeCreep?.kind).toBe("challenge");
    expect(scopeCreep?.ambient).toBe(true);
    expect(deprecation?.ambient).toBe(false);
    expect(studio?.ambientChallengeIds).toContain("challenge:studio:scope-creep");
    expect(studio?.challengesByDecisionId["decision:studio:agent"]).toEqual(
      expect.arrayContaining(["challenge:studio:model-deprecation", "challenge:studio:runaway-agent-loop"]),
    );
    expect(model.edges).toContainEqual(
      expect.objectContaining({
        kind: "challenge-requires-any",
        from: "decision:studio:agent",
        to: "challenge:studio:model-deprecation",
      }),
    );
    expect(company?.nativeDecisionCount).toBe(0);
    expect(company?.ambientChallengeIds).toContain("challenge:company:prod-incident");
    expect(incident?.eraId).toBe("company");
    expect(
      model.nodes.filter((node) => node.kind === "challenge" && node.eraId === "megacorp"),
    ).toEqual([]);
  });

  it("formats authored effects and challenge probabilities for the inspector", () => {
    expect(
      formatEffect({ type: "modifyRate", target: "all", op: "mul", value: 0.5, durationDays: 6 }),
    ).toBe("all rates ×0.5 for 6d");
    expect(formatEffect({ type: "continuousDeploy" })).toBe("continuous deploy (removes Done)");
    expect(formatProbabilityPerDay(0.01)).toBe("1%/day");
    expect(formatProbabilityPerDay(0.001)).toBe("0.1%/day");
  });
});
