import type { GameContent, GameState, Modifier } from "../engine/types";
import { effectiveDebtMultiplier, contextSwitchTax, debtDragMultiplier } from "../engine/modifiers";
import { continuousDeployActive } from "../engine/continuousDeploy";
import { esc } from "./render";

interface ContributorNode {
  label: string;
  dim: boolean;
}

type RateGroup = "speed" | "friction";

// Challenge/choice modifier sources look like "chal-prod-incident-d103"; strip
// the "chal-" prefix and the trailing "-dNNN" day-stamp to get a readable name.
function cleanSourceLabel(source: string): string {
  return source.replace(/^chal-/, "").replace(/-d\d+$/, "");
}

// Ramp modifiers (rampPerDay set) accumulate via repeated += of small float
// increments (e.g. 0.02/day), so their raw value drifts like 0.39999999999999997.
// Round those to one decimal for display and flag them as still-growing;
// non-ramp contributions are shown at full precision as before.
function contribution(op: "add" | "mul", value: number, ramping = false): string {
  if (op === "add") {
    const display = ramping ? value.toFixed(1) : `${value}`;
    const suffix = ramping ? " (ramping)" : "";
    return `${value >= 0 ? "+" : ""}${display}/day${suffix}`; // negatives carry their own sign
  }
  return `x${value}`;
}

// Pure classification: which contributor-group panel a finish/allRates
// modifier belongs in. Accelerating modifiers (positive add, mul >= 1) feed
// "Cycle speed"; dragging modifiers (negative add, mul < 1) feed "Friction".
// Only meaningful for modifiers already known to target finish/allRates.
function classifyRateModifier(m: Modifier): RateGroup {
  if (m.op === "mul") return m.value >= 1 ? "speed" : "friction";
  return m.value < 0 ? "friction" : "speed";
}

// Builds the "Cycle speed" or "Friction" contributor stack: same owned-vs-
// non-instance label formatting as the old fan-in panel, but filtered to
// only the modifiers that classify into the requested group. An instance
// with modifiers split across both groups (unusual but not disallowed) will
// appear in both, each time showing only that group's contribution.
function buildRateGroupNodes(state: Readonly<GameState>, content: GameContent, group: RateGroup): ContributorNode[] {
  const nodes: ContributorNode[] = [];
  if (group === "speed") nodes.push({ label: `Base ${state.baseRates.finish.toFixed(1)}/day`, dim: false });

  const instanceIds = new Set(state.decisions.map((d) => d.instanceId));

  for (const inst of state.decisions) {
    const mods = state.modifiers.filter(
      (m) =>
        (m.target === "finish" || m.target === "allRates") &&
        m.source === inst.instanceId &&
        classifyRateModifier(m) === group,
    );
    if (mods.length === 0) continue;
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    const sick = inst.sickUntilDay !== undefined && inst.sickUntilDay > state.day;
    const contributions = mods.map((m) => contribution(m.op, m.value, m.rampPerDay !== undefined)).join(", ");
    const gamble = inst.gambleLabel ? ` [${inst.gambleLabel}]` : "";
    const sickSuffix = sick ? " (sick)" : "";
    nodes.push({ label: `${def.name}${gamble}: ${contributions}${sickSuffix}`, dim: sick });
  }

  for (const m of state.modifiers) {
    if (m.target !== "finish" && m.target !== "allRates") continue;
    if (classifyRateModifier(m) !== group) continue;
    if (instanceIds.has(m.source)) continue; // already covered above as an owned-decision node
    const cleaned = cleanSourceLabel(m.source);
    const expiry = m.expiresDay !== undefined ? ` (${m.expiresDay - state.day}d left)` : "";
    nodes.push({ label: `${cleaned}: ${contribution(m.op, m.value, m.rampPerDay !== undefined)}${expiry}`, dim: false });
  }

  if (group === "friction" && state.projects.length > 1) {
    nodes.push({ label: `Context switch x${contextSwitchTax(state).toFixed(2)}`, dim: false });
  }

  // Tech-debt drag (Release 15): once the debt stock climbs past its grace
  // band the multiplier drops below 1 and shows here as friction. It scales
  // all rates (effectiveRate), so it feeds the outer Delivery loop implicitly
  // via the rates -- no separate node is needed there.
  if (group === "friction") {
    const drag = debtDragMultiplier(state);
    if (drag < 1) nodes.push({ label: `Tech debt drag x${drag.toFixed(2)}`, dim: false });
  }

  return nodes;
}

