import { describe, expect, it } from "vitest";
import { loadShippedContent } from "../../src/engine/loadShippedContent";
import type { DecisionDef, GameContent } from "../../src/engine/types";
import {
  buildGraphModel,
  formatDecisionCost,
  formatEraEntryPredicate,
} from "./graphModel";

function shippedEraBundles(): GameContent[] {
  const active = loadShippedContent();
  if (!active.eras) throw new Error("Expected shipped content to include eras");
  return active.eras.eras.map((era) => loadShippedContent(era.id));
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
});
