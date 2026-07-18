import { Engine } from "../engine/engine";
import { parseStartConfig, parseDecisions, parseChallenges, parseProjects, validateContentGraph } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import challengesJson from "../../content/challenges.json";
import projectsJson from "../../content/projects.json";
import type { GameContent } from "../engine/types";
import { renderStats, renderDecisions, renderLog, renderChoices, renderProjects, renderStall } from "./render";
import { loopDiagramSvg } from "./loopDiagram";
import { inProgressPanelSvg } from "./inProgressPanel";
import { saveGame, loadGame, clearSave } from "./storage";

const content: GameContent = {
  start: parseStartConfig(startJson),
  decisions: parseDecisions(decisionsJson),
  challenges: parseChallenges(challengesJson),
  projects: parseProjects(projectsJson),
};
validateContentGraph(content);

const engine = new Engine(content, loadGame());
const app = document.getElementById("app")!;

function render(): void {
  const state = engine.getState();
  app.innerHTML = `
    ${renderStats(state)}
    ${loopDiagramSvg(state, content)}
    ${inProgressPanelSvg(state, content)}
    ${renderStall(engine.isStalled())}
    <button id="pause">${state.paused ? "Resume" : "Pause"}</button>
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

const intervalId = setInterval(() => {
  engine.tick();
  if (engine.getState().day % 10 === 0) saveGame(engine.getState());
  render();
}, 1000);
render();

// Vite HMR: without this, each edit stacks another interval on the old one.
if (import.meta.hot) {
  import.meta.hot.dispose(() => clearInterval(intervalId));
}
