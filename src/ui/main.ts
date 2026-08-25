import { loadShippedContent } from "../engine/loadShippedContent";
import type { GameContent } from "../engine/types";
import { mountAppView } from "./appView";
import { createPlayerEngine } from "./playerEngine";
import { saveGame, loadGame, clearSave, saveSpeed, loadSpeed } from "./storage";
import { advance, type Speed } from "./tickDriver";
import { installDevConsole } from "./devConsole";

// Per-era loader: start.json + the save's era (or Studio). Tick advances
// one-way when entryAnyOf fires; the loader keeps owned defs resolvable.
const saved = loadGame();
const content: GameContent = loadShippedContent(saved?.eraId);
const engine = createPlayerEngine(content, saved, loadShippedContent);
const app = document.getElementById("app")!;

// Speed is a UI preference, not game state (design doc section 3/6): it
// lives in its own localStorage key and its own variable here, never in
// GameState or content, so the engine purity test stays green.
let speed: Speed = loadSpeed();

// The view owns the DOM: it writes the page scaffold once and then patches
// only the regions whose html actually changed on each render, so interactive
// nodes are not torn down by the driver's per-tick renders. See
// appView.ts and domPatch.ts. Everything environment-shaped -- persistence,
// the reload on reset, the alert -- stays here behind these callbacks.
const view = mountAppView({
  root: app,
  engine,
  content,
  getSpeed: () => speed,
  onSpeedChange: (next) => {
    speed = next;
    saveSpeed(speed);
  },
  // Event-driven save: without this, paused/purchase/etc. state only reaches
  // storage on the 10-day autosave tick, so e.g. pausing then reloading before
  // the next autosave silently un-pauses the game. Save on every real action.
  onAction: () => saveGame(engine.getState()),
  onReset: () => {
    if (confirm("Wipe this factory and start over?")) {
      clearSave();
      location.reload();
    }
  },
  onError: (message) => alert(message),
});

// DevTools cheats (`sf.help()`): UI-only writes through the live state
// escape hatch, then re-render + save. Uninstall on HMR so a stale `sf`
// cannot mutate a disposed engine.
const uninstallDevConsole = installDevConsole({
  engine,
  render: () => view.render(),
  save: () => saveGame(engine.getState()),
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

  if (result.ticks > 0) view.render();
}, DRIVER_INTERVAL_MS);

// Spacebar toggles pause (design doc section 8). Guarded against form
// controls even though none exist today, per spec.
window.addEventListener("keydown", (ev) => {
  if (ev.code !== "Space") return;
  const target = ev.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  ev.preventDefault(); // don't let the page scroll
  view.togglePause(); // toggles, re-renders and saves, exactly as the button does
});

// Vite HMR: without this, each edit stacks another interval on the old one --
// and (since the view's click delegation lives on the never-replaced #app) a
// second, stale click listener that would double every action.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearInterval(intervalId);
    view.dispose();
    uninstallDevConsole();
  });
}
