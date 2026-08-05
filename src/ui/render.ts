import type { Availability } from "../engine/decisions";
import { contextSwitchTax } from "../engine/modifiers";
import type { ProjectAvailability } from "../engine/projects";
import type { DecisionCategory, DecisionDef, DecisionInstance, GameContent, GameState, PendingChoice, LogEntry, ChallengeDef, ActiveProject } from "../engine/types";
import { buildTechTree, type TechChain } from "./techTree";
import { summarizeDecisionEffects } from "./effectSummary";
import { SECTION_ATTR } from "./domPatch";
import { formatBuiltAt, type BuildInfo } from "./buildInfo";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

// Each stat is a fixed label + tabular-nums value slot (see index.html's
// .stat-value width classes) so a value changing width on tick -- Day
// ticking up, Budget crossing a comma boundary, etc -- never reflows the
// single-line bar and shifts the buttons below it.
function stat(label: string, value: string, widthClass: string): string {
  return `<span class="stat"><span class="stat-label">${label}</span> <span class="stat-value ${widthClass}">${value}</span></span>`;
}

export function renderStats(state: Readonly<GameState>): string {
  return `
    <div class="stats">
      ${stat("Day", String(state.day), "v-day")}
      ${stat("Backlog", fmt(state.stocks.backlog), "v-flow")}
      ${stat("In Progress", fmt(state.stocks.inProgress), "v-count")}
      ${stat("Done", fmt(state.stocks.done), "v-count")}
      ${stat("Shipped", fmt(state.stocks.shipped), "v-flow")}
      ${stat("Budget", `$${fmt(state.stocks.budget)}`, "v-budget")}
      ${stat("Tech Debt", fmt(state.stocks.techDebt), "v-debt")}
      ${stat("Reputation", fmt(state.stocks.reputation), "v-rep")}
      ${stat("Points/Day", fmt(state.pointsPerDay), "v-rate")}
    </div>`;
}

// Short player-facing labels for the tech-tree node tags. Every shipped
// decision carries a required category (see DecisionDef in ../engine/types),
// so this map is exhaustive over DecisionCategory.
const CATEGORY_LABELS: Record<DecisionCategory, string> = {
  "ship-faster": "speed",
  "earn-income": "income",
  "tame-debt": "debt",
  "prevent-trouble": "safety",
  "change-structure": "structure",
};

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

// Renders one tech-tree node card. States (mutually exclusive):
//  - owned unique: dimmed, no Buy button, marked "owned"
//  - owned repeatable: not dimmed, keeps the Buy button, shows "owned xN"
//  - missing-requires: dimmed but VISIBLE (reverses the old hide-until-
//    unlocked behavior so the ladder ahead is visible), Buy disabled
//  - cannot-afford: Buy disabled, reason shown
//  - purchasable: Buy enabled
function renderTechNode(a: Availability, ownedCount: number): string {
  const def = a.def;
  const ownedUnique = a.code === "already-owned";
  const ownedRepeatable = !ownedUnique && ownedCount > 0;
  const stateClass = ownedUnique ? "tt-owned" : a.code === "missing-requires" ? "tt-locked" : a.code === "cannot-afford" ? "tt-cannot-afford" : "tt-buyable";

  let stateLine = "";
  let button = "";
  if (ownedUnique) {
    stateLine = `<span class="tt-tag-state">owned</span>`;
  } else {
    if (ownedRepeatable) stateLine += `<span class="tt-tag-state">owned x${ownedCount}</span>`;
    if (a.reason) stateLine += `${stateLine ? " " : ""}<span class="tt-reason">${esc(a.reason)}</span>`;
    const disabled = a.purchasable ? "" : "disabled";
    button = `<button data-buy="${esc(def.id)}" ${disabled}>Buy</button>`;
  }

  // Card anatomy (design doc section 4): name + category tag, cost line,
  // authored description (benefit then catch, full text -- no truncation:
  // descriptions were rewritten in Release 20 to be short enough to always
  // fit), derived effects (numbers straight from `effects`, so they can't
  // drift from a balance retune the way hand-written prose can), then
  // state/button. The derived line is omitted entirely when there is
  // nothing to derive (synergy targets and challenge gates).
  return `<div class="tt-node ${stateClass}">
    <div class="tt-node-name">${esc(def.name)}</div>
    <div class="tt-node-meta"><span>${gambleTag(def)}<span class="tt-cat">${esc(CATEGORY_LABELS[def.category])}</span></span> <span class="tt-cost">${esc(costLine(def))}</span></div>
    <div class="tt-node-desc">${esc(def.description)}</div>
    ${effectsLine(def)}
    ${stateLine ? `<div class="tt-node-state">${stateLine}</div>` : ""}
    ${button}
  </div>`;
}

