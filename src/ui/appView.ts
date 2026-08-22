// The rendered game view: page scaffold, per-section updates, and the click
// delegation. Extracted from main.ts so the render/click loop can be unit
// tested against a real DOM (see appView.test.ts); main.ts keeps only the
// wiring it cannot be tested without -- content loading, localStorage, the
// interval driver, keyboard, and HMR.
//
// Issue #6: this used to be one `root.innerHTML = ...` per render, which the
// 100ms driver could fire ~10x/second, destroying and recreating every button.
// A mousedown/mouseup gesture straddling one of those rebuilds produces no
// click at all, so Pause/Start, speed, Buy, Start and choice options
// intermittently ignored real clicks. Now the page structure is written once
// and each region is patched only when its own html actually changes (see
// domPatch.ts), so a region whose data has not moved keeps its nodes.
import type { Engine } from "../engine/engine";
import type { GameContent, PendingChoice } from "../engine/types";
import {
  renderLog,
  renderChoicesScaffold,
  renderChoiceCountdown,
  choiceCountdownSection,
  projectsPanelScaffold,
  renderProjectsStatus,
  renderProjectOffers,
  PROJECTS_STATUS_SECTION,
  PROJECTS_OFFERS_SECTION,
  decisionsPanelScaffold,
  ownedPanelScaffold,
  decisionNodeSection,
  renderDecisionNode,
  renderOwnedList,
  shopScaffoldKey,
  OWNED_LIST_SECTION,
  renderStall,
  renderTimeControls,
  renderBuildStamp,
} from "./render";
import { getBuildInfo } from "./buildInfo";
import { loopDiagramSvg } from "./loopDiagram";
import { usersLoopSvg } from "./usersLoop";
import { inProgressPanelSvg } from "./inProgressPanel";
import { createRegion, SECTION_ATTR } from "./domPatch";
import { SPEED_OPTIONS, type Speed } from "./tickDriver";
import {
  cockpitStatViews,
  createFlashController,
  deliveryStatViews,
  GAMBLE_REVEAL_MS,
  renderGambleReveal,
  syncStatRow,
  type GambleReveal,
} from "./gameFeel";

export interface AppViewDeps {
  root: HTMLElement;
  engine: Engine;
  content: GameContent;
  /** Current UI speed. Speed is a UI preference owned by main.ts, not game state. */
  getSpeed(): Speed;
  /** A speed button was clicked with a valid option; main.ts persists it. */
  onSpeedChange(speed: Speed): void;
  /** A player action changed the game; main.ts saves (event-driven save). */
  onAction(): void;
  /** The reset button was clicked; main.ts owns the confirm/wipe/reload. */
  onReset(): void;
  /** An engine rejection to surface to the player. */
  onError(message: string): void;
}

export interface AppView {
  render(): void;
  /** Toggle pause, re-render and save. Shared by the button and the spacebar. */
  togglePause(): void;
  /**
   * Detaches the click delegation. Called on Vite HMR dispose: a re-executed
   * module mounts a second view over the same #app, and without this the old
   * view's listener would still be attached to that (never-replaced) element
   * and would run every action twice.
   */
  dispose(): void;
}

// Page layout, written once at mount and never rebuilt. The wrapper elements
// (.loops, .cols, .main, .side) and the reset button are static, so they --
// unlike before -- are not churned by the driver at all. Section containers
// are empty until the first render patches them.
//
  // Issue #67: Delivery loop diagram, delivery-stats, and Progress loop are
// separate sections so material stock numbers can update in place (flash)
// without rebuilding the SVG wrappers every time a digit moves. Gamble reveal
// is its own ephemeral section between stats and the loops.
// Issue #40: Choices live in glanceable chrome (not the scrollable side rail)
// so a Decision-needed interrupt stays reachable while shopping at speed.
const STATS = "stats";
const DELIVERY_LOOP = "delivery-loop";
const DELIVERY_STATS = "delivery-stats";
const USERS_LOOP = "users-loop";
const PROGRESS_LOOP = "progress-loop";
const GAMBLE_REVEAL = "gamble-reveal";
const STALL = "stall";
const TIME_CONTROLS = "time-controls";
const DECISIONS = "decisions";
const PROJECTS = "projects";
const CHOICES = "choices";
const LOG = "log";

