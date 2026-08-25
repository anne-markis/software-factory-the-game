import type { Availability } from "../engine/decisions";
import { contextSwitchTax } from "../engine/modifiers";
import type { ProjectAvailability } from "../engine/projects";
import type { DecisionDef, DecisionInstance, GameContent, GameState, PendingChoice, LogEntry, ChallengeDef, ActiveProject } from "../engine/types";
import { summarizeDecisionEffects } from "./effectSummary";
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
// Markup is shared with gameFeel.syncStatRow (issue #67 in-place flash).
export function renderStats(state: Readonly<GameState>, content: GameContent): string {
  return statsRowHtml(cockpitStatViews(state, content), "stats");
}

// Issue #8: In Progress / Done / Shipped / Tech Debt / Reputation sit under
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
  return def.gamble && def.gamble.length > 0 ? `<span class="tt-gamble" title="Outcome is a roll: could help or hurt">gamble</span> ` : "";
}

// Renders the derived-effects line, or nothing when the decision has no
// direct effects (its authored description carries the conditional story).
function effectsLine(def: DecisionDef): string {
  const summary = summarizeDecisionEffects(def);
  return summary ? `<div class="tt-effects">${esc(summary)}</div>` : "";
}

// Issue #24: the decisions/tech-tree region used to be one memoized HTML
// string. When any node's availability flipped (budget crossing a cost
// threshold), every Buy button in the tree was torn down. Mirror the
// projects/choices split: a content-stable scaffold holds per-node section
// containers, and each card is patched independently.
export const OWNED_LIST_SECTION = "owned-list";

export function decisionNodeSection(defId: string): string {
  return `decision-node:${defId}`;
}

// Def ids of unique decisions that currently have an owned instance.
// Issue #110: those cards leave Alter the system while owned (Owned keeps them).
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

// Shop-hidden ids: owned unique (#110) plus unmet-requires (#121).
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
//  - owned unique: omitted from the shop (issue #110); this helper returns ""
//    if called anyway
//  - owned repeatable: not dimmed, keeps the Buy button, shows "owned xN"
//  - missing-requires: omitted from the shop (issue #121); defensive ""
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

  // Slim row (issue #140): shared left Buy column, then name / optional
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

// Single-column shop (issue #139). `renderNode` is a live card (string
// tests / renderDecisions) or an empty data-section shell (scaffold).
// `hideDefIds` drops owned unique (#110) and missing-requires (#121) cards.
// Issue #141: iterate `content.decisions` in loader/catalog order. Hidden
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
// Owned unique (#110) and missing-requires (#121) defs are omitted; appView
// rebuilds this scaffold when that hide set changes so Buy-button identity
// stays stable across ticks.
// Issue #114: Owned lives under Events in `.side`, not under Alter the system.
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

/** Owned panel chrome for the right rail (issue #114). */
export function ownedPanelScaffold(): string {
  return `<div class="panel"><h3>Owned</h3><div ${SECTION_ATTR}="${OWNED_LIST_SECTION}"></div></div>`;
}

// Issue #15: Owned entries carry the same cost line and derived-effects
// summary as shop cards so a player trimming upkeep does not have to
// scroll back through Alter the system matching names card by card.
export function renderOwnedList(ownedInstances: DecisionInstance[], content: GameContent): string {
  const ownedList = ownedInstances
    .map((inst) => {
      const def = content.decisions.find((d) => d.id === inst.defId);
      if (!def) return "";
      const remove = def.removable ? `<button data-remove="${esc(inst.instanceId)}">Remove</button>` : "";
      const outcome = inst.gambleLabel ? ` [${esc(inst.gambleLabel)}]` : "";
      const sick = inst.sickUntilDay !== undefined ? " (sick)" : "";
      return `<div class="owned-item">
      <div class="owned-item-head">${esc(def.name)}${outcome}${sick} ${remove}</div>
      <div class="owned-cost">${esc(costLine(def))}</div>
      ${effectsLine(def)}
    </div>`;
    })
    .join("");
  return ownedList || "<small>Nothing yet. You are a solo dev.</small>";
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
  // Shop only — Owned is patched separately under Events (issue #114).
  return `
    <div class="panel"><h3>Alter the system</h3>${shop}</div>`;
}

