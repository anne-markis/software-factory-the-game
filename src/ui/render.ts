import type { Availability } from "../engine/decisions";
import type { ProjectAvailability } from "../engine/projects";
import type { DecisionDef, DecisionInstance, GameContent, GameState, PendingChoice, LogEntry, ChallengeDef, ActiveProject, DailyIncome, DailyExpenses } from "../engine/types";
import { effectiveRate } from "../engine/modifiers";
import { summarizeDecisionEffects } from "./effectSummary";
import { projectEffectChips, type ProjectChip, type ProjectEffectSource } from "./projectEffects";
import { SECTION_ATTR } from "./domPatch";
import { formatBuiltAt, type BuildInfo } from "./buildInfo";
import { cockpitStatViews, deliveryStatViews, statsRowHtml } from "./gameFeel";
import { formatProjectEta } from "./projectEta";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

// Top bar keeps the cockpit glanceables: clock, work waiting, money, and
// throughput. Flow-stage and quality stocks live under the Delivery loop
// (see renderDeliveryStats) so they sit next to the diagram they describe.
// Markup is shared with gameFeel.syncStatRow (in-place flash).
export function renderStats(state: Readonly<GameState>, content: GameContent): string {
  return statsRowHtml(cockpitStatViews(state, content), "stats");
}

// In Progress / Done / Shipped / Tech Debt / Reputation sit under
// the Delivery loop panel. Same fixed-width value slots as the top bar so
// ticking numbers never jitter this row either.
export function renderDeliveryStats(state: Readonly<GameState>): string {
  return statsRowHtml(deliveryStatViews(state), "delivery-stats");
}

function costLine(def: DecisionDef): string {
  return (
    [def.cost.oneTime ? `$${def.cost.oneTime} once` : "", def.cost.perDay ? `$${def.cost.perDay}/day` : ""]
      .filter(Boolean)
      .join(" + ") || "free"
  );
}

// A gamble decision's outcome is a lucky-or-unlucky roll at purchase, so it
// gets a scannable chip up top rather than relying on the "(gamble)" suffix
// buried at the end of the derived line. Empty for deterministic decisions.
function gambleTag(def: DecisionDef): string {
  return def.gamble && def.gamble.length > 0 ? `<span class="tt-gamble">gamble</span> ` : "";
}

// Renders the derived-effects line, or nothing when the decision has no
// direct effects (its authored description carries the conditional story).
function effectsLine(def: DecisionDef): string {
  const summary = summarizeDecisionEffects(def);
  return summary ? `<div class="tt-effects">${esc(summary)}</div>` : "";
}

// The decisions/tech-tree region used to be one memoized HTML
// string. When any node's availability flipped (budget crossing a cost
// threshold), every Buy button in the tree was torn down. Mirror the
// projects/choices split: a content-stable scaffold holds per-node section
// containers, and each card is patched independently.
export const OWNED_LIST_SECTION = "owned-list";
export const INCOME_CHART_SECTION = "income-chart";
export const EXPENSES_CHART_SECTION = "expenses-chart";
export const LOG_SECTION = "log";

function sideDetailsScaffold(title: string, section: string): string {
  return `<details class="panel side-details" open><summary><h3>${title}</h3></summary><div ${SECTION_ATTR}="${section}"></div></details>`;
}

export function decisionNodeSection(defId: string): string {
  return `decision-node:${defId}`;
}

// Def ids of unique decisions that currently have an owned instance.
// Those cards leave Alter the system while owned. Removable uniques
// stay in the Owned action list; non-removable uniques leave the shop
// without occupying that list.
export function ownedUniqueDefIds(
  ownedInstances: readonly DecisionInstance[],
  content: GameContent,
): Set<string> {
  const byId = new Map(content.decisions.map((d) => [d.id, d]));
  const ids = new Set<string>();
  for (const inst of ownedInstances) {
    if (byId.get(inst.defId)?.unique) ids.add(inst.defId);
  }
  return ids;
}

// Stable scaffold key so appView rebuilds shop shells only when the
// owned-unique set actually changes (buy / remove), not every tick.
export function ownedUniqueScaffoldKey(
  ownedInstances: readonly DecisionInstance[],
  content: GameContent,
): string {
  return [...ownedUniqueDefIds(ownedInstances, content)].sort().join(",");
}

