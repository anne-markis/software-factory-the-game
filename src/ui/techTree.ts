import type { DecisionDef, GameContent } from "../engine/types";

// Groups decisions into requires-chains for the tech-tree view (see
// renderDecisions in render.ts). Pure and unit-testable in isolation from
// rendering/HTML concerns -- see techTree.test.ts.

export interface TechChain {
  // Named after the chain's tier-0 root (see buildTechTree).
  name: string;
  // tiers[0] is the chain's roots (no requires within the chain); tiers[n]
  // holds every node whose longest requires-path from a root is n.
  tiers: DecisionDef[][];
}

export interface TechTree {
  chains: TechChain[];
  // Single-node components: no requires, and required by nothing else.
  standalone: DecisionDef[];
}

export function buildTechTree(content: GameContent): TechTree {
  const decisions = content.decisions;
  const indexById = new Map(decisions.map((d, i) => [d.id, i]));
  const byId = new Map(decisions.map((d) => [d.id, d]));

  // Undirected adjacency over the requires graph, purely for grouping
  // decisions into connected components -- direction is reintroduced below
  // when computing tiers.
  const adj = new Map<string, Set<string>>();
  for (const d of decisions) adj.set(d.id, new Set());
  for (const d of decisions) {
    for (const req of d.requires ?? []) {
      if (!byId.has(req)) continue; // defensive: no dangling requires in shipped content
      adj.get(d.id)!.add(req);
      adj.get(req)!.add(d.id);
    }
  }

  // Connected components, discovered in content order so component order
  // (and the eventual chain order) is deterministic tick to tick.
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const d of decisions) {
    if (visited.has(d.id)) continue;
    const stack = [d.id];
    visited.add(d.id);
    const comp: string[] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const next of adj.get(cur)!) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    components.push(comp);
  }

  const chains: TechChain[] = [];
  const standalone: DecisionDef[] = [];

  for (const comp of components) {
    if (comp.length === 1) {
      standalone.push(byId.get(comp[0])!);
      continue;
    }

    const compSet = new Set(comp);
    const tierCache = new Map<string, number>();
    const tierOf = (id: string): number => {
      const cached = tierCache.get(id);
      if (cached !== undefined) return cached;
      const def = byId.get(id)!;
      const reqsInComp = (def.requires ?? []).filter((r) => compSet.has(r));
      const tier = reqsInComp.length === 0 ? 0 : 1 + Math.max(...reqsInComp.map(tierOf));
      tierCache.set(id, tier);
      return tier;
    };

    let maxTier = 0;
    for (const id of comp) maxTier = Math.max(maxTier, tierOf(id));

    const tiers: DecisionDef[][] = Array.from({ length: maxTier + 1 }, () => []);
    for (const id of comp) tiers[tierOf(id)].push(byId.get(id)!);
    for (const tier of tiers) tier.sort((a, b) => indexById.get(a.id)! - indexById.get(b.id)!);

    const name = tiers[0][0].name;
    chains.push({ name, tiers });
  }

  // Deterministic order: chains by their root's content-order position,
  // standalone items by content order.
  chains.sort((a, b) => indexById.get(a.tiers[0][0].id)! - indexById.get(b.tiers[0][0].id)!);
  standalone.sort((a, b) => indexById.get(a.id)! - indexById.get(b.id)!);

  return { chains, standalone };
}
