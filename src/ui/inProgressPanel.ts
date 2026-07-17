import type { GameContent, GameState } from "../engine/types";
import { effectiveRate, contextSwitchTax } from "../engine/modifiers";
import { esc } from "./render";

interface ContributorNode {
  label: string;
  dim: boolean;
}

// Challenge/choice modifier sources look like "chal-prod-incident-d103"; strip
// the "chal-" prefix and the trailing "-dNNN" day-stamp to get a readable name.
function cleanSourceLabel(source: string): string {
  return source.replace(/^chal-/, "").replace(/-d\d+$/, "");
}

function contribution(op: "add" | "mul", value: number): string {
  if (op === "add") return `${value >= 0 ? "+" : ""}${value}/day`; // negatives carry their own sign
  return `x${value}`;
}

function buildNodes(state: Readonly<GameState>, content: GameContent): ContributorNode[] {
  const nodes: ContributorNode[] = [{ label: `Base ${state.baseRates.finish.toFixed(1)}/day`, dim: false }];
  const instanceIds = new Set(state.decisions.map((d) => d.instanceId));

  for (const inst of state.decisions) {
    const mods = state.modifiers.filter(
      (m) => m.source === inst.instanceId && (m.target === "finish" || m.target === "allRates"),
    );
    if (mods.length === 0) continue;
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    const sick = inst.sickUntilDay !== undefined && inst.sickUntilDay > state.day;
    const contributions = mods.map((m) => contribution(m.op, m.value)).join(", ");
    const gamble = inst.gambleLabel ? ` [${inst.gambleLabel}]` : "";
    const sickSuffix = sick ? " (sick)" : "";
    nodes.push({ label: `${def.name}${gamble}: ${contributions}${sickSuffix}`, dim: sick });
  }

  for (const m of state.modifiers) {
    if (m.target !== "finish" && m.target !== "allRates") continue;
    if (instanceIds.has(m.source)) continue; // already covered above as an owned-decision node
    const cleaned = cleanSourceLabel(m.source);
    const expiry = m.expiresDay !== undefined ? ` (${m.expiresDay - state.day}d left)` : "";
    nodes.push({ label: `${cleaned}: ${contribution(m.op, m.value)}${expiry}`, dim: false });
  }

  if (state.projects.length > 1) {
    nodes.push({ label: `Context switch x${contextSwitchTax(state).toFixed(2)}`, dim: false });
  }

  return nodes;
}

export function inProgressPanelSvg(state: Readonly<GameState>, content: GameContent): string {
  const nodes = buildNodes(state, content);
  const height = 30 + nodes.length * 34 + 20;
  const boxW = 200;
  const boxH = 50;
  const boxX = 860 - boxW - 10;
  const boxY = height / 2 - boxH / 2;
  const rate = `${effectiveRate(state, "finish").toFixed(1)}/day`;

  const lines = nodes
    .map((n, i) => {
      const y = 20 + i * 34;
      const opacity = n.dim ? ` opacity="0.5"` : "";
      return `
      <line x1="600" y1="${y + 5}" x2="${boxX}" y2="${boxY + boxH / 2}" stroke="currentColor" stroke-dasharray="2 2"/>
      <text x="10" y="${y + 10}" font-size="12"${opacity}>${esc(n.label)}</text>`;
    })
    .join("");

  const svg = `
    <svg viewBox="0 0 860 ${height}" width="100%" role="img" aria-label="Inside In Progress">
      ${lines}
      <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" fill="none" stroke="currentColor"/>
      <text x="${boxX + boxW / 2}" y="${boxY + 20}" text-anchor="middle" font-size="12">In Progress -&gt; Done</text>
      <text x="${boxX + boxW / 2}" y="${boxY + 38}" text-anchor="middle" font-size="14" font-weight="bold">${rate}</text>
    </svg>`;

  return `<div class="panel"><h3>Inside In Progress</h3>${svg}</div>`;
}
