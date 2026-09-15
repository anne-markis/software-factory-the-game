import type { DecisionCategory } from "../../src/engine/types";
import type {
  ContentGraph,
  DecisionAvailability,
  DecisionOwnership,
  EraStudioColumn,
  GraphNode,
  StudioTreeNode,
} from "./graphModel";

export interface StudioFilters {
  search: string;
  category: "" | DecisionCategory;
  availability: "" | DecisionAvailability | "ambient" | "gated-by-cards";
  ownership: "" | DecisionOwnership;
  eraId: string;
}

export const EMPTY_FILTERS: StudioFilters = {
  search: "",
  category: "",
  availability: "",
  ownership: "",
  eraId: "",
};

function haystack(node: GraphNode): string {
  return [node.sourceId, node.title, node.description, ...node.effectLines, ...node.conditionLines]
    .join(" ")
    .toLowerCase();
}

export function nodeMatchesFilters(node: GraphNode, filters: StudioFilters): boolean {
  if (node.kind === "era") return false;
  if (filters.eraId && node.eraId !== filters.eraId) return false;
  if (filters.search) {
    const query = filters.search.trim().toLowerCase();
    if (query.length > 0 && !haystack(node).includes(query)) return false;
  }

  if (node.kind === "decision") {
    if (filters.category && node.category !== filters.category) return false;
    if (filters.ownership && node.ownership !== filters.ownership) return false;
    if (filters.availability === "always-available" || filters.availability === "gated") {
      if (node.availability !== filters.availability) return false;
    } else if (filters.availability === "ambient" || filters.availability === "gated-by-cards") {
      return false;
    }
    return true;
  }

  if (filters.category || filters.ownership) return false;
  if (filters.availability === "always-available" || filters.availability === "gated") return false;
  if (filters.availability === "ambient" && !node.ambient) return false;
  if (filters.availability === "gated-by-cards" && node.ambient) return false;
  return true;
}

function ancestorPath(
  roots: readonly StudioTreeNode[],
  targetId: string,
  path: string[] = [],
): string[] | undefined {
  for (const node of roots) {
    const next = [...path, node.nodeId];
    if (node.nodeId === targetId) return next;
    const found = ancestorPath(node.children, targetId, next);
    if (found) return found;
  }
  return undefined;
}

export function visibleNodeIds(graph: ContentGraph, filters: StudioFilters): Set<string> {
  const matching = new Set(
    graph.nodes.filter((node) => nodeMatchesFilters(node, filters)).map((node) => node.id),
  );
  const visible = new Set(matching);

  const addDecisionContext = (column: EraStudioColumn, decisionId: string): void => {
    const path = ancestorPath(column.decisionRoots, decisionId);
    if (path) {
      for (const id of path) visible.add(id);
      return;
    }
    visible.add(decisionId);
  };

  for (const column of graph.columns) {
    if (filters.eraId && column.eraId !== filters.eraId) continue;

    for (const matchId of matching) addDecisionContext(column, matchId);

    for (const [decisionId, challengeIds] of Object.entries(column.challengesByDecisionId)) {
      const matchingAttached = challengeIds.filter((id) => matching.has(id));
      if (matchingAttached.length > 0) {
        addDecisionContext(column, decisionId);
        for (const id of matchingAttached) visible.add(id);
      }
      if (matching.has(decisionId)) {
        for (const id of challengeIds) visible.add(id);
      }
    }
  }

  return visible;
}

export function visibleColumns(graph: ContentGraph, filters: StudioFilters): EraStudioColumn[] {
  if (!filters.eraId) return [...graph.columns];
  return graph.columns.filter((column) => column.eraId === filters.eraId);
}

export function filterTree(roots: readonly StudioTreeNode[], visible: ReadonlySet<string>): StudioTreeNode[] {
  const next: StudioTreeNode[] = [];
  for (const root of roots) {
    const children = filterTree(root.children, visible);
    if (visible.has(root.nodeId) || children.length > 0) {
      next.push({ nodeId: root.nodeId, children });
    }
  }
  return next;
}
