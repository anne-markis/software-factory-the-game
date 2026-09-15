import { describe, expect, it } from "vitest";
import { loadShippedContent } from "../../src/engine/loadShippedContent";
import { buildGraphModel } from "./graphModel";
import { EMPTY_FILTERS, filterTree, nodeMatchesFilters, visibleColumns, visibleNodeIds } from "./studioFilters";

function shippedGraph() {
  const active = loadShippedContent();
  if (!active.eras) throw new Error("Expected shipped content to include eras");
  return buildGraphModel(active.eras.eras.map((era) => loadShippedContent(era.id)));
}

describe("content studio filters", () => {
  it("keeps ancestor cards when a gated descendant matches", () => {
    const graph = shippedGraph();
    const visible = visibleNodeIds(graph, { ...EMPTY_FILTERS, search: "ci-cd" });
    expect(visible.has("decision:studio:ci-cd")).toBe(true);
    expect(visible.has("decision:studio:test-suite")).toBe(true);
    expect(visible.has("decision:studio:agent")).toBe(false);
  });

  it("filters unique vs repeatable without dropping the unique child of a repeatable parent", () => {
    const graph = shippedGraph();
    const visible = visibleNodeIds(graph, { ...EMPTY_FILTERS, ownership: "unique" });
    expect(visible.has("decision:studio:agent-harness")).toBe(true);
    expect(visible.has("decision:studio:agent")).toBe(true);
    expect(visible.has("decision:studio:hack-day")).toBe(false);
    const studio = graph.columns.find((column) => column.eraId === "studio")!;
    const filtered = filterTree(studio.decisionRoots, visible);
    const agent = filtered.find((root) => root.nodeId === "decision:studio:agent");
    expect(agent?.children.map((child) => child.nodeId)).toEqual(
      expect.arrayContaining(["decision:studio:agent-harness", "decision:studio:agent-orchestration"]),
    );
  });

  it("can isolate always-available decisions or ambient challenges", () => {
    const graph = shippedGraph();
    const always = visibleNodeIds(graph, { ...EMPTY_FILTERS, availability: "always-available" });
    expect(always.has("decision:studio:agent")).toBe(true);
    expect(always.has("decision:studio:ci-cd")).toBe(false);
    expect(always.has("challenge:studio:scope-creep")).toBe(false);

    const ambient = visibleNodeIds(graph, { ...EMPTY_FILTERS, availability: "ambient" });
    expect(ambient.has("challenge:studio:scope-creep")).toBe(true);
    expect(ambient.has("challenge:company:prod-incident")).toBe(true);
    expect(ambient.has("challenge:studio:model-deprecation")).toBe(false);
    expect(ambient.has("decision:studio:agent")).toBe(false);
  });

  it("shows card-gated challenges and the decisions they mention", () => {
    const graph = shippedGraph();
    const visible = visibleNodeIds(graph, { ...EMPTY_FILTERS, search: "deprecation" });
    expect(visible.has("challenge:studio:model-deprecation")).toBe(true);
    expect(visible.has("decision:studio:agent")).toBe(true);
    expect(visible.has("decision:studio:agent-harness")).toBe(true);
    expect(visible.has("challenge:studio:scope-creep")).toBe(false);
  });

  it("limits columns to the selected era", () => {
    const graph = shippedGraph();
    const columns = visibleColumns(graph, { ...EMPTY_FILTERS, eraId: "company" });
    expect(columns.map((column) => column.eraId)).toEqual(["company"]);
    const companyIncident = graph.nodes.find((node) => node.sourceId === "prod-incident")!;
    expect(nodeMatchesFilters(companyIncident, { ...EMPTY_FILTERS, eraId: "studio" })).toBe(false);
    expect(nodeMatchesFilters(companyIncident, { ...EMPTY_FILTERS, eraId: "company" })).toBe(true);
  });
});
