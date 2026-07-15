import { Engine } from "../engine/engine";
import { parseStartConfig, parseDecisions } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import type { GameContent } from "../engine/types";
import { renderStats, renderDecisions } from "./render";

const content: GameContent = {
  start: parseStartConfig(startJson),
  decisions: parseDecisions(decisionsJson),
  challenges: [],
  projects: [],
};

const engine = new Engine(content);
const app = document.getElementById("app")!;

function render(): void {
  const state = engine.getState();
  app.innerHTML = `
    ${renderStats(state)}
    <button id="pause">${state.paused ? "Resume" : "Pause"}</button>
    ${renderDecisions(engine.availableDecisions(), [...state.decisions], content)}
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
  } else {
    return; // not one of ours; skip the re-render
  }
  render();
});

const intervalId = setInterval(() => {
  engine.tick();
  render();
}, 1000);
render();

// Vite HMR: without this, each edit stacks another interval on the old one.
if (import.meta.hot) {
  import.meta.hot.dispose(() => clearInterval(intervalId));
}
