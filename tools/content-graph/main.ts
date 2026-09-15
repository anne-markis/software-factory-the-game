import type { DecisionCategory } from "../../src/engine/types";
import { loadShippedContent } from "../../src/engine/loadShippedContent";
import {
  buildGraphModel,
  type ContentGraph,
  type EraStudioColumn,
  type GraphChip,
  type GraphNode,
  type StudioTreeNode,
} from "./graphModel";
import {
  EMPTY_FILTERS,
  filterTree,
  visibleColumns,
  visibleNodeIds,
  type StudioFilters,
} from "./studioFilters";
import "./styles.css";

const CATEGORIES: DecisionCategory[] = [
  "ship-faster",
  "earn-income",
  "tame-debt",
  "prevent-trouble",
  "change-structure",
];

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shippedGraphModel(): ContentGraph {
  const active = loadShippedContent();
  if (!active.eras) throw new Error("Shipped content did not include an eras catalog");
  return buildGraphModel(active.eras.eras.map((era) => loadShippedContent(era.id)));
}

function chipClass(chip: GraphChip): string {
  const slug = chip.label.replaceAll(" ", "-").replaceAll("/", "-");
  return `chip chip-${chip.kind} chip-${slug}`;
}

function chipRow(chips: readonly GraphChip[]): HTMLUListElement {
  const list = element("ul", "chip-row");
  for (const chip of chips) {
    list.append(element("li", chipClass(chip), chip.label));
  }
  return list;
}

function lineList(lines: readonly string[], className: string): HTMLUListElement | undefined {
  if (lines.length === 0) return undefined;
  const list = element("ul", className);
  for (const line of lines) list.append(element("li", undefined, line));
  return list;
}

function option(value: string, label: string, selected: string): HTMLOptionElement {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  node.selected = value === selected;
  return node;
}

function selectControl(
  id: string,
  label: string,
  value: string,
  options: Array<[string, string]>,
  onChange: (value: string) => void,
): HTMLLabelElement {
  const wrap = element("label", "filter-field");
  wrap.htmlFor = id;
  wrap.append(element("span", undefined, label));
  const select = document.createElement("select");
  select.id = id;
  for (const [optionValue, optionLabel] of options) {
    select.append(option(optionValue, optionLabel, value));
  }
  select.addEventListener("change", () => onChange(select.value));
  wrap.append(select);
  return wrap;
}

interface StudioState {
  filters: StudioFilters;
  selectedId: string | null;
}

function inboundEdges(model: ContentGraph, nodeId: string): string[] {
  return model.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.label);
}

function outboundDecisionWires(model: ContentGraph, nodeId: string): string[] {
  return model.edges
    .filter(
      (edge) =>
        edge.from === nodeId &&
        (edge.kind === "challenge-requires-any" || edge.kind === "challenge-lacks"),
    )
    .map((edge) => edge.label);
}

