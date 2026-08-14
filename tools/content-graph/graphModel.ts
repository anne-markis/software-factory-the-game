import type {
  DecisionDef,
  EraEntryPredicate,
  ErasConfig,
  GameContent,
} from "../../src/engine/types";

export type GraphNodeKind = "era" | "decision";
export type GraphEdgeKind = "requires" | "requires-count" | "synergy" | "era-entry";

export interface GraphNode {
  id: string;
  sourceId: string;
  kind: GraphNodeKind;
  eraId: string;
  title: string;
  description: string;
  tier: number;
  criteria: string[];
}

export interface GraphEdge {
  id: string;
  kind: GraphEdgeKind;
  from: string;
  to: string;
  label: string;
  eraId: string;
}

export interface ContentGraph {
  eras: ErasConfig["eras"];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const decisionNodeId = (eraId: string, decisionId: string): string =>
  `decision:${eraId}:${decisionId}`;

const eraNodeId = (eraId: string): string => `era:${eraId}`;

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatCurrency(value: number): string {
  return `$${formatNumber(value)}`;
}

export function formatDecisionCost(decision: DecisionDef): string {
  const parts: string[] = [];
  if (decision.cost.oneTime !== undefined) {
    parts.push(`${formatCurrency(decision.cost.oneTime)} once`);
  }
  if (decision.cost.perDay !== undefined) {
    parts.push(`${formatCurrency(decision.cost.perDay)}/day`);
  }
  return parts.length > 0 ? parts.join(" + ") : "Free";
}

export function formatEraEntryPredicate(predicate: EraEntryPredicate): string {
  const criteria: string[] = [];
  if (predicate.minBudget !== undefined) {
    criteria.push(`Budget ≥ ${formatCurrency(predicate.minBudget)}`);
  }
  if (predicate.minReputation !== undefined) {
    criteria.push(`Reputation ≥ ${formatNumber(predicate.minReputation)}`);
  }
  if (predicate.minCompletedProjects !== undefined) {
    criteria.push(`Completed projects ≥ ${formatNumber(predicate.minCompletedProjects)}`);
  }
  if (predicate.minUsers !== undefined) {
    criteria.push(`Users ≥ ${formatNumber(predicate.minUsers)}`);
  }
  return criteria.join(" AND ");
}

function decisionTier(
  decision: DecisionDef,
  decisionsById: ReadonlyMap<string, DecisionDef>,
  memo: Map<string, number>,
  visiting: Set<string>,
): number {
  // Mirrors the longest-prerequisite-path tier walk in src/ui/techTree.ts,
  // while staying local so this authoring tool does not depend on player UI.
  const cached = memo.get(decision.id);
  if (cached !== undefined) return cached;
  // Content parsing rejects unknown ids. A cycle is still possible, so keep
  // the authoring viewer usable and place a cycle back-edge at tier zero.
  if (visiting.has(decision.id)) return 0;

  visiting.add(decision.id);
  const dependencies = [
    ...(decision.requires ?? []),
    ...(decision.requiresCounts ?? []).map((requirement) => requirement.id),
  ];
  const tier =
    dependencies.length === 0
      ? 0
      : 1 +
        Math.max(
          ...dependencies.map((id) => {
            const dependency = decisionsById.get(id);
            return dependency ? decisionTier(dependency, decisionsById, memo, visiting) : 0;
          }),
        );
  visiting.delete(decision.id);
  memo.set(decision.id, tier);
  return tier;
}

function decisionCriteria(
  decision: DecisionDef,
  decisionsById: ReadonlyMap<string, DecisionDef>,
): string[] {
  const criteria = [`Cost: ${formatDecisionCost(decision)}`];
  for (const requiredId of decision.requires ?? []) {
    criteria.push(`Requires: ${decisionsById.get(requiredId)?.name ?? requiredId}`);
  }
  for (const requirement of decision.requiresCounts ?? []) {
    const name = decisionsById.get(requirement.id)?.name ?? requirement.id;
    criteria.push(`Requires: ${requirement.count}× ${name}`);
  }
  for (const synergy of decision.synergies ?? []) {
    const name = decisionsById.get(synergy.ifOwned)?.name ?? synergy.ifOwned;
    criteria.push(`Synergy if owned: ${name}`);
  }
  return criteria;
}

function addDecisionGraph(
  content: GameContent,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const eraId = content.eraId;
  if (!eraId) throw new Error("Content graph requires every GameContent bundle to have an eraId");

  const decisionsById = new Map(content.decisions.map((decision) => [decision.id, decision]));
  const tierMemo = new Map<string, number>();

  for (const decision of content.decisions) {
    nodes.push({
      id: decisionNodeId(eraId, decision.id),
      sourceId: decision.id,
      kind: "decision",
      eraId,
      title: decision.name,
      description: decision.description,
      tier: decisionTier(decision, decisionsById, tierMemo, new Set()),
      criteria: decisionCriteria(decision, decisionsById),
    });

    for (const [index, requiredId] of (decision.requires ?? []).entries()) {
      const requiredName = decisionsById.get(requiredId)?.name ?? requiredId;
      edges.push({
        id: `requires:${eraId}:${requiredId}:${decision.id}:${index}`,
        kind: "requires",
        from: decisionNodeId(eraId, requiredId),
        to: decisionNodeId(eraId, decision.id),
        label: `Requires ${requiredName}`,
        eraId,
      });
    }

    for (const [index, requirement] of (decision.requiresCounts ?? []).entries()) {
      const requiredName = decisionsById.get(requirement.id)?.name ?? requirement.id;
      edges.push({
        id: `requires-count:${eraId}:${requirement.id}:${decision.id}:${index}`,
        kind: "requires-count",
        from: decisionNodeId(eraId, requirement.id),
        to: decisionNodeId(eraId, decision.id),
        label: `Requires ${requirement.count}× ${requiredName}`,
        eraId,
      });
    }

    for (const [index, synergy] of (decision.synergies ?? []).entries()) {
      const providerName = decisionsById.get(synergy.ifOwned)?.name ?? synergy.ifOwned;
      edges.push({
        id: `synergy:${eraId}:${synergy.ifOwned}:${decision.id}:${index}`,
        kind: "synergy",
        from: decisionNodeId(eraId, synergy.ifOwned),
        to: decisionNodeId(eraId, decision.id),
        label: `Synergy if ${providerName} owned`,
        eraId,
      });
    }
  }
}

export function buildGraphModel(contents: readonly GameContent[]): ContentGraph {
  if (contents.length === 0) throw new Error("Content graph requires at least one era bundle");
  const eras = contents[0].eras;
  if (!eras) throw new Error("Content graph requires the parsed eras catalog");

  const contentsByEra = new Map(
    contents.map((content) => {
      if (!content.eraId) {
        throw new Error("Content graph requires every GameContent bundle to have an eraId");
      }
      return [content.eraId, content] as const;
    }),
  );
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const [eraIndex, era] of eras.eras.entries()) {
    const entryCriteria = (era.entryAnyOf ?? []).map(formatEraEntryPredicate);
    nodes.push({
      id: eraNodeId(era.id),
      sourceId: era.id,
      kind: "era",
      eraId: era.id,
      title: era.name,
      description: era.id === eras.startingEraId ? "Starting era" : "Enter when any path is met",
      // Era headers sit outside the decision prerequisite tiers.
      tier: -1,
      criteria:
        era.id === eras.startingEraId
          ? ["Starting era"]
          : entryCriteria.map((criterion, index) => `Entry path ${index + 1}: ${criterion}`),
    });

    const content = contentsByEra.get(era.id);
    if (!content) throw new Error(`Content graph is missing the parsed "${era.id}" era bundle`);
    addDecisionGraph(content, nodes, edges);

    if (eraIndex === 0) continue;
    // eras.json is an ordered, one-way progression ladder. Each era's entry
    // paths therefore connect the immediately preceding era to this one.
    const previousEra = eras.eras[eraIndex - 1];
    for (const [entryIndex, predicate] of (era.entryAnyOf ?? []).entries()) {
      edges.push({
        id: `era-entry:${previousEra.id}:${era.id}:${entryIndex}`,
        kind: "era-entry",
        from: eraNodeId(previousEra.id),
        to: eraNodeId(era.id),
        label: `Entry path ${entryIndex + 1}: ${formatEraEntryPredicate(predicate)}`,
        eraId: era.id,
      });
    }
  }

  return { eras: eras.eras, nodes, edges };
}
