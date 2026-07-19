import type { Availability } from "../engine/decisions";
import { contextSwitchTax } from "../engine/modifiers";
import type { ProjectAvailability } from "../engine/projects";
import type { DecisionCategory, DecisionInstance, GameContent, GameState, PendingChoice, LogEntry, ChallengeDef, ActiveProject } from "../engine/types";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function renderStats(state: Readonly<GameState>): string {
  return `
    <div class="stats">
      <span>Day ${state.day}</span>
      <span>Backlog: ${fmt(state.stocks.backlog)}</span>
      <span>In Progress: ${fmt(state.stocks.inProgress)}</span>
      <span>Done: ${fmt(state.stocks.done)}</span>
      <span>Shipped: ${fmt(state.stocks.shipped)}</span>
      <span>Budget: $${fmt(state.stocks.budget)}</span>
      <span>Tech Debt: ${fmt(state.stocks.techDebt)}</span>
      <span>Points/Day: ${fmt(state.pointsPerDay)}</span>
    </div>`;
}

function describeCost(a: Availability): string {
  const cost = [
    a.def.cost.oneTime ? `$${a.def.cost.oneTime} once` : "",
    a.def.cost.perDay ? `$${a.def.cost.perDay}/day` : "",
  ].filter(Boolean).join(" + ") || "free";
  return `${cost}. ${esc(a.def.description)}`;
}

// Fixed shop section order and headers. Every shipped decision carries a
// required category (see DecisionDef in ../engine/types), so this list is
// exhaustive over DecisionCategory -- a section simply doesn't render when
// it has no visible entries (see renderDecisions below).
const CATEGORY_SECTIONS: { id: DecisionCategory; header: string; hint: string }[] = [
  { id: "ship-faster", header: "Ship faster", hint: "(points/day)" },
  { id: "earn-income", header: "Earn income", hint: "(budget)" },
  { id: "tame-debt", header: "Tame tech debt", hint: "(debt and incident risk)" },
  { id: "prevent-trouble", header: "Prevent trouble", hint: "(events and gambles)" },
  { id: "change-structure", header: "Change the loop", hint: "(structure)" },
];

function renderShopEntry(a: Availability): string {
  const disabled = a.purchasable ? "" : "disabled";
  const reason = a.reason ? ` (${esc(a.reason)})` : "";
  return `<div><button data-buy="${esc(a.def.id)}" ${disabled}>Buy</button> <strong>${esc(a.def.name)}</strong>${reason}<br/><small>${describeCost(a)}</small></div>`;
}

export function renderDecisions(avail: Availability[], ownedInstances: DecisionInstance[], content: GameContent): string {
  const hiddenCount = avail.filter((a) => a.code === "missing-requires").length;
  const visible = avail.filter((a) => a.code !== "already-owned" && a.code !== "missing-requires");
  const shop = CATEGORY_SECTIONS
    .map(({ id, header, hint }) => {
      const entries = visible.filter((a) => a.def.category === id);
      if (entries.length === 0) return "";
      return `<h4>${esc(header)} <small>${esc(hint)}</small></h4>${entries.map(renderShopEntry).join("")}`;
    })
    .join("");
  const hiddenHint =
    hiddenCount > 0
      ? `<small>${hiddenCount} more alteration${hiddenCount === 1 ? "" : "s"} unlock as your factory grows.</small>`
      : "";
  const ownedList = ownedInstances
    .map((inst) => {
      const def = content.decisions.find((d) => d.id === inst.defId);
      if (!def) return "";
      const remove = def.removable ? `<button data-remove="${esc(inst.instanceId)}">Remove</button>` : "";
      const outcome = inst.gambleLabel ? ` [${esc(inst.gambleLabel)}]` : "";
      const sick = inst.sickUntilDay !== undefined ? " (sick)" : "";
      return `<div>${esc(def.name)}${outcome}${sick} ${remove}</div>`;
    })
    .join("");
  return `
    <div class="panel"><h3>Alter the loop</h3>${shop}${hiddenHint}</div>
    <div class="panel"><h3>Owned</h3>${ownedList || "<small>Nothing yet. You are a solo dev.</small>"}</div>`;
}

export function renderLog(log: readonly LogEntry[]): string {
  const lines = [...log].slice(-30).reverse()
    .map((entry) => `<div>Day ${entry.day}: ${esc(entry.message)}</div>`)
    .join("");
  return `<div class="panel"><h3>Events</h3><div class="log">${lines || "<small>Quiet so far.</small>"}</div></div>`;
}

export function renderProjects(
  inFlight: readonly ActiveProject[],
  offers: ProjectAvailability[],
  state: Readonly<GameState>,
): string {
  const taxNow = contextSwitchTax(state);
  const taxNext = Math.pow(state.contextSwitchFactor, inFlight.length);
  const flight = inFlight
    .map((p) => `<div>${esc(p.name)}: ${fmt(p.remaining)} points left ($${fmt(p.payoutPerPoint)}/pt, $${fmt(p.completionBonus)} on completion)</div>`)
    .join("");
  const shop = offers
    .map((o) => {
      const disabled = o.startable ? "" : "disabled";
      const reason = o.reason ? ` (${esc(o.reason)})` : "";
      return `<div><button data-project="${esc(o.def.id)}" ${disabled}>Start</button> <strong>${esc(o.def.name)}</strong>${reason}<br/>
        <small>${fmt(o.def.sizePoints)} points, costs $${fmt(o.def.upfrontCost)}, pays $${fmt(o.def.payoutPerPoint)}/pt + $${fmt(o.def.completionBonus)} bonus.
        Starting this drops efficiency to ${(taxNext * 100).toFixed(0)}%.</small></div>`;
    })
    .join("");
  return `<div class="panel"><h3>Projects (efficiency ${(taxNow * 100).toFixed(0)}%)</h3>${flight}<hr/>${shop}</div>`;
}

export function renderStall(stalled: boolean): string {
  return stalled
    ? `<div class="stall">The factory is stalled: no work in the pipeline and nothing affordable. Income may still accrue; otherwise this factory is dead.</div>`
    : "";
}

export function renderChoices(pending: readonly PendingChoice[], challenges: ChallengeDef[], day: number): string {
  if (pending.length === 0) return "";
  const blocks = pending
    .map((pc) => {
      const def = challenges.find((c) => c.id === pc.challengeId);
      if (!def?.choice) return "";
      const buttons = def.choice.options
        .map((o) => `<button data-choice="${esc(def.id)}" data-option="${esc(o.id)}">${esc(o.label)}</button>`)
        .join(" ");
      return `<div><strong>${esc(def.name)}</strong>: ${esc(def.description)} <em>(${pc.expiresDay - day} days left)</em><br/>${buttons}</div>`;
    })
    .join("");
  return `<div class="panel" style="border-color:#c00"><h3>Decision needed</h3>${blocks}</div>`;
}