export function renderLog(log: readonly LogEntry[]): string {
  const lines = [...log].slice(-30).reverse()
    .map((entry) => `<div>Day ${entry.day}: ${esc(entry.message)}</div>`)
    .join("");
  return `<div class="panel"><h3>Events</h3><div class="log">${lines || "<small>Quiet so far.</small>"}</div></div>`;
}

// The projects panel is split into two independently-patched sections
// (issue #6). The in-flight lines change on every tick that moves work, while
// the offers below them -- which carry the Start buttons -- only change when a
// project starts, completes, or crosses a gate. Writing the whole panel on
// every tick destroyed those buttons ~10x/second; keeping the volatile status
// block in its own container means the buttons are only rebuilt when the
// offers themselves actually change. The panel's chrome is written once at
// mount and never touched again.
export const PROJECTS_STATUS_SECTION = "projects-status";
export const PROJECTS_OFFERS_SECTION = "projects-offers";

export function projectsPanelScaffold(): string {
  return `<div class="panel"><div ${SECTION_ATTR}="${PROJECTS_STATUS_SECTION}"></div><hr/><div ${SECTION_ATTR}="${PROJECTS_OFFERS_SECTION}"></div></div>`;
}

export function renderProjectsStatus(inFlight: readonly ActiveProject[], state: Readonly<GameState>): string {
  const taxNow = contextSwitchTax(state);
  const flight = inFlight
    .map((p) => {
      const eta = formatProjectEta(p.remaining, state.pointsPerDay);
      return `<div data-project-status="${esc(p.defId)}">${esc(p.name)}: ${fmt(p.remaining)} points left ($${fmt(p.payoutPerPoint)}/pt, $${fmt(p.completionBonus)} on completion) · ${esc(eta)}</div>`;
    })
    .join("");
  return `<h3>Projects (efficiency ${(taxNow * 100).toFixed(0)}%)</h3>${flight}`;
}

// Issues #123 / #122: omit unmet-prerequisite and already-completed rows.
// Keep startable offers plus cannot-afford / already-in-flight (exact strings
// from projectAvailability).
function isVisibleProjectOffer(o: ProjectAvailability): boolean {
  if (o.startable) return true;
  return o.reason === "cannot afford" || o.reason === "already in flight";
}

export function renderProjectOffers(offers: ProjectAvailability[], state: Readonly<GameState>): string {
  // Efficiency preview for starting one more project. Depends on how many are
  // already in flight, not on per-tick progress, so this string is stable
  // between starts and completions -- which is what lets the memo hold.
  const taxNext = Math.pow(state.contextSwitchFactor, state.projects.length);
  return offers
    .filter(isVisibleProjectOffer)
    .map((o) => {
      const disabled = o.startable ? "" : "disabled";
      const reason = o.reason ? ` (${esc(o.reason)})` : "";
      return `<div><button data-project="${esc(o.def.id)}" ${disabled}>Start</button> <strong>${esc(o.def.name)}</strong>${reason}<br/>
        <small>${fmt(o.def.sizePoints)} points, costs $${fmt(o.def.upfrontCost)}, pays $${fmt(o.def.payoutPerPoint)}/pt + $${fmt(o.def.completionBonus)} bonus.
        Starting this drops efficiency to ${(taxNext * 100).toFixed(0)}%.</small></div>`;
    })
    .join("");
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
  // When paused, Start is the active control (issue #38 start-paused, issue
  // #98 Start not Resume): speeds stay dimmed so the bright button is the
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

export function renderStall(stalled: boolean): string {
  return stalled
    ? `<div class="stall">The factory is stalled: no work in the pipeline and nothing affordable. Income may still accrue; otherwise this factory is dead.</div>`
    : "";
}

// Quiet page footer (issue #45): version + deploy/build time + repo link.
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
// scaffold that only changes when the set of pending choices changes (issue
// #6). Rebuilding on that event is correct: the buttons themselves are what
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
  // Issue #40: class-based interrupt chrome (sticky host in index.html) replaces
  // the old inline border so the panel reads as a persistent affordance, not a
  // log line.
  return `<div class="panel choice-interrupt" role="alert" aria-label="Decision needed"><h3>Decision needed</h3>${blocks}</div>`;
}

/** Issue #115: while paused the day clock is frozen, so "N days left" is a fake countdown. */
export function renderChoiceCountdown(pc: PendingChoice, day: number, paused = false): string {
  if (paused) return "";
  return `(${pc.expiresDay - day} days left)`;
}