// Builds the "Leak size" contributor stack from every debtMultiplier-target
// modifier. Deliberately not sick-dimmed: sickness (modifiers.ts,
// sickFactorFor) only ever discounts add-op rate modifiers, so it has no
// real effect on a debt modifier's contribution -- dimming it here would
// show a visual cue with no underlying numeric meaning.
function buildLeakNodes(state: Readonly<GameState>, content: GameContent): ContributorNode[] {
  const nodes: ContributorNode[] = [{ label: `Base x${state.debtMultiplierBase}`, dim: false }];
  const instanceIds = new Set(state.decisions.map((d) => d.instanceId));

  for (const inst of state.decisions) {
    const mods = state.modifiers.filter((m) => m.target === "debtMultiplier" && m.source === inst.instanceId);
    if (mods.length === 0) continue;
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    const contributions = mods.map((m) => contribution(m.op, m.value, m.rampPerDay !== undefined)).join(", ");
    const gamble = inst.gambleLabel ? ` [${inst.gambleLabel}]` : "";
    nodes.push({ label: `${def.name}${gamble}: ${contributions}`, dim: false });
  }

  for (const m of state.modifiers) {
    if (m.target !== "debtMultiplier") continue;
    if (instanceIds.has(m.source)) continue;
    const cleaned = cleanSourceLabel(m.source);
    const expiry = m.expiresDay !== undefined ? ` (${m.expiresDay - state.day}d left)` : "";
    nodes.push({ label: `${cleaned}: ${contribution(m.op, m.value, m.rampPerDay !== undefined)}${expiry}`, dim: false });
  }

  return nodes;
}

function ellipsePoint(cx: number, cy: number, rx: number, ry: number, deg: number): [number, number] {
  const t = (deg * Math.PI) / 180;
  return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
}

// A short tangent segment on the loop's circumference, arrowhead pointing in
// the direction of increasing `deg`. With SVG's y-down axis, cos/sin swept
// through increasing degrees reads as clockwise on screen, matching work
// flowing around "In Progress" and out through the exit arrow.
function loopFlowArrow(cx: number, cy: number, rx: number, ry: number, deg: number): string {
  const [x1, y1] = ellipsePoint(cx, cy, rx, ry, deg - 9);
  const [x2, y2] = ellipsePoint(cx, cy, rx, ry, deg + 9);
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="currentColor" stroke-width="2" marker-end="url(#ipArrow)"/>`;
}

const ROW_H = 15;
const HEADER_GAP = 20;

// Renders one contributor stack (bold header + item lines) and reports the
// stack's vertical midpoint, used to anchor the thin connector line back to
// the loop. Kept together (header immediately followed by its own items) so
// each group is a single contiguous chunk in the emitted markup -- tests
// locate a label's group by which pair of header strings it falls between.
function renderStack(
  x: number,
  top: number,
  header: string,
  nodes: readonly ContributorNode[],
): { svg: string; midY: number; bottom: number } {
  const headerSvg = `<text x="${x}" y="${top}" font-size="16" font-weight="bold" fill="currentColor">${esc(header)}</text>`;
  const itemsSvg = nodes
    .map((n, i) => {
      const y = top + HEADER_GAP + i * ROW_H;
      const opacity = n.dim ? ` opacity="0.5"` : "";
      return `<text x="${x}" y="${y}" font-size="13" fill="currentColor"${opacity}>${esc(n.label)}</text>`;
    })
    .join("");
  const count = nodes.length;
  const midY = count > 0 ? top + HEADER_GAP + ((count - 1) * ROW_H) / 2 : top + HEADER_GAP / 2;
  const bottom = top + (count > 0 ? HEADER_GAP + count * ROW_H : HEADER_GAP);
  return { svg: headerSvg + itemsSvg, midY, bottom };
}

function connector(x1: number, y1: number, x2: number, y2: number, dashed: boolean): string {
  const dash = dashed ? ` stroke-dasharray="3 3"` : "";
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="currentColor"${dash}/>`;
}

