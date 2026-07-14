import { Engine } from "../engine/engine";
import { parseStartConfig } from "../engine/content";
import startJson from "../../content/start.json";
import type { GameContent } from "../engine/types";
import { renderStats } from "./render";

const content: GameContent = {
  start: parseStartConfig(startJson),
  decisions: [],
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
  `;
  document.getElementById("pause")!.onclick = () => {
    state.paused ? engine.resume() : engine.pause();
    render();
  };
}

setInterval(() => {
  engine.tick();
  render();
}, 1000);
render();