function renderInspector(model: ContentGraph, selectedId: string | null): HTMLElement {
  const pane = element("aside", "inspector");
  pane.setAttribute("aria-label", "Entry inspector");
  const node = model.nodes.find((candidate) => candidate.id === selectedId);
  if (!node || node.kind === "era") {
    pane.append(
      element("p", "eyebrow", "Inspector"),
      element("h2", undefined, "Select a card"),
      element(
        "p",
        "inspector-empty",
        "Click a decision or challenge in the tree to see cost, effects, gates, and wiring.",
      ),
    );
    return pane;
  }

  pane.append(
    element("p", "eyebrow", node.kind === "challenge" ? "Challenge" : "Decision"),
    element("p", "node-id", node.sourceId),
    element("h2", undefined, node.title),
    chipRow(node.chips),
    element("p", "description", node.description),
  );

  const details = element("dl", "inspector-facts");
  const addFact = (label: string, value: string): void => {
    details.append(element("dt", undefined, label), element("dd", undefined, value));
  };
  addFact("Era", node.eraId);
  if (node.kind === "decision") {
    addFact("Cost", node.criteria.find((line) => line.startsWith("Cost: "))?.slice("Cost: ".length) ?? "Free");
    addFact("Shop", node.availability === "always-available" ? "always available" : "gated");
    addFact("Ownership", node.ownership === "unique" ? "unique (one copy)" : "repeatable");
    addFact("Removable", node.removable ? "yes" : "no (locked)");
    if (node.human) addFact("Headcount", "counts as human");
  } else {
    if (node.probabilityPerDay !== undefined) {
      addFact(
        "Probability",
        node.criteria.find((line) => line.startsWith("Probability: "))?.slice("Probability: ".length) ?? "",
      );
    }
    if (node.cooldownDays) addFact("Cooldown", `${node.cooldownDays}d`);
    addFact("Roll", node.perHumanDev ? "once per human" : "once per tick (if eligible)");
    addFact("Resolution", node.hasChoice ? "player choice" : "applies effects");
  }
  pane.append(details);

  const requires = node.criteria.filter((line) => line.startsWith("Requires: ") || line.startsWith("Synergy "));
  const requireList = lineList(requires, "inspector-list");
  if (requireList) {
    pane.append(element("h3", undefined, "Gates"), requireList);
  }

  const conditionList = lineList(node.conditionLines, "inspector-list");
  if (conditionList) {
    pane.append(element("h3", undefined, "Conditions"), conditionList);
  }

  const effectList = lineList(node.effectLines, "inspector-list");
  pane.append(element("h3", undefined, "Effects"), effectList ?? element("p", "muted", "No direct effects."));

  const wires = [
    ...inboundEdges(model, node.id).filter((label) => !requires.includes(label.replace(/^Requires /, "Requires: "))),
    ...outboundDecisionWires(model, node.id),
  ];
  const uniqueWires = [...new Set(wires)];
  if (node.kind === "decision") {
    const challengeWires = outboundDecisionWires(model, node.id);
    if (challengeWires.length > 0) {
      pane.append(element("h3", undefined, "Challenges that mention this card"), lineList(challengeWires, "inspector-list")!);
    }
  }
  if (node.kind === "challenge" && uniqueWires.length > 0) {
    pane.append(element("h3", undefined, "Wired from"), lineList(uniqueWires, "inspector-list")!);
  }

  if (node.effectLines.some((line) => line.includes(" for ") && line.endsWith("d"))) {
    pane.append(
      element(
        "p",
        "inspector-note",
        "Durations are authored durationDays. A purchase-time modifier is felt for durationDays − 1 ticks; challenge mid-tick effects last the full authored window.",
      ),
    );
  }

  return pane;
}

function renderDecisionCard(
  node: GraphNode,
  selected: boolean,
  onSelect: (id: string) => void,
): HTMLButtonElement {
  const card = element("button", `node-card decision-card${selected ? " is-selected" : ""}`) as HTMLButtonElement;
  card.type = "button";
  card.dataset.nodeId = node.id;
  card.setAttribute("aria-pressed", selected ? "true" : "false");
  card.append(
    element("p", "node-id", node.sourceId),
    element("h3", undefined, node.title),
    chipRow(node.chips),
  );
  const preview = node.effectLines[0];
  if (preview) card.append(element("p", "effect-preview", preview));
  card.addEventListener("click", () => onSelect(node.id));
  return card;
}

function renderChallengeCard(
  node: GraphNode,
  selected: boolean,
  onSelect: (id: string) => void,
): HTMLButtonElement {
  const card = element(
    "button",
    `node-card challenge-card${node.ambient ? " is-ambient" : ""}${selected ? " is-selected" : ""}`,
  ) as HTMLButtonElement;
  card.type = "button";
  card.dataset.nodeId = node.id;
  card.setAttribute("aria-pressed", selected ? "true" : "false");
  card.append(
    element("p", "node-id", node.sourceId),
    element("h3", undefined, node.title),
    chipRow(node.chips),
  );
  card.addEventListener("click", () => onSelect(node.id));
  return card;
}

function renderTree(
  roots: readonly StudioTreeNode[],
  nodesById: ReadonlyMap<string, GraphNode>,
  column: EraStudioColumn,
  visible: ReadonlySet<string>,
  selectedId: string | null,
  onSelect: (id: string) => void,
): HTMLUListElement {
  const list = element("ul", "tree");
  for (const root of roots) {
    const node = nodesById.get(root.nodeId);
    if (!node) continue;
    const item = element("li", "tree-item");
    item.append(renderDecisionCard(node, selectedId === node.id, onSelect));
    const attached = (column.challengesByDecisionId[node.id] ?? [])
      .map((id) => nodesById.get(id))
      .filter((challenge): challenge is GraphNode => Boolean(challenge) && visible.has(challenge!.id));
    const childTree = root.children.length > 0
      ? renderTree(root.children, nodesById, column, visible, selectedId, onSelect)
      : undefined;
    if (attached.length > 0) {
      const challengeList = element("ul", "tree tree-challenges");
      for (const challenge of attached) {
        const challengeItem = element("li", "tree-item");
        challengeItem.append(renderChallengeCard(challenge, selectedId === challenge.id, onSelect));
        challengeList.append(challengeItem);
      }
      item.append(challengeList);
    }
    if (childTree && childTree.childElementCount > 0) item.append(childTree);
    list.append(item);
  }
  return list;
}

