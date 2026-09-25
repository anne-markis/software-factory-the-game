import type {
  ChallengeDef,
  DecisionCategory,
  DecisionDef,
  Effect,
  EraEntryPredicate,
  ErasConfig,
  GameContent,
} from "../../src/engine/types";

export type GraphNodeKind = "era" | "decision" | "challenge";
export type GraphEdgeKind =
  | "requires"
  | "requires-count"
  | "synergy"
  | "era-entry"
  | "challenge-requires-any"
  | "challenge-lacks";
export type DecisionAvailability = "always-available" | "gated";
export type DecisionOwnership = "unique" | "repeatable";
export type GraphChipKind = "availability" | "ownership" | "category" | "flag" | "challenge";

export interface GraphChip {
  kind: GraphChipKind;
  label: string;
}

export interface GraphNode {
  id: string;
  sourceId: string;
  kind: GraphNodeKind;
  eraId: string;
  title: string;
  description: string;
  tier: number;
  criteria: string[];
  chips: GraphChip[];
  effectLines: string[];
  category?: DecisionCategory;
  availability?: DecisionAvailability;
  ownership?: DecisionOwnership;
  removable?: boolean;
  human?: boolean;
  treeParentSourceId?: string;
  ambient?: boolean;
  probabilityPerDay?: number;
  cooldownDays?: number;
  perHumanDev?: boolean;
  hasChoice?: boolean;
  conditionLines: string[];
}

export interface GraphEdge {
  id: string;
  kind: GraphEdgeKind;
  from: string;
  to: string;
  label: string;
  eraId: string;
}

export interface StudioTreeNode {
  nodeId: string;
  children: StudioTreeNode[];
}

export interface InheritedChallengeWire {
  challengeNodeId: string;
  decisionSourceIds: string[];
}

export interface EraStudioColumn {
  eraId: string;
  eraNodeId: string;
  decisionRoots: StudioTreeNode[];
  challengesByDecisionId: Record<string, string[]>;
  ambientChallengeIds: string[];
  wiredToInherited: InheritedChallengeWire[];
  nativeDecisionCount: number;
  nativeChallengeCount: number;
}

export interface ContentGraph {
  eras: ErasConfig["eras"];
  nodes: GraphNode[];
  edges: GraphEdge[];
  columns: EraStudioColumn[];
}

export const decisionNodeId = (eraId: string, decisionId: string): string =>
  `decision:${eraId}:${decisionId}`;

export const challengeNodeId = (eraId: string, challengeId: string): string =>
  `challenge:${eraId}:${challengeId}`;

export const eraNodeId = (eraId: string): string => `era:${eraId}`;

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatCurrency(value: number): string {
  return `$${formatNumber(value)}`;
}