// Shop-hidden ids: owned unique plus unmet-requires.
// cannot-afford stays visible; repeatable owned cards stay visible.
export function shopHiddenDefIds(
  avail: readonly Availability[],
  ownedInstances: readonly DecisionInstance[],
  content: GameContent,
): Set<string> {
  const hide = ownedUniqueDefIds(ownedInstances, content);
  for (const a of avail) {
    if (a.code === "missing-requires") hide.add(a.def.id);
  }
  return hide;
}

// Rebuild shop shells when owned-unique or missing-requires membership changes
// (buy / remove / unlock). Affordability flips still patch in place.
export function shopScaffoldKey(
  avail: readonly Availability[],
  ownedInstances: readonly DecisionInstance[],
  content: GameContent,
): string {
  return [...shopHiddenDefIds(avail, ownedInstances, content)].sort().join(",");
}

// Renders one tech-tree node card. States (mutually exclusive):
//  - owned unique: omitted from the shop; this helper returns ""
//    if called anyway
//  - owned repeatable: not dimmed, keeps the Buy button, shows "owned xN"
//  - missing-requires: omitted from the shop; defensive ""
//  - cannot-afford: Buy disabled, reason shown
//  - purchasable: Buy enabled
export function renderDecisionNode(a: Availability, ownedCount: number): string {
  const def = a.def;
  // Owned unique and unmet-requires cards are filtered out of the shop layout;
  // defensive empty return keeps a stray patch from painting a placeholder.
  if (a.code === "already-owned" || a.code === "missing-requires") return "";
  const ownedRepeatable = ownedCount > 0;
  const stateClass = a.code === "cannot-afford" ? "tt-cannot-afford" : "tt-buyable";

  const ownedTag = ownedRepeatable ? `<span class="tt-tag-state">owned x${ownedCount}</span>` : "";
  const reason = a.reason ? `<span class="tt-reason">${esc(a.reason)}</span>` : "";
  const disabled = a.purchasable ? "" : "disabled";
  const button = `<button class="tt-buy" data-buy="${esc(def.id)}" ${disabled}>Buy</button>`;

  // Slim row: shared left Buy column, then name / optional
  // gamble chip / optional owned xN / cost. Category tags are gone (sections
  // already left). Authored description + derived effects sit in a disclosure
  // (hover on desktop, tap on mobile). cannot-afford reason stays on the row
  // so a disabled Buy is explained without opening details. The derived line
  // is omitted when there is nothing to derive (synergy targets / gates).
  return `<div class="tt-node ${stateClass}">
    <div class="tt-node-row">
      ${button}
      <div class="tt-node-main">
        <button type="button" class="tt-node-disclose" aria-expanded="false">
          <span class="tt-node-name">${esc(def.name)}</span>
          ${gambleTag(def)}${ownedTag}<span class="tt-cost">${esc(costLine(def))}</span>
        </button>
        ${reason}
        <div class="tt-node-details">
          <div class="tt-node-desc">${esc(def.description)}</div>
          ${effectsLine(def)}
        </div>
      </div>
    </div>
  </div>`;
}

// Single-column shop. `renderNode` is a live card (string tests / renderDecisions) or an empty data-section shell (scaffold).
// `hideDefIds` drops owned unique and missing-requires cards.
// iterate `content.decisions` in loader/catalog order. Hidden
// ids leave a hole; they are not pulled forward or regrouped.
function renderShopLayout(
  content: GameContent,
  renderNode: (def: DecisionDef) => string,
  hideDefIds: ReadonlySet<string> = new Set(),
): string {
  const nodes = content.decisions
    .filter((def) => !hideDefIds.has(def.id))
    .map(renderNode)
    .join("");
  if (!nodes) return "";
  return `<div class="tt-shop-grid">${nodes}</div>`;
}

// Panel chrome + per-decision section shells for cards still in the shop.
// Owned unique and missing-requires defs are omitted; appView
// rebuilds this scaffold when that hide set changes so Buy-button identity
// stays stable across ticks.
// Owned lives under Events in `.side`, not under Alter the system.
export function decisionsPanelScaffold(
  content: GameContent,
  ownedInstances: readonly DecisionInstance[] = [],
  avail: readonly Availability[] = [],
): string {
  const hide = shopHiddenDefIds(avail, ownedInstances, content);
  const shop = renderShopLayout(
    content,
    (def) => `<div ${SECTION_ATTR}="${decisionNodeSection(def.id)}"></div>`,
    hide,
  );
  return `
    <div class="panel"><h3>Alter the system</h3>${shop}</div>`;
}

/** Owned panel chrome for the right rail. Starts expanded; player can collapse. */
export function ownedPanelScaffold(): string {
  return sideDetailsScaffold("Owned", OWNED_LIST_SECTION);
}

