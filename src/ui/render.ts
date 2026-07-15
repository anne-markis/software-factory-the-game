import type { Availability } from "../engine/decisions";
import type { DecisionInstance, GameContent, GameState, PendingChoice, LogEntry, ChallengeDef } from "../engine/types";

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

export function renderDecisions(avail: Availability[], ownedInstances: DecisionInstance[], content: GameContent): string {
  const shop = avail
    .map((a) => {
      const disabled = a.purchasable ? "" : "disabled";
      const reason = a.reason ? ` (${esc(a.reason)})` : "";
      return `<div><button data-buy="${esc(a.def.id)}" ${disabled}>Buy</button> <strong>${esc(a.def.name)}</strong>${reason}<br/><small>${describeCost(a)}</small></div>`;
    })
    .join("");
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
    <div class="panel"><h3>Alter the loop</h3>${shop}</div>
    <div class="panel"><h3>Owned</h3>${ownedList || "<small>Nothing yet. You are a solo dev.</small>"}</div>`;
}

export function renderLog(log: readonly LogEntry[]): string {
  const lines = [...log].slice(-30).reverse()
    .map((entry) => `<div>Day ${entry.day}: ${esc(entry.message)}</div>`)
    .join("");
  return `<div class="panel"><h3>Events</h3><div class="log">${lines || "<small>Quiet so far.</small>"}</div></div>`;
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
