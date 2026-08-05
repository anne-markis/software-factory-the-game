// The rendered game view: page scaffold, per-section updates, and the click
// delegation. Extracted from main.ts so the render/click loop can be unit
// tested against a real DOM (see appView.test.ts); main.ts keeps only the
// wiring it cannot be tested without -- content loading, localStorage, the
// interval driver, keyboard, and HMR.
//
// Issue #6: this used to be one `root.innerHTML = ...` per render, which the
// 100ms driver could fire ~10x/second, destroying and recreating every button.
// A mousedown/mouseup gesture straddling one of those rebuilds produces no
// click at all, so Pause/Resume, speed, Buy, Start and choice options
// intermittently ignored real clicks. Now the page structure is written once
// and each region is patched only when its own html actually changes (see
// domPatch.ts), so a region whose data has not moved keeps its nodes.
import type { Engine } from "../engine/engine";
import type { GameContent, PendingChoice } from "../engine/types";
import {
  renderStats,
  renderDecisions,
  renderLog,
  renderChoicesScaffold,
  renderChoiceCountdown,
  choiceCountdownSection,
  projectsPanelScaffold,
  renderProjectsStatus,
  renderProjectOffers,
  PROJECTS_STATUS_SECTION,
  PROJECTS_OFFERS_SECTION,
  renderStall,
  renderTimeControls,
  renderBuildStamp,
} from "./render";
import { getBuildInfo } from "./buildInfo";
import { loopDiagramSvg } from "./loopDiagram";
import { inProgressPanelSvg } from "./inProgressPanel";
import { createRegion, SECTION_ATTR } from "./domPatch";
import { SPEED_OPTIONS, type Speed } from "./tickDriver";

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
const STATS = "stats";
const LOOPS = "loops";
const STALL = "stall";
const TIME_CONTROLS = "time-controls";
const DECISIONS = "decisions";
const PROJECTS = "projects";
const CHOICES = "choices";
const LOG = "log";

function pageScaffold(): string {
  // Issue #7: time controls + Reset sit above the stats bar and loop panels
  // so pause/speed/reset stay reachable without scrolling past the loops.
  return `
    <div ${SECTION_ATTR}="${TIME_CONTROLS}"></div>
    <button id="reset">Reset game</button>
    <div ${SECTION_ATTR}="${STATS}"></div>
    <div class="loops" ${SECTION_ATTR}="${LOOPS}"></div>
    <div ${SECTION_ATTR}="${STALL}"></div>
    <div class="cols">
      <div class="main">
        <div ${SECTION_ATTR}="${DECISIONS}"></div>
        <div ${SECTION_ATTR}="${PROJECTS}"></div>
      </div>
      <div class="side">
        <div ${SECTION_ATTR}="${CHOICES}"></div>
        <div ${SECTION_ATTR}="${LOG}"></div>
      </div>
    </div>
    ${renderBuildStamp(getBuildInfo())}
  `;
}

export function mountAppView(deps: AppViewDeps): AppView {
  const { root, engine, content } = deps;

  const page = createRegion(root);
  page.setScaffold(pageScaffold());
  // Nested regions: one panel that holds both a volatile block and a stable,
  // button-carrying block. The panel chrome around them is itself a scaffold,
  // so the containers inside keep stable identity too.
  const projects = createRegion(page.section(PROJECTS)!);
  projects.setScaffold(projectsPanelScaffold());
  const choices = createRegion(page.section(CHOICES)!);

  function renderChoicesRegion(pending: readonly PendingChoice[], day: number): void {
    // The scaffold (option buttons included) is rewritten only when the set of
    // pending choices changes; the countdown beside them is patched per day.
    choices.setScaffold(renderChoicesScaffold(pending, content.challenges));
    for (const pc of pending) {
      choices.patch(choiceCountdownSection(pc.challengeId), renderChoiceCountdown(pc, day));
    }
  }

  function render(): void {
    const state = engine.getState();
    page.patch(STATS, renderStats(state));
    page.patch(
      LOOPS,
      `<div class="panel"><h3>Delivery loop</h3>${loopDiagramSvg(state, content)}</div>${inProgressPanelSvg(state, content)}`,
    );
    page.patch(STALL, renderStall(engine.isStalled()));
    page.patch(TIME_CONTROLS, renderTimeControls(state.paused, deps.getSpeed(), SPEED_OPTIONS));
    page.patch(DECISIONS, renderDecisions(engine.availableDecisions(), [...state.decisions], content));
    projects.patch(PROJECTS_STATUS_SECTION, renderProjectsStatus([...state.projects], state));
    projects.patch(PROJECTS_OFFERS_SECTION, renderProjectOffers(engine.availableProjects(), state));
    renderChoicesRegion([...state.pendingChoices], state.day);
    page.patch(LOG, renderLog(state.log));
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
      try {
        engine.applyDecision(target.dataset.buy);
      } catch (err) {
        deps.onError((err as Error).message);
      }
    } else if (target.dataset.remove) {
      engine.removeDecision(target.dataset.remove);
    } else if (target.dataset.choice && target.dataset.option) {
      engine.resolveChoice(target.dataset.choice, target.dataset.option);
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
  return { render, togglePause, dispose: () => listeners.abort() };
}