/** Income sparkline chrome. Starts expanded; player can collapse. */
export function incomePanelScaffold(): string {
  return sideDetailsScaffold("Income", INCOME_CHART_SECTION);
}

/** Expenses sparkline chrome. Starts expanded; player can collapse. */
export function expensesPanelScaffold(): string {
  return sideDetailsScaffold("Expenses", EXPENSES_CHART_SECTION);
}

/** Events panel chrome. Starts expanded; player can collapse. */
export function logPanelScaffold(): string {
  return sideDetailsScaffold("Events", LOG_SECTION);
}

// Owned is an action list: only removable instances, each with Remove,
// plus the cost/effects summary so a player trimming upkeep does not
// have to scroll Alter the system matching names card by card.
export function renderOwnedList(ownedInstances: DecisionInstance[], content: GameContent): string {
  // Newest acquisitions first (engine stores oldest-first; same as Events).
  const ownedList = [...ownedInstances]
    .reverse()
    .map((inst) => {
      const def = content.decisions.find((d) => d.id === inst.defId);
      if (!def?.removable) return "";
      const outcome = inst.gambleLabel ? ` [${esc(inst.gambleLabel)}]` : "";
      const sick = inst.sickUntilDay !== undefined ? " (sick)" : "";
      return `<div class="owned-item">
      <div class="owned-item-head">${esc(def.name)}${outcome}${sick} <button data-remove="${esc(inst.instanceId)}">Remove</button></div>
      <div class="owned-cost">${esc(costLine(def))}</div>
      ${effectsLine(def)}
    </div>`;
    })
    .join("");
  return ownedList;
}

export function renderDecisions(avail: Availability[], ownedInstances: DecisionInstance[], content: GameContent): string {
  const availById = new Map(avail.map((a) => [a.def.id, a]));
  const ownedCounts = new Map<string, number>();
  for (const inst of ownedInstances) ownedCounts.set(inst.defId, (ownedCounts.get(inst.defId) ?? 0) + 1);
  const hide = shopHiddenDefIds(avail, ownedInstances, content);
  const shop = renderShopLayout(
    content,
    (def) => renderDecisionNode(availById.get(def.id)!, ownedCounts.get(def.id) ?? 0),
    hide,
  );
  // Shop only — Owned is patched separately under Events.
  return `
    <div class="panel"><h3>Alter the system</h3>${shop}</div>`;
}

export function renderLog(log: readonly LogEntry[]): string {
  const lines = [...log].slice(-30).reverse()
    .map((entry) => `<div>Day ${entry.day}: ${esc(entry.message)}</div>`)
    .join("");
  return `<div class="log">${lines}</div>`;
}

function incomeBarHeight(amount: number, max: number): string {
  if (max <= 0 || amount <= 0) return "0";
  return `${Math.max(1, Math.round((amount / max) * 100))}%`;
}

/** Stacked recurring/burst sparkline for the last recorded days. */
export function renderIncomeChart(incomeByDay: readonly DailyIncome[]): string {
  const earned = incomeByDay.some((d) => d.recurring > 0 || d.burst > 0);
  if (!earned) {
    return `<div class="income-empty">No income yet.</div>`;
  }
  const max = Math.max(...incomeByDay.map((d) => d.recurring + d.burst), 0);
  const latest = incomeByDay[incomeByDay.length - 1]!;
  const bars = incomeByDay
    .map((d) => {
      const recH = incomeBarHeight(d.recurring, max);
      const burstH = incomeBarHeight(d.burst, max);
      const title = `Day ${d.day}: recurring $${fmt(d.recurring)}, burst $${fmt(d.burst)}`;
      return `<div class="income-col" title="${esc(title)}"><div class="income-stack"><div class="income-seg income-burst" style="height:${burstH}"></div><div class="income-seg income-recurring" style="height:${recH}"></div></div></div>`;
    })
    .join("");
  return `<div class="income-chart" role="img" aria-label="Income last ${incomeByDay.length} days, recurring and burst">
    <div class="income-bars">${bars}</div>
    <div class="income-legend">
      <span><span class="income-swatch income-recurring"></span> Recurring $${fmt(latest.recurring)}</span>
      <span><span class="income-swatch income-burst"></span> Burst $${fmt(latest.burst)}</span>
    </div>
  </div>`;
}