function pageScaffold(): string {
  // Issue #7: time controls + Reset sit above the stats bar and loop panels
  // so pause/speed/reset stay reachable without scrolling past the loops.
  // Reset is a static sibling of the patched time-controls so pause/speed
  // flips never rebuild it; CSS pins it to the right of that same row.
  // Eras stay off the title: crossings are silent and the heading is just
  // the game name. Issue #40: choices interrupt sits with chrome (before
  // loops) so pending decisions are not buried under Alter the system /
  // Events scroll.
  return `
    <h1 class="game-title">Software Factory</h1>
    <div class="chrome-row">
      <div ${SECTION_ATTR}="${TIME_CONTROLS}"></div>
      <button id="reset">Reset game</button>
    </div>
    <div ${SECTION_ATTR}="${STATS}"></div>
    <div ${SECTION_ATTR}="${GAMBLE_REVEAL}"></div>
    <div ${SECTION_ATTR}="${CHOICES}"></div>
    <div class="loops">
      <div class="delivery-column">
        <div class="panel"><h3>Delivery loop</h3><div ${SECTION_ATTR}="${DELIVERY_LOOP}"></div></div>
        <div class="panel"><h3>User loop</h3><div ${SECTION_ATTR}="${USERS_LOOP}"></div></div>
        <div ${SECTION_ATTR}="${DELIVERY_STATS}"></div>
      </div>
      <div ${SECTION_ATTR}="${PROGRESS_LOOP}"></div>
    </div>
    <div ${SECTION_ATTR}="${STALL}"></div>
    <div class="cols">
      <div class="main">
        <div ${SECTION_ATTR}="${DECISIONS}"></div>
        <div ${SECTION_ATTR}="${PROJECTS}"></div>
      </div>
      <div class="side">
        <div ${SECTION_ATTR}="${LOG}"></div>
        ${ownedPanelScaffold()}
      </div>
    </div>
    ${renderBuildStamp(getBuildInfo())}
  `;
}

