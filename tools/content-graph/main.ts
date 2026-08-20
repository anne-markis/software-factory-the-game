import { loadShippedContent } from "../../src/engine/loadShippedContent";
import { buildGraphModel, type ContentGraph, type GraphEdge, type GraphNode } from "./graphModel";
import "./styles.css";

const SVG_NS = "http://www.w3.org/2000/svg";

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
  // The first load parses eras.json; each subsequent load resolves that era
  // (inherited prior rungs + this folder's delta) through loadActiveContent.
  const active = loadShippedContent();
  if (!active.eras) throw new Error("Shipped content did not include an eras catalog");
  return buildGraphModel(active.eras.eras.map((era) => loadShippedContent(era.id)));
}

function criteriaList(criteria: readonly string[]): HTMLUListElement {
  const list = element("ul", "criteria-list");
  for (const criterion of criteria) {
    list.append(element("li", undefined, criterion));
  }
  return list;
}

function renderDecision(node: GraphNode): HTMLElement {
  const card = element("article", "decision-card");
  card.dataset.nodeId = node.id;
  card.append(
    element("p", "node-id", node.sourceId),
    element("h3", undefined, node.title),
    element("p", "description", node.description),
    criteriaList(node.criteria),
  );
  return card;
}

function renderEraNode(node: GraphNode): HTMLElement {
  const card = element("header", "era-card");
  card.dataset.nodeId = node.id;
  const headingGroup = element("div");
  headingGroup.append(element("p", "eyebrow", "Era"), element("h2", undefined, node.title));
  card.append(headingGroup, element("p", "era-description", node.description), criteriaList(node.criteria));
  return card;
}

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function addMarker(defs: SVGDefsElement, kind: GraphEdge["kind"], color: string): void {
  const marker = svgElement("marker");
  marker.id = `arrow-${kind}`;
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "8");
  marker.setAttribute("refX", "7");
  marker.setAttribute("refY", "4");
  marker.setAttribute("orient", "auto");
  marker.setAttribute("markerUnits", "strokeWidth");
  const arrow = svgElement("path");
  arrow.setAttribute("d", "M 0 0 L 8 4 L 0 8 z");
  arrow.setAttribute("fill", color);
  marker.append(arrow);
  defs.append(marker);
}

function edgeGeometry(
  edge: GraphEdge,
  from: DOMRect,
  to: DOMRect,
  canvas: DOMRect,
  parallelIndex: number,
  parallelCount: number,
): string {
  const spread = (parallelIndex - (parallelCount - 1) / 2) * 22;
  const local = (rect: DOMRect) => ({
    left: rect.left - canvas.left,
    right: rect.right - canvas.left,
    top: rect.top - canvas.top,
    bottom: rect.bottom - canvas.top,
    centerX: rect.left - canvas.left + rect.width / 2,
    centerY: rect.top - canvas.top + rect.height / 2,
  });
  const start = local(from);
  const end = local(to);

  if (edge.kind === "era-entry") {
    const x1 = start.right;
    const y1 = start.centerY + spread;
    const x2 = end.left;
    const y2 = end.centerY + spread;
    const bend = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }

  if (end.top >= start.bottom) {
    const x1 = start.centerX + spread;
    const y1 = start.bottom;
    const x2 = end.centerX + spread;
    const y2 = end.top;
    const bend = Math.max(28, Math.abs(y2 - y1) / 2);
    return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
  }

  const forward = end.centerX >= start.centerX;
  const x1 = forward ? start.right : start.left;
  const x2 = forward ? end.left : end.right;
  const y1 = start.centerY + spread;
  const y2 = end.centerY + spread;
  const direction = forward ? 1 : -1;
  const bend = Math.max(36, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend * direction} ${y1}, ${x2 - bend * direction} ${y2}, ${x2} ${y2}`;
}

function drawEdges(
  canvas: HTMLElement,
  svg: SVGSVGElement,
  edges: readonly GraphEdge[],
  renderedNodes: ReadonlyMap<string, HTMLElement>,
): void {
  const width = canvas.scrollWidth;
  const height = canvas.scrollHeight;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.querySelector(".edge-layer")?.remove();

  const layer = svgElement("g");
  layer.classList.add("edge-layer");
  const canvasRect = canvas.getBoundingClientRect();

  for (const edge of edges) {
    const fromElement = renderedNodes.get(edge.from);
    const toElement = renderedNodes.get(edge.to);
    if (!fromElement || !toElement) continue;

    const parallel = edges.filter((candidate) => candidate.from === edge.from && candidate.to === edge.to);
    const pathData = edgeGeometry(
      edge,
      fromElement.getBoundingClientRect(),
      toElement.getBoundingClientRect(),
      canvasRect,
      parallel.indexOf(edge),
      parallel.length,
    );
    const path = svgElement("path");
    path.classList.add("edge", `edge-${edge.kind}`);
    path.setAttribute("d", pathData);
    path.setAttribute("marker-end", `url(#arrow-${edge.kind})`);
    layer.append(path);
  }
  svg.append(layer);
}