/** Stacked human/agents/misc sparkline for the last recorded days. */
export function renderExpensesChart(expensesByDay: readonly DailyExpenses[]): string {
  const spent = expensesByDay.some((d) => d.human > 0 || d.agents > 0 || d.misc > 0);
  if (!spent) {
    return `<div class="income-empty">No expenses yet.</div>`;
  }
  const max = Math.max(...expensesByDay.map((d) => d.human + d.agents + d.misc), 0);
  const latest = expensesByDay[expensesByDay.length - 1]!;
  const bars = expensesByDay
    .map((d) => {
      const humanH = incomeBarHeight(d.human, max);
      const agentsH = incomeBarHeight(d.agents, max);
      const miscH = incomeBarHeight(d.misc, max);
      const title = `Day ${d.day}: human $${fmt(d.human)}, agents $${fmt(d.agents)}, misc $${fmt(d.misc)}`;
      return `<div class="income-col" title="${esc(title)}"><div class="income-stack"><div class="income-seg exp-misc" style="height:${miscH}"></div><div class="income-seg exp-agents" style="height:${agentsH}"></div><div class="income-seg exp-human" style="height:${humanH}"></div></div></div>`;
    })
    .join("");
  return `<div class="income-chart" role="img" aria-label="Expenses last ${expensesByDay.length} days, human, agents, and misc">
    <div class="income-bars">${bars}</div>
    <div class="income-legend">
      <span><span class="income-swatch exp-human"></span> Human $${fmt(latest.human)}</span>
      <span><span class="income-swatch exp-agents"></span> Agents $${fmt(latest.agents)}</span>
      <span><span class="income-swatch exp-misc"></span> Misc $${fmt(latest.misc)}</span>
    </div>
  </div>`;
}

// The projects panel is split into two independently-patched sections
// The in-flight lines change on every tick that moves work, while
// the offers below them -- which carry the Start / Pursue buttons -- only change when a
// project starts, is pursued, completes, or crosses a gate. Writing the whole panel on
// every tick destroyed those buttons ~10x/second; keeping the volatile status
// block in its own container means the buttons are only rebuilt when the
// offers themselves actually change. The panel's chrome is written once at
// mount and never touched again.
export const PROJECTS_STATUS_SECTION = "projects-status";
export const PROJECTS_OFFERS_SECTION = "projects-offers";

export function projectsPanelScaffold(): string {
  // No <hr/>: status (thead + in-flight / in-plan) and offers (Available)
  // are two tables with matching colgroups so they read as one grid. The
  // split keeps Start/Pursue nodes out of the per-tick remaining patch.
  return `<div class="panel"><div ${SECTION_ATTR}="${PROJECTS_STATUS_SECTION}"></div><div ${SECTION_ATTR}="${PROJECTS_OFFERS_SECTION}"></div></div>`;
}

const PROJ_EMPTY = `<span class="proj-empty">—</span>`;

function projectColgroup(): string {
  return `<colgroup>
    <col class="proj-col-btn" />
    <col class="proj-col-name" />
    <col class="proj-col-size" />
    <col class="proj-col-ideas" />
    <col class="proj-col-rate" />
    <col class="proj-col-done" />
    <col class="proj-col-fx" />
  </colgroup>`;
}

function projectThead(): string {
  return `<thead><tr>
    <th></th>
    <th>Project</th>
    <th>Size</th>
    <th>Ideas</th>
    <th>$/pt</th>
    <th>Done $</th>
    <th>Effects</th>
  </tr></thead>`;
}

function groupRow(label: string, now = false): string {
  return `<tr class="proj-group${now ? " proj-group-now" : ""}"><td colspan="7">${esc(label)}</td></tr>`;
}

function moneyCell(n: number): string {
  return n === 0 ? PROJ_EMPTY : `$${fmt(n)}`;
}

function chipsHtml(chips: ProjectChip[]): string {
  return chips
    .map((c) => `<span class="proj-chip proj-chip-${c.tone}">${esc(c.text)}</span>`)
    .join("");
}

function extrasForActive(p: ActiveProject, content: GameContent): ProjectEffectSource {
  const catalog = content.projects.find((d) => d.id === p.defId);
  const initial = content.start.initialProject.id === p.defId ? content.start.initialProject : undefined;
  return {
    reputationReward: p.reputationReward,
    completionStockGrants: p.completionStockGrants ?? catalog?.completionStockGrants ?? initial?.completionStockGrants,
    stockFlowMods: catalog?.stockFlowMods,
  };
}

function etaSub(eta: string): string {
  return eta === "stalled" ? "" : `<div class="proj-sub">${esc(eta)}</div>`;
}