function renderEraColumn(
  model: ContentGraph,
  column: EraStudioColumn,
  visible: ReadonlySet<string>,
  selectedId: string | null,
  onSelect: (id: string) => void,
): HTMLElement {
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const eraNode = nodesById.get(column.eraNodeId);
  const section = element("section", "era-column");
  section.setAttribute("aria-labelledby", `era-heading-${column.eraId}`);
  if (eraNode) {
    const header = element("header", "era-card");
    header.dataset.nodeId = eraNode.id;
    const headingGroup = element("div");
    headingGroup.append(element("p", "eyebrow", "Era"), element("h2", undefined, eraNode.title));
    headingGroup.querySelector("h2")!.id = `era-heading-${column.eraId}`;
    header.append(headingGroup, element("p", "era-description", eraNode.description), chipRow(eraNode.chips));
    const entry = lineList(eraNode.criteria, "criteria-list");
    if (entry) header.append(entry);
    section.append(header);
  }

  const roots = filterTree(column.decisionRoots, visible);
  if (roots.length === 0) {
    section.append(
      element(
        "p",
        "empty-era",
        column.nativeDecisionCount === 0
          ? "No native decisions in this era. Cards inherit from earlier rungs; later folders are deltas."
          : "No decisions match the current filters.",
      ),
    );
  } else {
    section.append(
      element("h3", "lane-heading", "Decision tree"),
      renderTree(roots, nodesById, column, visible, selectedId, onSelect),
    );
  }

  const ambient = column.ambientChallengeIds
    .filter((id) => visible.has(id))
    .map((id) => nodesById.get(id))
    .filter((node): node is GraphNode => Boolean(node));
  if (ambient.length > 0) {
    const lane = element("section", "ambient-lane");
    lane.append(element("h3", "lane-heading", "Ambient challenges"));
    const cards = element("div", "ambient-cards");
    for (const challenge of ambient) {
      cards.append(renderChallengeCard(challenge, selectedId === challenge.id, onSelect));
    }
    lane.append(cards);
    section.append(lane);
  }

  const inheritedWires = column.wiredToInherited.filter((wire) => visible.has(wire.challengeNodeId));
  if (inheritedWires.length > 0) {
    const lane = element("section", "ambient-lane");
    lane.append(element("h3", "lane-heading", "Wired to inherited cards"));
    const cards = element("div", "ambient-cards");
    for (const wire of inheritedWires) {
      const challenge = nodesById.get(wire.challengeNodeId);
      if (!challenge) continue;
      const wrap = element("div", "inherited-wire");
      wrap.append(
        renderChallengeCard(challenge, selectedId === challenge.id, onSelect),
        element("p", "muted", `Refs: ${wire.decisionSourceIds.join(", ")}`),
      );
      cards.append(wrap);
    }
    lane.append(cards);
    section.append(lane);
  }

  if (
    column.nativeDecisionCount === 0 &&
    column.nativeChallengeCount === 0 &&
    roots.length === 0 &&
    ambient.length === 0
  ) {
    // empty-era message already covers decisions; add a second line only when
    // there are also no native challenges at all.
    const existing = section.querySelector(".empty-era");
    if (existing) {
      existing.textContent =
        "Inherits prior rungs. No native decisions or challenges shipped in this era yet.";
    }
  }

  return section;
}