export function mountAppView(deps: AppViewDeps): AppView {
  const { root, engine } = deps;
  let content = engine.getContent();
  let lastEraId = engine.getState().eraId;

  const page = createRegion(root);
  page.setScaffold(pageScaffold());
  // Nested regions: one panel that holds both a volatile block and a stable,
  // button-carrying block. The panel chrome around them is itself a scaffold,
  // so the containers inside keep stable identity too.
  const projects = createRegion(page.section(PROJECTS)!);
  projects.setScaffold(projectsPanelScaffold());
  // Issue #24: tech-tree Buy buttons each live in their own patched section so
  // one node's affordability flip cannot tear down every other Buy button.
  const decisions = createRegion(page.section(DECISIONS)!);
  decisions.setScaffold(
    decisionsPanelScaffold(content, engine.getState().decisions, engine.availableDecisions()),
  );
  let lastShopKey = shopScaffoldKey(
    engine.availableDecisions(),
    engine.getState().decisions,
    content,
  );
  const choices = createRegion(page.section(CHOICES)!);

  const flash = createFlashController();
  let gambleReveal: GambleReveal | null = null;
  let gambleRevealTimer: ReturnType<typeof setTimeout> | null = null;
  // Issue #40: track which pending challenges we have already soft-paused for
  // so Start is not immediately re-paused every frame while the choice waits.
  let softPausedChoiceIds = new Set<string>();

  function clearGambleRevealTimer(): void {
    if (gambleRevealTimer !== null) {
      clearTimeout(gambleRevealTimer);
      gambleRevealTimer = null;
    }
  }

  function showGambleReveal(reveal: GambleReveal): void {
    clearGambleRevealTimer();
    gambleReveal = reveal;
    page.patch(GAMBLE_REVEAL, renderGambleReveal(gambleReveal));
    gambleRevealTimer = setTimeout(() => {
      gambleReveal = null;
      gambleRevealTimer = null;
      page.patch(GAMBLE_REVEAL, renderGambleReveal(null));
    }, GAMBLE_REVEAL_MS);
  }

  function renderChoicesRegion(pending: readonly PendingChoice[], day: number, paused: boolean): void {
    // The scaffold (option buttons included) is rewritten only when the set of
    // pending choices changes; the countdown beside them is patched per day.
    choices.setScaffold(renderChoicesScaffold(pending, content.challenges));
    for (const pc of pending) {
      // Issue #115: hide the timer copy while paused (soft-pause or manual).
      choices.patch(choiceCountdownSection(pc.challengeId), renderChoiceCountdown(pc, day, paused));
    }
  }

  /** Soft-pause once when a Decision-needed challenge newly appears (issue #40). */
  function softPauseForNewChoices(pending: readonly PendingChoice[]): boolean {
    const ids = pending.map((pc) => pc.challengeId);
    const appeared = ids.filter((id) => !softPausedChoiceIds.has(id));
    // Drop ids that are no longer pending so a later re-fire can soft-pause again.
    softPausedChoiceIds = new Set(ids);
    if (appeared.length === 0) return false;
    if (engine.getState().paused) return false;
    engine.pause();
    deps.onAction();
    return true;
  }

  function renderDecisionsRegion(): void {
    const state = engine.getState();
    const ownedCounts = new Map<string, number>();
    for (const inst of state.decisions) {
      ownedCounts.set(inst.defId, (ownedCounts.get(inst.defId) ?? 0) + 1);
    }
    for (const a of engine.availableDecisions()) {
      // Owned unique (#110) and missing-requires (#121) have no shop shell.
      if (a.code === "already-owned" || a.code === "missing-requires") continue;
      decisions.patch(decisionNodeSection(a.def.id), renderDecisionNode(a, ownedCounts.get(a.def.id) ?? 0));
    }
  }

  function render(): void {
    // Soft-pause before painting so time controls show Start on the same frame.
    softPauseForNewChoices([...engine.getState().pendingChoices]);
    content = engine.getContent();
    const state = engine.getState();
    const avail = engine.availableDecisions();
    const shopKey = shopScaffoldKey(avail, state.decisions, content);
    // Rebuild shop shells on era change, owned-unique buy/remove (#110), or
    // missing-requires unlock (#121). Affordability flips still patch in place.
    if (state.eraId !== lastEraId || shopKey !== lastShopKey) {
      lastEraId = state.eraId;
      lastShopKey = shopKey;
      decisions.setScaffold(decisionsPanelScaffold(content, state.decisions, avail));
    }
    // Issue #67: sync cockpit + delivery stats in place so .stat-flash can
    // finish without the string-memo path tearing the nodes down each tick.
    syncStatRow(page.section(STATS)!, "stats", cockpitStatViews(state, content), flash);
    syncStatRow(page.section(DELIVERY_STATS)!, "delivery-stats", deliveryStatViews(state), flash);
    page.patch(DELIVERY_LOOP, loopDiagramSvg(state, content));
    page.patch(USERS_LOOP, usersLoopSvg(state, content));
    page.patch(PROGRESS_LOOP, inProgressPanelSvg(state, content));
    page.patch(GAMBLE_REVEAL, renderGambleReveal(gambleReveal));
    page.patch(STALL, renderStall(engine.isStalled()));
    page.patch(TIME_CONTROLS, renderTimeControls(state.paused, deps.getSpeed(), SPEED_OPTIONS));
    renderDecisionsRegion();
    projects.patch(PROJECTS_STATUS_SECTION, renderProjectsStatus([...state.projects], state));
    projects.patch(PROJECTS_OFFERS_SECTION, renderProjectOffers(engine.availableProjects(), state));
    renderChoicesRegion([...state.pendingChoices], state.day, state.paused);
    page.patch(LOG, renderLog(state.log));
    // Issue #114: Owned sits under Events in `.side`, patched on the page region.
    page.patch(OWNED_LIST_SECTION, renderOwnedList([...state.decisions], content));
  }

  function togglePause(): void {
    if (engine.getState().paused) {
      engine.resume();
    } else {
      engine.pause();
    }
    render();
    deps.onAction();
  }

  // Event delegation on the root: the listener lives on an element that is
  // never replaced, and (since issue #6) neither are the buttons underneath it
  // unless their own content changed.
  const listeners = new AbortController();
  root.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    if (target.id === "pause") {
      togglePause();
      return; // togglePause already re-rendered and saved
    } else if (target.dataset.buy) {
      // Prefer the button itself: a nested click target would miss data-buy.
      const buyEl = target.closest<HTMLElement>("[data-buy]") ?? target;
      const defId = buyEl.dataset.buy;
      if (!defId) return;
      try {
        engine.applyDecision(defId);
        render();
        deps.onAction();
        // Issue #67: gamble purchases get a short on-screen reveal beyond the
        // Events log line (hire outcomes and any similarly rolled decision).
        // Shown after render so the sticky toast is the last paint.
        const state = engine.getState();
        const inst = state.decisions[state.decisions.length - 1];
        if (inst && inst.defId === defId && inst.gambleLabel) {
          const def = content.decisions.find((d) => d.id === defId);
          if (def) {
            showGambleReveal({ decisionName: def.name, outcomeLabel: inst.gambleLabel });
          }
        }
      } catch (err) {
        deps.onError((err as Error).message);
      }
      return;
    } else if (target.dataset.remove) {
      // Issue #16 / FR-7.1: Remove is irreversible (modifiers dropped, one-time
      // cost not refunded). Gate it behind the same native confirm pattern
      // Reset already uses so a misclick on a dense Owned list cannot wipe a
      // sunk-cost hire in one gesture.
      if (!confirm("Remove this decision? One-time cost is not refunded.")) {
        return;
      }
      engine.removeDecision(target.dataset.remove);
    } else if (target.dataset.choice && target.dataset.option) {
      engine.resolveChoice(target.dataset.choice, target.dataset.option);
      // Issue #89: answering the interrupt hands time back. The soft pause
      // (issue #40) is what stopped the clock when the choice appeared, so
      // without this the day counter stays frozen after the player has already
      // dealt with it -- and the pause reads as a bug rather than a courtesy.
      // Resuming here also matches the speed buttons' resume-on-click.
      //
      // Only once the last interrupt is answered: with two choices queued,
      // resuming on the first would start the clock ticking down the second
      // one's expiry while the player is still reading it, which is the
      // opposite of what the soft pause is for.
      if (engine.getState().paused && engine.getState().pendingChoices.length === 0) {
        engine.resume();
      }
    } else if (target.dataset.project) {
      try {
        engine.startProject(target.dataset.project);
      } catch (err) {
        deps.onError((err as Error).message);
      }
    } else if (target.dataset.speed) {
      // Changing speed applies immediately and persists. Selecting a speed
      // while paused also resumes: after issue #38's start-paused default,
      // the bright 1x control was the natural "start the day clock" click
      // and previously did nothing, leaving Day stuck at 0.
      const next = Number(target.dataset.speed) as Speed;
      if ((SPEED_OPTIONS as readonly number[]).includes(next)) {
        deps.onSpeedChange(next);
      }
      if (engine.getState().paused) {
        engine.resume();
      }
    } else if (target.id === "reset") {
      deps.onReset();
      return; // reset owns its own persistence (wipe, not save); skip the shared tail
    } else {
      return; // not one of ours; skip the re-render
    }
    render();
    deps.onAction();
  }, { signal: listeners.signal });

  render();
  return {
    render,
    togglePause,
    dispose: () => {
      listeners.abort();
      clearGambleRevealTimer();
    },
  };
}