function stallChip(eta: string): string {
  return eta === "stalled" ? `<span class="proj-chip proj-chip-stall">stalled</span>` : "";
}

export function renderProjectsStatus(
  inFlight: readonly ActiveProject[],
  state: Readonly<GameState>,
  content: GameContent,
): string {
  const planning = state.plan ?? [];
  const planN = planning.length;
  const planRate = effectiveRate(state, "plan");
  const planRows = planning
    .map((item) => {
      const def = content.projects.find((d) => d.id === item.defId);
      const eta = formatProjectEta(item.size - item.progress, planRate, planN);
      const chips = def ? chipsHtml(projectEffectChips(def)) : "";
      return `<tr data-plan-status="${esc(item.defId)}">
        <td class="proj-btn"><button type="button" data-cancel="${esc(item.defId)}">Cancel</button></td>
        <td><div class="proj-name"><strong>${esc(item.name)}</strong></div>${etaSub(eta)}</td>
        <td class="num">${fmt(item.progress)} / ${fmt(item.size)}</td>
        <td class="num">${PROJ_EMPTY}</td>
        <td class="num">${def ? moneyCell(def.payoutPerPoint) : PROJ_EMPTY}</td>
        <td class="num">${def ? moneyCell(def.completionBonus) : PROJ_EMPTY}</td>
        <td class="proj-fx">${chips}</td>
      </tr>`;
    })
    .join("");
  const n = inFlight.length;
  const flightRows = inFlight
    .map((p) => {
      const eta = formatProjectEta(p.remaining, state.pointsPerDay, n);
      const chips = chipsHtml(projectEffectChips(extrasForActive(p, content)));
      return `<tr class="proj-now" data-project-status="${esc(p.defId)}">
        <td class="proj-btn"><button type="button" data-abandon="${esc(p.defId)}">Abandon</button></td>
        <td>
          <span class="proj-chip proj-chip-now">in flight</span>${stallChip(eta)}
          <div class="proj-name"><strong>${esc(p.name)}</strong></div>${etaSub(eta)}
        </td>
        <td class="num"><span class="proj-left">${fmt(p.remaining)} left</span></td>
        <td class="num">${PROJ_EMPTY}</td>
        <td class="num">${moneyCell(p.payoutPerPoint)}</td>
        <td class="num">${moneyCell(p.completionBonus)}</td>
        <td class="proj-fx">${chips}</td>
      </tr>`;
    })
    .join("");

  const body =
    (n > 0 ? groupRow("In flight", true) + flightRows : "") +
    (planN > 0 ? groupRow("In plan") + planRows : "");

  return `<h3>Projects</h3>
    <table class="proj-table">
      ${projectColgroup()}
      ${projectThead()}
      <tbody>${body}</tbody>
    </table>`;
}

// Omit unmet-prerequisite, already-completed, already-in-plan, and
// already-in-flight rows. In-flight lives in the status group's top rows so
// it is not repeated as a disabled offer. Keep cannot-afford visible.
function isVisibleProjectOffer(o: ProjectAvailability): boolean {
  if (o.startable) return true;
  return o.reason === "cannot afford";
}

export function renderProjectOffers(offers: ProjectAvailability[], state: Readonly<GameState>): string {
  // Offer copy is size / Ideas / payout / effects only. In-flight remaining
  // and ETAs do not appear here, so this string stays stable between ticks
  // and Start/Pursue nodes survive the 10Hz patch. Extra WIP is told by the
  // in-flight rows above, which use the 1/n slice.
  const rows = offers
    .filter(isVisibleProjectOffer)
    .map((o) => {
      const def = o.def;
      const disabled = o.startable ? "" : "disabled";
      const label = def.pursue ? "Pursue" : "Start";
      const ideasShort = !!def.pursue && state.stocks.ideas < def.sizePoints;
      const cashShort = state.stocks.budget < def.upfrontCost;
      const cashNote = cashShort ? `<div class="proj-sub proj-warn">cannot afford</div>` : "";
      const upfront = def.upfrontCost > 0 ? `<div class="proj-sub">$${fmt(def.upfrontCost)} start</div>` : "";
      const ideas = def.pursue ? fmt(def.sizePoints) : PROJ_EMPTY;
      const ideasClass = ideasShort ? "num proj-warn" : "num";
      const chips = chipsHtml(projectEffectChips(def));
      return `<tr>
        <td class="proj-btn"><button data-project="${esc(def.id)}" ${disabled}>${label}</button></td>
        <td><div class="proj-name"><strong>${esc(def.name)}</strong></div>${upfront}${cashNote}</td>
        <td class="num">${fmt(def.sizePoints)} pts</td>
        <td class="${ideasClass}">${ideas}</td>
        <td class="num">${moneyCell(def.payoutPerPoint)}</td>
        <td class="num">${moneyCell(def.completionBonus)}</td>
        <td class="proj-fx">${chips}</td>
      </tr>`;
    })
    .join("");
  if (!rows) return "";
  return `<table class="proj-table proj-table-offers">
    ${projectColgroup()}
    <tbody>
      ${groupRow("Available")}
      ${rows}
    </tbody>
  </table>`;
}