const VIEW_W = 860;
const LEFT_X = 10;
const LEFT_CONNECTOR_X = 235;
const RIGHT_X = 655;
const RIGHT_CONNECTOR_X = 645;
const TOP_MARGIN = 22;
const LOOP_CX = 250;
const LOOP_RX = 105;
const LOOP_RY = 62;
const STACK_LOOP_GAP = 34;
const EXIT_BOX_W = 150;
const EXIT_BOX_H = 54;
const EXIT_GAP = 65;
const FOOTER_GAP = 34;

// Once Friction is visible, reserve a small cushion so one or two temporary
// drag rows can appear/disappear without resizing the whole page. Do not
// reserve for absent friction or for hypothetical growth in unrelated groups:
// the SVG should track the actual content in the common fresh/no-friction case.
const FRICTION_RESERVE_ROWS = 3;

export function inProgressPanelSvg(state: Readonly<GameState>, content: GameContent): string {
  const speedNodes = buildRateGroupNodes(state, content, "speed");
  const frictionNodes = buildRateGroupNodes(state, content, "friction");
  const leakNodes = buildLeakNodes(state, content);

  // Layout: "Cycle speed" (upper-left) and "Leak size" (upper-right) share
  // the same starting row; the loop sits below whichever of the two stacks
  // is taller, so neither stack's items ever collide with the ellipse.
  // "Friction" (lower-left) is anchored below the loop instead, since its
  // connector targets the loop's lower arc.
  const speedTmp = renderStack(LEFT_X, TOP_MARGIN, "Cycle speed", speedNodes);
  const leakTmp = renderStack(RIGHT_X, TOP_MARGIN, "Leak size", leakNodes);
  const topStacksBottom = Math.max(speedTmp.bottom, leakTmp.bottom);

  const loopTopY = topStacksBottom + STACK_LOOP_GAP;
  const loopCy = loopTopY + LOOP_RY;
  const loopBottomY = loopCy + LOOP_RY;

  const frictionTop = loopBottomY + STACK_LOOP_GAP;
  const friction = renderStack(LEFT_X, frictionTop, "Friction", frictionNodes);

  // Leak arc: dashed curve off the loop's lower-right, sweeping further
  // right and down, ending well clear of the exit box above it.
  const [leakStartX, leakStartY] = ellipsePoint(LOOP_CX, loopCy, LOOP_RX, LOOP_RY, 55);
  const leakEndX = Math.min(VIEW_W - 60, LOOP_CX + LOOP_RX + 260);
  const leakEndY = loopBottomY + 110;
  const c1x = leakStartX + 70;
  const c1y = leakStartY + 30;
  const c2x = leakEndX - 90;
  const c2y = leakEndY - 50;

  const actualContentBottom = Math.max(friction.bottom, leakEndY + 50, loopCy + EXIT_BOX_H / 2 + 40);
  const reservedFrictionBottom =
    frictionNodes.length > 0
      ? frictionTop + HEADER_GAP + Math.max(frictionNodes.length, FRICTION_RESERVE_ROWS) * ROW_H
      : friction.bottom;
  const totalHeight = Math.max(actualContentBottom, reservedFrictionBottom) + FOOTER_GAP;

  // Exit flow: solid arrow from the loop's right edge to the throughput box,
  // vertically centered on the loop.
  const [exitStartX, exitStartY] = ellipsePoint(LOOP_CX, loopCy, LOOP_RX, LOOP_RY, 0);
  const exitBoxX = LOOP_CX + LOOP_RX + EXIT_GAP;
  const exitBoxY = loopCy - EXIT_BOX_H / 2;

  const shipped = continuousDeployActive(state, content);
  // Issue #9: show the realized finish flow (what actually moved out of
  // In Progress this tick, capped by whatever was actually sitting there),
  // not the stage's uncapped capacity (effectiveRate) -- they only agree
  // once the stage is fully saturated every tick. tick.ts already computes
  // and persists this as state.finishFlow, mirroring pointsPerDay.
  const finishRate = `${state.finishFlow.toFixed(1)}/day`;
  const exitCaption = shipped ? "escapes to Shipped" : "escapes to Done";
  const debtLabel = effectiveDebtMultiplier(state).toFixed(2);

  const defs = `<defs><marker id="ipArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`;

  const loop = `
      <ellipse cx="${LOOP_CX}" cy="${loopCy}" rx="${LOOP_RX}" ry="${LOOP_RY}" fill="none" stroke="currentColor"/>
      ${loopFlowArrow(LOOP_CX, loopCy, LOOP_RX, LOOP_RY, -70)}
      ${loopFlowArrow(LOOP_CX, loopCy, LOOP_RX, LOOP_RY, 50)}
      ${loopFlowArrow(LOOP_CX, loopCy, LOOP_RX, LOOP_RY, 170)}
      <text x="${LOOP_CX}" y="${loopCy - 4}" text-anchor="middle" font-size="14" fill="currentColor">work cycling</text>
      <text x="${LOOP_CX}" y="${loopCy + 12}" text-anchor="middle" font-size="14" fill="currentColor">inside In Progress</text>`;

  // No "= outer loop throughput" caption here (issue #9): even with the
  // realized finish flow above, that equivalence isn't generally true --
  // finish and deploy are different stages, and finish flow can keep
  // outrunning deploy flow indefinitely (Done piling up) whenever ci-cd
  // isn't owned (see tick.test.ts's deploy-bottleneck cases). The footer
  // below already states the (accurate, directional) relationship.
  const exit = `
      <line x1="${exitStartX.toFixed(1)}" y1="${exitStartY.toFixed(1)}" x2="${exitBoxX - 8}" y2="${loopCy}" stroke="currentColor" marker-end="url(#ipArrow)"/>
      <rect x="${exitBoxX}" y="${exitBoxY}" width="${EXIT_BOX_W}" height="${EXIT_BOX_H}" fill="none" stroke="currentColor"/>
      <text x="${exitBoxX + EXIT_BOX_W / 2}" y="${exitBoxY + 22}" text-anchor="middle" font-size="16" font-weight="bold" fill="currentColor">${esc(finishRate)}</text>
      <text x="${exitBoxX + EXIT_BOX_W / 2}" y="${exitBoxY + 40}" text-anchor="middle" font-size="13" fill="currentColor">${esc(exitCaption)}</text>`;

  const leak = `
      <path d="M ${leakStartX.toFixed(1)} ${leakStartY.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${leakEndX.toFixed(1)} ${leakEndY.toFixed(1)}" fill="none" stroke="currentColor" stroke-dasharray="4 3" marker-end="url(#ipArrow)"/>
      <text x="${leakEndX}" y="${leakEndY + 18}" text-anchor="end" font-size="13" fill="currentColor">${esc(`rework leak x${debtLabel} per shipped point`)}</text>
      <text x="${leakEndX}" y="${leakEndY + 34}" text-anchor="end" font-size="12" fill="currentColor">refills the outer loop's Backlog</text>`;

  const speedConnectorTarget = ellipsePoint(LOOP_CX, loopCy, LOOP_RX, LOOP_RY, -120);
  const frictionConnectorTarget = ellipsePoint(LOOP_CX, loopCy, LOOP_RX, LOOP_RY, 120);

  const speed = `
      ${speedTmp.svg}
      ${connector(LEFT_CONNECTOR_X, speedTmp.midY, speedConnectorTarget[0], speedConnectorTarget[1], false)}`;

  // No drags at all: skip the header and its connector rather than pointing
  // an arrow at an empty stack.
  const frictionSvg =
    frictionNodes.length === 0
      ? ""
      : `
      ${friction.svg}
      ${connector(LEFT_CONNECTOR_X, friction.midY, frictionConnectorTarget[0], frictionConnectorTarget[1], true)}`;

  const leakStack = `
      ${leakTmp.svg}
      ${connector(RIGHT_CONNECTOR_X, leakTmp.midY, leakStartX, leakStartY, true)}`;

  const footer = `<text x="${LEFT_X}" y="${totalHeight - 10}" font-size="12" fill="currentColor">The inner loop's pace sets outer throughput; its leak feeds outer backlog.</text>`;

  const svg = `
    <svg viewBox="0 0 ${VIEW_W} ${totalHeight}" width="100%" role="img" aria-label="Progress loop">
      ${defs}
      ${loop}
      ${exit}
      ${leak}
      ${speed}
      ${frictionSvg}
      ${leakStack}
      ${footer}
    </svg>`;

  return `<div class="panel"><h3>Progress loop</h3>${svg}</div>`;
}