function renderChain(chain: TechChain, availById: Map<string, Availability>, ownedCounts: Map<string, number>): string {
  const columns = chain.tiers
    .map((tier) => {
      const nodes = tier.map((def) => renderTechNode(availById.get(def.id)!, ownedCounts.get(def.id) ?? 0)).join("");
      return `<div class="tt-tier">${nodes}</div>`;
    })
    .join(`<div class="tt-arrow">&rarr;</div>`);
  return `<div class="tt-chain"><h4>${esc(chain.name)}</h4><div class="tt-chain-row">${columns}</div></div>`;
}

function renderStandalone(defs: DecisionDef[], availById: Map<string, Availability>, ownedCounts: Map<string, number>): string {
  if (defs.length === 0) return "";
  const nodes = defs.map((def) => renderTechNode(availById.get(def.id)!, ownedCounts.get(def.id) ?? 0)).join("");
  return `<div class="tt-standalone"><h4>Standalone</h4><div class="tt-standalone-grid">${nodes}</div></div>`;
}

export function renderDecisions(avail: Availability[], ownedInstances: DecisionInstance[], content: GameContent): string {
  const availById = new Map(avail.map((a) => [a.def.id, a]));
  const ownedCounts = new Map<string, number>();
  for (const inst of ownedInstances) ownedCounts.set(inst.defId, (ownedCounts.get(inst.defId) ?? 0) + 1);
  const tree = buildTechTree(content);
  const shop =
    tree.chains.map((chain) => renderChain(chain, availById, ownedCounts)).join("") +
    renderStandalone(tree.standalone, availById, ownedCounts);
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
    .map((p) => `<div>${esc(p.name)}: ${fmt(p.remaining)} points left ($${fmt(p.payoutPerPoint)}/pt, $${fmt(p.completionBonus)} on completion)</div>`)
    .join("");
  return `<h3>Projects (efficiency ${(taxNow * 100).toFixed(0)}%)</h3>${flight}`;
}

export function renderProjectOffers(offers: ProjectAvailability[], state: Readonly<GameState>): string {
  // Efficiency preview for starting one more project. Depends on how many are
  // already in flight, not on per-tick progress, so this string is stable
  // between starts and completions -- which is what lets the memo hold.
  const taxNext = Math.pow(state.contextSwitchFactor, state.projects.length);
  return offers
    .map((o) => {
      const disabled = o.startable ? "" : "disabled";
      const reason = o.reason ? ` (${esc(o.reason)})` : "";
      return `<div><button data-project="${esc(o.def.id)}" ${disabled}>Start</button> <strong>${esc(o.def.name)}</strong>${reason}<br/>
        <small>${fmt(o.def.sizePoints)} points, costs $${fmt(o.def.upfrontCost)}, pays $${fmt(o.def.payoutPerPoint)}/pt + $${fmt(o.def.completionBonus)} bonus.
        Starting this drops efficiency to ${(taxNext * 100).toFixed(0)}%.</small></div>`;
    })
    .join("");
}

// The time-control group (design doc section 8): Pause/Resume plus one
// button per available speed, replacing the old bare Pause button. Routed
// through the existing #app click delegation via data-speed, matching
// data-buy/data-project. All buttons are fixed-width (see .tc-btn in
// index.html) so the group's size never changes -- preserves the R14
// no-reflow guarantee even as the active marker or the Pause/Resume label
// changes width.
export function renderTimeControls(paused: boolean, speed: number, options: readonly number[]): string {
  const pauseLabel = paused ? "Resume" : "Pause";
  // When paused, Resume is the active control (issue #38 start-paused): speeds
  // stay dimmed so the bright button is the one that starts the day clock,
  // not the already-selected 1x that looks like a play toggle.
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
      return `<div><strong>${esc(def.name)}</strong>: ${esc(def.description)} <em ${SECTION_ATTR}="${choiceCountdownSection(def.id)}"></em><br/>${buttons}</div>`;
    })
    .join("");
  return `<div class="panel" style="border-color:#c00"><h3>Decision needed</h3>${blocks}</div>`;
}

export function renderChoiceCountdown(pc: PendingChoice, day: number): string {
  return `(${pc.expiresDay - day} days left)`;
}