// The time-control group (design doc section 8): Start/Pause plus one
// button per available speed, replacing the old bare Pause button. Routed
// through the existing #app click delegation via data-speed, matching
// data-buy/data-project. All buttons are fixed-width (see .tc-btn in
// index.html) so the group's size never changes -- preserves the R14
// no-reflow guarantee even as the active marker or the Start/Pause label
// changes width.
export function renderTimeControls(paused: boolean, speed: number, options: readonly number[]): string {
  const pauseLabel = paused ? "Start" : "Pause";
  // When paused, Start is the active control (start-paused, Start not Resume): speeds stay dimmed so the bright button is the
  // one that starts the day clock, not the already-selected 1x that looks
  // like a play toggle.
  const pauseActive = paused ? " tc-active" : "";
  const speedButtons = options
    .map((opt) => {
      const active = !paused && opt === speed ? " tc-active" : "";
      return `<button class="tc-btn${active}" data-speed="${opt}">${opt}x</button>`;
    })
    .join("");
  return `<div class="time-controls">
    <button class="tc-btn${pauseActive}" id="pause">${pauseLabel}</button>
    ${speedButtons}
  </div>`;
}

export function renderStall(stalled: boolean, deliveryFrozen = false): string {
  if (stalled) {
    return `<div class="stall">Stalled.</div>`;
  }
  if (deliveryFrozen) {
    return `<div class="stall">Insolvent.</div>`;
  }
  return "";
}

// Quiet page footer: version + deploy/build time + repo link.
// Lives in the page scaffold (not a patched region) because build identity
// never changes during a session. Version is shown as injected (CalVer tag
// in CI, "x.y.z-dev" locally) with no extra "v" prefix so CalVer tags do
// not become "vv…".
export function renderBuildStamp(info: BuildInfo): string {
  const when = formatBuiltAt(info.builtAt);
  return `<div class="build-stamp">${esc(info.version)} · deployed ${esc(when)} · <a href="${esc(info.repoUrl)}" target="_blank" rel="noopener noreferrer">source</a></div>`;
}

// Pending choices are the one region whose text changes every single day the
// game runs (the expiry countdown) while carrying the buttons a player is
// actively reaching for. So the countdown lives in its own tiny patched
// section and everything else -- including the option buttons -- is part of a
// scaffold that only changes when the set of pending choices changes. Rebuilding on that event is correct: the buttons themselves are what
// changed.
export function choiceCountdownSection(challengeId: string): string {
  return `choice-countdown:${challengeId}`;
}

export function renderChoicesScaffold(pending: readonly PendingChoice[], challenges: ChallengeDef[]): string {
  if (pending.length === 0) return "";
  const blocks = pending
    .map((pc) => {
      const def = challenges.find((c) => c.id === pc.challengeId);
      if (!def?.choice) return "";
      const buttons = def.choice.options
        .map((o) => `<button data-choice="${esc(def.id)}" data-option="${esc(o.id)}">${esc(o.label)}</button>`)
        .join(" ");
      return `<div class="choice-interrupt-item"><strong>${esc(def.name)}</strong>: ${esc(def.description)} <em ${SECTION_ATTR}="${choiceCountdownSection(def.id)}"></em><br/>${buttons}</div>`;
    })
    .join("");
  // class-based interrupt chrome (sticky host in index.html) replaces
  // the old inline border so the panel reads as a persistent affordance, not a
  // log line.
  return `<div class="panel choice-interrupt" role="alert" aria-label="Decision needed"><h3>Decision needed</h3>${blocks}</div>`;
}

/** while paused the day clock is frozen, so "Nd" is a fake countdown. */
export function renderChoiceCountdown(pc: PendingChoice, day: number, paused = false): string {
  if (paused) return "";
  return `(${pc.expiresDay - day}d)`;
}