export function formatDecisionCost(decision: DecisionDef): string {
  const perHuman = decision.agent ? "/human" : "";
  const parts: string[] = [];
  if (decision.cost.oneTime !== undefined) {
    parts.push(`${formatCurrency(decision.cost.oneTime)}${perHuman} once`);
  }
  if (decision.cost.perDay !== undefined) {
    parts.push(`${formatCurrency(decision.cost.perDay)}${perHuman}/day`);
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

export function formatProbabilityPerDay(probability: number): string {
  return `${formatNumber(probability * 100)}%/day`;
}

export function formatCategory(category: DecisionCategory): string {
  return category.replaceAll("-", " ");
}

export function formatEffect(effect: Effect): string {
  const duration = (days: number | undefined, body: string): string =>
    days === undefined ? body : `${body} for ${days}d`;

  switch (effect.type) {
    case "modifyRate": {
      const target = effect.target === "all" ? "all rates" : effect.target;
      const body =
        effect.op === "mul" ? `${target} ×${formatNumber(effect.value)}` : `${target} ${signed(effect.value)}/day`;
      const scaled =
        effect.op === "add" && effect.scaleFromHumansPer !== undefined
          ? `${body} (+${formatNumber(effect.scaleFromHumansPer * 100)}%/human)`
          : body;
      return duration(effect.durationDays, scaled);
    }
    case "modifyDebtMultiplier": {
      const body =
        effect.op === "mul" ? `debt ×${formatNumber(effect.value)}` : `debt ${signed(effect.value)}`;
      return duration(effect.durationDays, body);
    }
    case "addToStock":
      return `${effect.stock} ${signed(effect.value)}`;
    case "scaleStock":
      return `${effect.stock} ×${formatNumber(effect.factor)}`;
    case "sickness":
      return `sickness ×${formatNumber(effect.factor)} for ${effect.durationDays}d`;
    case "rampRate":
      return `${effect.target} +${formatNumber(effect.perDay)}/day up to +${formatNumber(effect.cap)}`;
    case "continuousDeploy":
      return "continuous deploy (removes Done)";
    case "removeHuman":
      return "loses a developer";
    case "modifyCapacity": {
      const body =
        effect.op === "mul" ? `capacity ×${formatNumber(effect.value)}` : `capacity ${signed(effect.value)}`;
      return duration(effect.durationDays, body);
    }
    case "scaleDecisionGrant":
      return `${effect.targetDecision} ${effect.stock} ×${formatNumber(effect.factor)}`;
    case "keepProject":
      return `keeps ${effect.project} scheduled`;
    case "autoSchedule":
      return `auto-schedules ${effect.projectIds.join(", ")}`;
    case "sellCompany":
      return `sell company +$${formatNumber(effect.budgetGrant)}`;
    default: {
      const exhaustive: never = effect;
      return exhaustive;
    }
  }
}

function signed(value: number): string {
  return value >= 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

export function decisionAvailability(decision: DecisionDef): DecisionAvailability {
  const gated = (decision.requires?.length ?? 0) > 0 || (decision.requiresCounts?.length ?? 0) > 0;
  return gated ? "gated" : "always-available";
}

export function primaryParentId(decision: DecisionDef): string | undefined {
  if ((decision.requires?.length ?? 0) > 0) return decision.requires![0];
  if ((decision.requiresCounts?.length ?? 0) > 0) return decision.requiresCounts![0].id;
  return undefined;
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

function decisionEffectLines(decision: DecisionDef): string[] {
  const lines: string[] = [];
  if (decision.capacity) lines.push(`capacity +${formatNumber(decision.capacity)}`);
  for (const grant of decision.capacityFromOwned ?? []) {
    lines.push(`capacity +${formatNumber(grant.per)} per owned ${grant.id}`);
  }
  for (const effect of decision.effects) lines.push(formatEffect(effect));
  if (decision.incomePerDay) lines.push(`income ${formatCurrency(decision.incomePerDay)}/day`);
  if (decision.incomeFromStock) {
    lines.push(
      `income ${formatCurrency(decision.incomeFromStock.perUnit)}/${decision.incomeFromStock.stock}/day`,
    );
  }
  if (decision.burstFromStock) {
    lines.push(
      `burst ${formatNumber(decision.burstFromStock.probabilityPerDay * 100)}%/${decision.burstFromStock.stock}/day of ${formatCurrency(decision.burstFromStock.perUnit)}/sale`,
    );
  }
  for (const mod of decision.stockFlowMods ?? []) {
    const parts: string[] = [];
    if (mod.acquirePerDayDelta !== undefined) parts.push(`acquire ${signed(mod.acquirePerDayDelta)}/day`);
    if (mod.churnRateDelta !== undefined) parts.push(`churn ${signed(mod.churnRateDelta)}`);
    if (parts.length > 0) lines.push(`${mod.stock} flow: ${parts.join(", ")}`);
  }
  if (decision.gamble && decision.gamble.length > 0) {
    lines.push(
      `gamble: ${decision.gamble
        .map((outcome) => `${outcome.label} ${formatNumber(outcome.probability * 100)}%`)
        .join("; ")}`,
    );
  }
  return lines;
}

function decisionChips(decision: DecisionDef): GraphChip[] {
  const availability = decisionAvailability(decision);
  const chips: GraphChip[] = [
    {
      kind: "availability",
      label: availability === "always-available" ? "always available" : "gated",
    },
    { kind: "ownership", label: decision.unique ? "unique" : "repeatable" },
    { kind: "category", label: formatCategory(decision.category) },
  ];
  if (!decision.removable) chips.push({ kind: "flag", label: "locked" });
  if (decision.human) chips.push({ kind: "flag", label: "human" });
  if ((decision.gamble?.length ?? 0) > 0) chips.push({ kind: "flag", label: "gamble" });
  return chips;
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
  for (const replacement of decision.replacesGamble ?? []) {
    const name = decisionsById.get(replacement.id)?.name ?? replacement.id;
    criteria.push(`Replaces gamble of: ${name}`);
  }
  return criteria;
}

export function challengeConditionLines(
  challenge: ChallengeDef,
  decisionsById: ReadonlyMap<string, DecisionDef>,
): string[] {
  const lines: string[] = [];
  const condition = challenge.condition;
  if (!condition && !challenge.probScaling) return lines;
  if (condition?.minHumanDevs !== undefined) lines.push(`Humans ≥ ${formatNumber(condition.minHumanDevs)}`);
  if (condition?.maxHumanDevs !== undefined) lines.push(`Humans ≤ ${formatNumber(condition.maxHumanDevs)}`);
  if (condition?.minTechDebt !== undefined) lines.push(`Tech debt ≥ ${formatNumber(condition.minTechDebt)}`);
  if (condition?.minDay !== undefined) lines.push(`Day ≥ ${formatNumber(condition.minDay)}`);
  if (condition?.minCompletedProjects !== undefined) {
    lines.push(`Completed projects ≥ ${formatNumber(condition.minCompletedProjects)}`);
  }
  if (condition?.requiresAnyDecision) {
    const names = condition.requiresAnyDecision.map((id) => decisionsById.get(id)?.name ?? id);
    lines.push(`Owns any of: ${names.join(", ")}`);
  }
  if (condition?.lacksDecision) {
    const name = decisionsById.get(condition.lacksDecision)?.name ?? condition.lacksDecision;
    lines.push(`Does not own: ${name}`);
  }
  if (challenge.probScaling) {
    lines.push(
      `+${formatNumber(challenge.probScaling.add)} probability per ${formatNumber(challenge.probScaling.per)} tech debt`,
    );
  }
  return lines;
}

function challengeEffectLines(challenge: ChallengeDef): string[] {
  const lines = challenge.effects.map(formatEffect);
  if (!challenge.choice) return lines;
  const options = challenge.choice.options.map((option) => option.label).join(" / ");
  lines.push(
    `choice (${challenge.choice.expiresInDays}d, default ${challenge.choice.defaultOptionId}): ${options}`,
  );
  return lines;
}

function challengeChips(challenge: ChallengeDef, ambient: boolean): GraphChip[] {
  const chips: GraphChip[] = [
    { kind: "challenge", label: "challenge" },
    { kind: "availability", label: ambient ? "ambient" : "gated by cards" },
    { kind: "flag", label: formatProbabilityPerDay(challenge.probabilityPerDay) },
  ];
  if (challenge.cooldownDays) chips.push({ kind: "flag", label: `${challenge.cooldownDays}d cooldown` });
  if (challenge.perHumanDev) chips.push({ kind: "flag", label: "per human" });
  if (challenge.choice) chips.push({ kind: "flag", label: "choice" });
  return chips;
}

function catalogOrigins(
  contentsByEra: ReadonlyMap<string, GameContent>,
  eraOrder: readonly { id: string }[],
  pick: (content: GameContent) => readonly { id: string }[],
): Map<string, string> {
  const origin = new Map<string, string>();
  for (const era of eraOrder) {
    const content = contentsByEra.get(era.id);
    if (!content) continue;
    for (const entry of pick(content)) {
      if (!origin.has(entry.id)) origin.set(entry.id, era.id);
    }
  }
  return origin;
}

function wouldCreateCycle(childId: string, parentId: string, parentByChild: ReadonlyMap<string, string>): boolean {
  let cursor: string | undefined = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === childId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parentByChild.get(cursor);
  }
  return false;
}

function assignTreeParents(
  native: readonly DecisionDef[],
  originById: ReadonlyMap<string, string>,
  eraId: string,
): Map<string, string> {
  const parentByChild = new Map<string, string>();
  for (const decision of native) {
    const parentId = primaryParentId(decision);
    if (!parentId || parentId === decision.id) continue;
    if (originById.get(parentId) !== eraId) continue;
    if (wouldCreateCycle(decision.id, parentId, parentByChild)) continue;
    parentByChild.set(decision.id, parentId);
  }
  return parentByChild;
}

function buildDecisionForest(
  native: readonly DecisionDef[],
  parentByChild: ReadonlyMap<string, string>,
  eraId: string,
): StudioTreeNode[] {
  const childrenByParent = new Map<string, string[]>();
  for (const decision of native) {
    const parentId = parentByChild.get(decision.id);
    if (!parentId) continue;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(decision.id);
    childrenByParent.set(parentId, siblings);
  }

  const walk = (sourceId: string, ancestry: ReadonlySet<string>): StudioTreeNode => {
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(sourceId);
    const childIds = (childrenByParent.get(sourceId) ?? []).filter((childId) => !nextAncestry.has(childId));
    return {
      nodeId: decisionNodeId(eraId, sourceId),
      children: childIds.map((childId) => walk(childId, nextAncestry)),
    };
  };

  return native
    .filter((decision) => !parentByChild.has(decision.id))
    .map((decision) => walk(decision.id, new Set()));
}

function addDecisionGraph(
  content: GameContent,
  nodes: GraphNode[],
  edges: GraphEdge[],
  originById: ReadonlyMap<string, string>,
  parentByChild: ReadonlyMap<string, string>,
): void {
  const eraId = content.eraId;
  if (!eraId) throw new Error("Content graph requires every GameContent bundle to have an eraId");

  const decisionsById = new Map(content.decisions.map((decision) => [decision.id, decision]));
  const tierMemo = new Map<string, number>();
  const native = content.decisions.filter((decision) => originById.get(decision.id) === eraId);

  for (const decision of native) {
    const availability = decisionAvailability(decision);
    nodes.push({
      id: decisionNodeId(eraId, decision.id),
      sourceId: decision.id,
      kind: "decision",
      eraId,
      title: decision.name,
      description: decision.description,
      tier: decisionTier(decision, decisionsById, tierMemo, new Set()),
      criteria: decisionCriteria(decision, decisionsById),
      chips: decisionChips(decision),
      effectLines: decisionEffectLines(decision),
      category: decision.category,
      availability,
      ownership: decision.unique ? "unique" : "repeatable",
      removable: decision.removable,
      human: Boolean(decision.human),
      treeParentSourceId: parentByChild.get(decision.id),
      conditionLines: [],
    });

    for (const [index, requiredId] of (decision.requires ?? []).entries()) {
      const requiredName = decisionsById.get(requiredId)?.name ?? requiredId;
      const fromEra = originById.get(requiredId) ?? eraId;
      edges.push({
        id: `requires:${eraId}:${requiredId}:${decision.id}:${index}`,
        kind: "requires",
        from: decisionNodeId(fromEra, requiredId),
        to: decisionNodeId(eraId, decision.id),
        label: `Requires ${requiredName}`,
        eraId,
      });
    }

    for (const [index, requirement] of (decision.requiresCounts ?? []).entries()) {
      const requiredName = decisionsById.get(requirement.id)?.name ?? requirement.id;
      const fromEra = originById.get(requirement.id) ?? eraId;
      edges.push({
        id: `requires-count:${eraId}:${requirement.id}:${decision.id}:${index}`,
        kind: "requires-count",
        from: decisionNodeId(fromEra, requirement.id),
        to: decisionNodeId(eraId, decision.id),
        label: `Requires ${requirement.count}× ${requiredName}`,
        eraId,
      });
    }

    for (const [index, synergy] of (decision.synergies ?? []).entries()) {
      const providerName = decisionsById.get(synergy.ifOwned)?.name ?? synergy.ifOwned;
      const fromEra = originById.get(synergy.ifOwned) ?? eraId;
      edges.push({
        id: `synergy:${eraId}:${synergy.ifOwned}:${decision.id}:${index}`,
        kind: "synergy",
        from: decisionNodeId(fromEra, synergy.ifOwned),
        to: decisionNodeId(eraId, decision.id),
        label: `Synergy if ${providerName} owned`,
        eraId,
      });
    }

    for (const [index, replacement] of (decision.replacesGamble ?? []).entries()) {
      const targetName = decisionsById.get(replacement.id)?.name ?? replacement.id;
      const toEra = originById.get(replacement.id) ?? eraId;
      edges.push({
        id: `synergy:${eraId}:${decision.id}:${replacement.id}:${index}`,
        kind: "synergy",
        from: decisionNodeId(eraId, decision.id),
        to: decisionNodeId(toEra, replacement.id),
        label: `Replaces gamble of ${targetName}`,
        eraId,
      });
    }
  }
}

function challengeDecisionRefs(challenge: ChallengeDef): { anyOf: string[]; lacks?: string } {
  return {
    anyOf: challenge.condition?.requiresAnyDecision ?? [],
    lacks: challenge.condition?.lacksDecision,
  };
}

function addChallengeGraph(
  content: GameContent,
  nodes: GraphNode[],
  edges: GraphEdge[],
  originByDecision: ReadonlyMap<string, string>,
  originByChallenge: ReadonlyMap<string, string>,
  column: EraStudioColumn,
): void {
  const eraId = content.eraId;
  if (!eraId) throw new Error("Content graph requires every GameContent bundle to have an eraId");

  const decisionsById = new Map(content.decisions.map((decision) => [decision.id, decision]));
  const native = content.challenges.filter((challenge) => originByChallenge.get(challenge.id) === eraId);
  column.nativeChallengeCount = native.length;

  for (const challenge of native) {
    const refs = challengeDecisionRefs(challenge);
    const allRefs = [...refs.anyOf, ...(refs.lacks ? [refs.lacks] : [])];
    const nativeRefs = allRefs.filter((id) => originByDecision.get(id) === eraId);
    const inheritedRefs = allRefs.filter((id) => originByDecision.get(id) !== eraId);
    const ambient = allRefs.length === 0;
    const nodeId = challengeNodeId(eraId, challenge.id);

    nodes.push({
      id: nodeId,
      sourceId: challenge.id,
      kind: "challenge",
      eraId,
      title: challenge.name,
      description: challenge.description,
      tier: 0,
      criteria: [
        `Probability: ${formatProbabilityPerDay(challenge.probabilityPerDay)}`,
        ...(challenge.cooldownDays ? [`Cooldown: ${challenge.cooldownDays}d`] : []),
        ...challengeConditionLines(challenge, decisionsById),
      ],
      chips: challengeChips(challenge, ambient),
      effectLines: challengeEffectLines(challenge),
      ambient,
      probabilityPerDay: challenge.probabilityPerDay,
      cooldownDays: challenge.cooldownDays,
      perHumanDev: Boolean(challenge.perHumanDev),
      hasChoice: Boolean(challenge.choice),
      conditionLines: challengeConditionLines(challenge, decisionsById),
    });

    if (ambient) {
      column.ambientChallengeIds.push(nodeId);
    }

    for (const [index, decisionId] of refs.anyOf.entries()) {
      const fromEra: string = originByDecision.get(decisionId) ?? eraId;
      const decisionName = decisionsById.get(decisionId)?.name ?? decisionId;
      edges.push({
        id: `challenge-requires-any:${eraId}:${decisionId}:${challenge.id}:${index}`,
        kind: "challenge-requires-any",
        from: decisionNodeId(fromEra, decisionId),
        to: nodeId,
        label: `Enables ${challenge.name} while ${decisionName} owned`,
        eraId,
      });
      if (fromEra === eraId) {
        const decisionGraphId = decisionNodeId(eraId, decisionId);
        const attached = column.challengesByDecisionId[decisionGraphId] ?? [];
        attached.push(nodeId);
        column.challengesByDecisionId[decisionGraphId] = attached;
      }
    }

    if (refs.lacks) {
      const fromEra: string = originByDecision.get(refs.lacks) ?? eraId;
      const decisionName = decisionsById.get(refs.lacks)?.name ?? refs.lacks;
      edges.push({
        id: `challenge-lacks:${eraId}:${refs.lacks}:${challenge.id}`,
        kind: "challenge-lacks",
        from: decisionNodeId(fromEra, refs.lacks),
        to: nodeId,
        label: `Enables ${challenge.name} while ${decisionName} is not owned`,
        eraId,
      });
      if (fromEra === eraId) {
        const decisionGraphId = decisionNodeId(eraId, refs.lacks);
        const attached = column.challengesByDecisionId[decisionGraphId] ?? [];
        attached.push(nodeId);
        column.challengesByDecisionId[decisionGraphId] = attached;
      }
    }

    if (inheritedRefs.length > 0) {
      column.wiredToInherited.push({ challengeNodeId: nodeId, decisionSourceIds: inheritedRefs });
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
  const originByDecision = catalogOrigins(contentsByEra, eras.eras, (content) => content.decisions);
  const originByChallenge = catalogOrigins(contentsByEra, eras.eras, (content) => content.challenges);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const columns: EraStudioColumn[] = [];

  for (const [eraIndex, era] of eras.eras.entries()) {
    const entryCriteria = (era.entryAnyOf ?? []).map(formatEraEntryPredicate);
    const eraIdForNode = eraNodeId(era.id);
    nodes.push({
      id: eraIdForNode,
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
      chips: [{ kind: "flag", label: era.id === eras.startingEraId ? "starting era" : "later era" }],
      effectLines: [],
      conditionLines: [],
    });

    const content = contentsByEra.get(era.id);
    if (!content) throw new Error(`Content graph is missing the parsed "${era.id}" era bundle`);
    const nativeDecisions = content.decisions.filter((decision) => originByDecision.get(decision.id) === era.id);
    const parentByChild = assignTreeParents(nativeDecisions, originByDecision, era.id);
    const column: EraStudioColumn = {
      eraId: era.id,
      eraNodeId: eraIdForNode,
      decisionRoots: buildDecisionForest(nativeDecisions, parentByChild, era.id),
      challengesByDecisionId: {},
      ambientChallengeIds: [],
      wiredToInherited: [],
      nativeDecisionCount: nativeDecisions.length,
      nativeChallengeCount: 0,
    };
    addDecisionGraph(content, nodes, edges, originByDecision, parentByChild);
    addChallengeGraph(content, nodes, edges, originByDecision, originByChallenge, column);
    columns.push(column);

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

  return { eras: eras.eras, nodes, edges, columns };
}