function renderToolbar(
  model: ContentGraph,
  filters: StudioFilters,
  onFilters: (filters: StudioFilters) => void,
): HTMLElement {
  const bar = element("div", "toolbar");
  const searchField = element("label", "filter-field filter-search");
  searchField.htmlFor = "studio-search";
  searchField.append(element("span", undefined, "Search"));
  const search = element("input") as HTMLInputElement;
  search.id = "studio-search";
  search.type = "search";
  search.placeholder = "id, name, effect…";
  search.value = filters.search;
  search.addEventListener("input", () => onFilters({ ...filters, search: search.value }));
  searchField.append(search);
  bar.append(searchField);

  bar.append(
    selectControl(
      "studio-era",
      "Era",
      filters.eraId,
      [["", "All eras"], ...model.eras.map((era) => [era.id, era.name] as [string, string])],
      (eraId) => onFilters({ ...filters, eraId }),
    ),
    selectControl(
      "studio-category",
      "Category",
      filters.category,
      [["", "All categories"], ...CATEGORIES.map((category) => [category, category.replaceAll("-", " ")] as [string, string])],
      (category) => onFilters({ ...filters, category: category as StudioFilters["category"] }),
    ),
    selectControl(
      "studio-availability",
      "Availability",
      filters.availability,
      [
        ["", "All availability"],
        ["always-available", "Always available"],
        ["gated", "Gated decisions"],
        ["ambient", "Ambient challenges"],
        ["gated-by-cards", "Challenges gated by cards"],
      ],
      (availability) => onFilters({ ...filters, availability: availability as StudioFilters["availability"] }),
    ),
    selectControl(
      "studio-ownership",
      "Ownership",
      filters.ownership,
      [
        ["", "Unique or repeatable"],
        ["unique", "Unique"],
        ["repeatable", "Repeatable"],
      ],
      (ownership) => onFilters({ ...filters, ownership: ownership as StudioFilters["ownership"] }),
    ),
  );

  if (
    filters.search ||
    filters.category ||
    filters.availability ||
    filters.ownership ||
    filters.eraId
  ) {
    const clear = element("button", "clear-filters", "Clear filters") as HTMLButtonElement;
    clear.type = "button";
    clear.addEventListener("click", () => onFilters({ ...EMPTY_FILTERS }));
    bar.append(clear);
  }

  return bar;
}

function renderLegend(): HTMLElement {
  const legend = element("div", "legend");
  const entries: Array<[string, string]> = [
    ["always", "Always available"],
    ["gated", "Gated"],
    ["unique", "Unique"],
    ["repeatable", "Repeatable"],
    ["challenge", "Challenge"],
  ];
  for (const [kind, label] of entries) {
    const item = element("span", "legend-item");
    item.append(element("i", `legend-swatch legend-${kind}`), document.createTextNode(label));
    legend.append(item);
  }
  return legend;
}

function render(model: ContentGraph, root: HTMLElement, state: StudioState): void {
  const visible = visibleNodeIds(model, state.filters);
  const decisionCount = model.nodes.filter((node) => node.kind === "decision").length;
  const challengeCount = model.nodes.filter((node) => node.kind === "challenge").length;
  const header = element("header", "page-header");
  const titleGroup = element("div");
  titleGroup.append(
    element("p", "eyebrow", "Local authoring tool"),
    element("h1", undefined, "Software Factory content studio"),
    element(
      "p",
      "intro",
      `${decisionCount} native decisions and ${challengeCount} native challenges across ${model.eras.length} eras. Same Zod loader as the game. Not part of the player build.`,
    ),
  );
  header.append(titleGroup, renderLegend());

  const layout = element("div", "studio-layout");
  const mainPane = element("div", "studio-main");
  mainPane.append(renderToolbar(model, state.filters, (filters) => {
    state.filters = filters;
    if (state.selectedId && !visibleNodeIds(model, filters).has(state.selectedId)) {
      state.selectedId = null;
    }
    render(model, root, state);
  }));

  const viewport = element("div", "graph-viewport");
  const canvas = element("div", "graph-canvas");
  const columns = visibleColumns(model, state.filters);
  canvas.style.gridTemplateColumns = `repeat(${Math.max(columns.length, 1)}, minmax(22rem, 1fr))`;
  const onSelect = (id: string): void => {
    state.selectedId = state.selectedId === id ? null : id;
    render(model, root, state);
  };
  for (const column of columns) {
    canvas.append(renderEraColumn(model, column, visible, state.selectedId, onSelect));
  }
  viewport.append(canvas);
  mainPane.append(viewport);
  layout.append(mainPane, renderInspector(model, state.selectedId));

  const active = document.activeElement;
  const activeId = active instanceof HTMLElement ? active.id : "";
  const caret =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active.selectionStart : null;

  root.replaceChildren(header, layout);

  if (activeId) {
    const next = root.querySelector<HTMLElement>(`#${CSS.escape(activeId)}`);
    if (next instanceof HTMLInputElement || next instanceof HTMLSelectElement) {
      next.focus();
      if (next instanceof HTMLInputElement && caret !== null) next.setSelectionRange(caret, caret);
    }
  }
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app mount point");

try {
  const model = shippedGraphModel();
  const state: StudioState = { filters: { ...EMPTY_FILTERS }, selectedId: null };
  render(model, root, state);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const failure = element("main", "load-error");
  failure.append(
    element("p", "eyebrow", "Content validation failed"),
    element("h1", undefined, "Unable to build the content studio"),
    element("pre", undefined, message),
  );
  root.replaceChildren(failure);
  throw error;
}