function renderLegend(): HTMLElement {
  const legend = element("div", "legend");
  const entries: Array<[GraphEdge["kind"], string]> = [
    ["requires", "Requires"],
    ["requires-count", "Requires count"],
    ["synergy", "Synergy ifOwned"],
    ["era-entry", "Era entryAnyOf"],
  ];
  for (const [kind, label] of entries) {
    const item = element("span", "legend-item");
    item.append(element("i", `legend-line legend-${kind}`), document.createTextNode(label));
    legend.append(item);
  }
  return legend;
}

function render(model: ContentGraph, root: HTMLElement): void {
  const decisionCount = model.nodes.filter((node) => node.kind === "decision").length;
  const header = element("header", "page-header");
  const titleGroup = element("div");
  titleGroup.append(
    element("p", "eyebrow", "Local authoring tool"),
    element("h1", undefined, "Software Factory content graph"),
    element(
      "p",
      "intro",
      `${decisionCount} decisions across ${model.eras.length} eras, parsed through loadShippedContent and the engine Zod schemas.`,
    ),
  );
  header.append(titleGroup, renderLegend());

  const viewport = element("div", "graph-viewport");
  const canvas = element("div", "graph-canvas");
  canvas.style.gridTemplateColumns = `repeat(${model.eras.length}, minmax(24rem, 1fr))`;
  const svg = svgElement("svg");
  svg.classList.add("edge-overlay");
  svg.setAttribute("aria-hidden", "true");
  const defs = svgElement("defs");
  addMarker(defs, "requires", "#f6c453");
  addMarker(defs, "requires-count", "#ff8f66");
  addMarker(defs, "synergy", "#be8cff");
  addMarker(defs, "era-entry", "#66d9ef");
  svg.append(defs);
  canvas.append(svg);
  const renderedNodes = new Map<string, HTMLElement>();

  for (const era of model.eras) {
    const column = element("section", "era-column");
    column.setAttribute("aria-labelledby", `era-heading-${era.id}`);
    const eraNode = model.nodes.find((node) => node.kind === "era" && node.eraId === era.id);
    if (!eraNode) continue;
    const eraCard = renderEraNode(eraNode);
    renderedNodes.set(eraNode.id, eraCard);
    eraCard.querySelector("h2")!.id = `era-heading-${era.id}`;
    column.append(eraCard);

    const decisions = model.nodes.filter((node) => node.kind === "decision" && node.eraId === era.id);
    const tiers = [...new Set(decisions.map((node) => node.tier))].sort((a, b) => a - b);
    if (tiers.length === 0) {
      column.append(element("p", "empty-era", "No decisions shipped in this era yet."));
    }
    for (const tier of tiers) {
      const tierSection = element("section", "tier");
      tierSection.append(element("h3", "tier-heading", `Prerequisite tier ${tier}`));
      const cards = element("div", "tier-cards");
      for (const decision of decisions.filter((node) => node.tier === tier)) {
        const card = renderDecision(decision);
        renderedNodes.set(decision.id, card);
        cards.append(card);
      }
      tierSection.append(cards);
      column.append(tierSection);
    }
    canvas.append(column);
  }
  viewport.append(canvas);
  root.replaceChildren(header, viewport);

  const redraw = () => drawEdges(canvas, svg, model.edges, renderedNodes);
  requestAnimationFrame(redraw);
  new ResizeObserver(redraw).observe(canvas);
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app mount point");

try {
  render(shippedGraphModel(), root);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const failure = element("main", "load-error");
  failure.append(
    element("p", "eyebrow", "Content validation failed"),
    element("h1", undefined, "Unable to build the content graph"),
    element("pre", undefined, message),
  );
  root.replaceChildren(failure);
  throw error;
}
