import { Engine } from "../engine/engine";
import { parseStartConfig, parseDecisions, parseChallenges, parseProjects, validateContentGraph } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import challengesJson from "../../content/challenges.json";
import projectsJson from "../../content/projects.json";
import type { GameContent } from "../engine/types";
import { renderStats, renderDecisions, renderLog, renderChoices, renderProjects, renderStall, renderTimeControls } from "./render";
import { loopDiagramSvg } from "./loopDiagram";
import { inProgressPanelSvg } from "./inProgressPanel";
import { saveGame, loadGame, clearSave, saveSpeed, loadSpeed } from "./storage";
import { advance, SPEED_OPTIONS, type Speed } from "./tickDriver";

const content: GameContent = {
  start: parseStartConfig(startJson),
  decisions: parseDecisions(decisionsJson),
  challenges: parseChallenges(challengesJson),
  projects: parseProjects(projectsJson),
};
validateContentGraph(content);

const engine = new Engine(content, loadGame());
const app = document.getElementById("app")!;

// Speed is a UI preference, not game state (design doc section 3/6): it
// lives in its own localStorage key and its own variable here, never in
// GameState or content, so the engine purity test stays green.
let speed: Speed = loadSpeed();

function render(): void {
  const state = engine.getState();
  app.innerHTML = `
    ${renderStats(state)}
    <div class="loops">
      <div class="panel"><h3>Delivery loop</h3>${loopDiagramSvg(state, content)}</div>
      ${inProgressPanelSvg(state, content)}
    </div>
    ${renderStall(engine.isStalled())}
    ${renderTimeControls(state.paused, speed, SPEED_OPTIONS)}
    <button id="reset">Reset game</button>
    <div class="cols">
      <div class="main">
        ${renderDecisions(engine.availableDecisions(), [...state.decisions], content)}
        ${renderProjects([...state.projects], engine.availableProjects(), state)}
      </div>
      <div class="side">
        ${renderChoices([...state.pendingChoices], content.challenges, state.day)}
        ${renderLog(state.log)}
      </div>
    </div>
  `;
}

// Event delegation on #app: survives the innerHTML re-render each tick.
app.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement;
  const state = engine.getState();
  if (target.id === "pause") {
    if (state.paused) {
      engine.resume();
    } else {
      engine.pause();
    }
  } else if (target.dataset.buy) {
    try {
      engine.applyDecision(target.dataset.buy);
    } catch (err) {
      alert((err as Error).message);
    }
  } else if (target.dataset.remove) {
    engine.removeDecision(target.dataset.remove);
  } else if (target.dataset.choice && target.dataset.option) {
    engine.resolveChoice(target.dataset.choice, target.dataset.option);
  } else if (target.dataset.project) {
    try {
      engine.startProject(target.dataset.project);
    } catch (err) {
      alert((err as Error).message);
    }
  } else if (target.dataset.speed) {
    // Changing speed applies immediately and persists; allowed while
    // paused, in which case it takes effect on resume (design doc
    // section 8/6). It never touches the engine, so no engine.tick()
    // or state change happens here -- just the UI-layer rate.
    const next = Number(target.dataset.speed) as Speed;
    if ((SPEED_OPTIONS as readonly number[]).includes(next)) {
      speed = next;
      saveSpeed(speed);
    }
  } else if (target.id === "reset") {
    if (confirm("Wipe this factory and start over?")) {
      clearSave();
      location.reload();
    }
    return; // reset owns its own persistence (wipe, not save); skip the shared tail
  } else {
    return; // not one of ours; skip the re-render
  }
  render();
  // Event-driven save: without this, paused/purchase/etc. state only reaches
  // storage on the 10-day autosave tick, so e.g. pausing then reloading before
  // the next autosave silently un-pauses the game. Save on every real action.
  saveGame(engine.getState());
});

// Fixed-timestep driver (design doc section 4): a 100ms wall-clock interval
// decoupled from tick cadence via the pure `advance` accumulator, so render
// cost stays capped at 10/s regardless of speed while ticks can run faster.
// See tickDriver.ts for the accumulator itself (large-gap and per-frame-cap
// guards live there, not here).
const DRIVER_INTERVAL_MS = 100;
let accumulatorMs = 0;
let lastFrameTime = performance.now();

const intervalId = setInterval(() => {
  const now = performance.now();
  const elapsedMs = now - lastFrameTime;
  lastFrameTime = now;

  if (engine.getState().paused) {
    // Paused: lastFrameTime still advances above every 100ms, so no gap
    // builds up while paused and resuming doesn't replay a burst of ticks.
    // The accumulator itself is left untouched -- fractional progress
    // toward the next tick isn't lost across a pause/resume.
    return;
  }

  const result = advance(accumulatorMs, elapsedMs, speed);
  accumulatorMs = result.accumulatorMs;

  // Autosave check runs inside the per-tick loop (design doc section 7): a
  // batched multi-tick frame must not step over a `day % 10 === 0` boundary
  // and skip a save the way checking only once per frame would.
  for (let i = 0; i < result.ticks; i++) {
    engine.tick();
    if (engine.getState().day % 10 === 0) saveGame(engine.getState());
  }

  if (result.ticks > 0) render();
}, DRIVER_INTERVAL_MS);
render();

// Spacebar toggles pause (design doc section 8). Guarded against form
// controls even though none exist today, per spec.
window.addEventListener("keydown", (ev) => {
  if (ev.code !== "Space") return;
  const target = ev.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  ev.preventDefault(); // don't let the page scroll
  const state = engine.getState();
  if (state.paused) {
    engine.resume();
  } else {
    engine.pause();
  }
  render();
  saveGame(engine.getState());
});

// Vite HMR: without this, each edit stacks another interval on the old one.
if (import.meta.hot) {
  import.meta.hot.dispose(() => clearInterval(intervalId));
}
