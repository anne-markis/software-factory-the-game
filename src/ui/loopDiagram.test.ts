import { describe, it, expect } from "vitest";
import {
  BINDING_INFLOW_RATIO,
  BINDING_SUSTAINED_DAYS,
  DELIVERY_LOOP_CAPTION,
  bindingBottleneckStage,
  loopDiagramSvg,
} from "./loopDiagram";
import { inProgressPanelSvg } from "./inProgressPanel";
import { Engine, initialState } from "../engine/engine";
import { tick } from "../engine/tick";
import { createRng } from "../engine/rng";
import { parseStartConfig, parseDecisions } from "../engine/content";
import { decisionsJson, startJson } from "../engine/loadShippedContent";
import type { GameContent, GameState } from "../engine/types";

function emptyContent(): GameContent {
  return { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] };
}

function fullDecisionsContent(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("loopDiagramSvg", () => {
  it("renders one box per stage with stock values and realized (not yet occurred) flow", () => {
    const content = emptyContent();
    const state = initialState(content);
    const svg = loopDiagramSvg(state, content);
    expect(svg).toContain("<svg");
    for (const label of ["Ready", "In Progress", "Done", "Shipped"]) expect(svg).toContain(label);
    expect(svg).toContain("300"); // backlog value (Studio start backlog 300)
    // Issue #9: before any tick has run, no flow has actually happened yet on
    // any stage, even though every stage's base capacity is 1.0/day. The
    // arrows must show the realized (zero) flow, not the uncapped rate.
    expect(svg).not.toContain("1.0/day");
    expect(svg.match(/0\.0\/day/g)).toHaveLength(3); // pull, finish, deploy all realized 0 so far
    expect(svg).toContain("debt +0.5/pt"); // regen arrow label (a rate config, not a flow -- unaffected)
    expect(svg.match(/<line /g)).toHaveLength(3); // pull, finish, deploy
  });

  it("issue #9: on a fresh game's first tick, shows each arrow's realized flow, not its raw capacity", () => {
    const content = emptyContent();
    const state = initialState(content);
    // First tick: the backlog is plentiful so pull saturates its 2.0/day
    // capacity, but inProgress and done both start at 0, so nothing was
    // actually there yet for finish/deploy to move -- their realized flow is
    // genuinely 0 this tick even though their base capacity is 1.0/day.
    // Buggy behavior (pre-fix): all three arrows print their uncapped
    // capacity regardless of what actually moved.
    tick(state, createRng(content.start.seed), content, () => {});
    const svg = loopDiagramSvg(state, content);
    expect(svg).toContain("2.0/day"); // pull: realized flow == capacity here, backlog wasn't the constraint
    expect(svg.match(/0\.0\/day/g)).toHaveLength(2); // finish AND deploy: realized flow, not capacity
  });

  it("drops the Done box and shows the continuous-deploy caption once ci-cd is owned", () => {
    const content = fullDecisionsContent();
    const state = initialState(content);
    // Mutable escape hatch: grant ci-cd directly rather than routing through
    // a full purchase (requires/budget/gamble are exercised elsewhere).
    state.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
    const svg = loopDiagramSvg(state, content);
    expect(svg).toContain("Ready");
    expect(svg).toContain("In Progress");
    expect(svg).toContain("Shipped");
    expect(svg).not.toContain(">Done<");
    expect(svg).toContain("continuous deploy");
    expect(svg.match(/<line /g)).toHaveLength(2); // pull, finish only
  });

  // Issue #19 / FR-2.1: Delivery loop needs terse teaching copy (steady vs
  // growing boxes). Voice-matched to the Progress panel footer.
  describe("issue #19: Delivery loop teaching caption", () => {
    it("includes the steady-vs-growing caption on a fresh four-box Delivery loop", () => {
      const content = emptyContent();
      const svg = loopDiagramSvg(initialState(content), content);
      expect(svg).toContain(DELIVERY_LOOP_CAPTION);
      expect(DELIVERY_LOOP_CAPTION).toMatch(/steady/i);
      expect(DELIVERY_LOOP_CAPTION).toMatch(/growing/i);
      expect(DELIVERY_LOOP_CAPTION).toMatch(/bottleneck/i);
      // Caption text itself must set fill=currentColor (issue #10).
      expect(svg).toMatch(
        new RegExp(`<text[^>]*fill="currentColor"[^>]*>${DELIVERY_LOOP_CAPTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      );
    });

    it("keeps the caption once continuous deploy drops the Done box", () => {
      const content = fullDecisionsContent();
      const state = initialState(content);
      state.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
      expect(loopDiagramSvg(state, content)).toContain(DELIVERY_LOOP_CAPTION);
    });

    it("does not change Progress-panel captions", () => {
      const content = emptyContent();
      const progress = inProgressPanelSvg(initialState(content), content);
      expect(progress).toContain(
        "The inner system's pace sets outer throughput; its leak feeds outer backlog.",
      );
      expect(progress).toContain("refills the outer system's Backlog");
      expect(progress).toContain("rework leak");
      expect(progress).not.toContain(DELIVERY_LOOP_CAPTION);
    });
  });

  // Issue #10 follow-up: <rect>/<line>/<path> shapes use stroke="currentColor"
  // and correctly inherit dark-mode text color, but SVG's fill defaults to
  // black independent of the surrounding CSS cascade -- a <text> element
  // without an explicit fill renders unreadable black-on-black in dark mode
  // even though every other shape in the same diagram adapts correctly. This
  // test inspects the actual generated SVG markup (not index.html's static
  // stylesheet, which darkMode.test.ts already covers and which never sees
  // this dynamically-built markup at all) so a future <text> element added
  // without fill="currentColor" fails immediately instead of shipping invisible.
  it("issue #10: every <text> element sets fill=currentColor so it adapts to dark mode", () => {
    const content = fullDecisionsContent();
    const state = initialState(content);
    const svgs = [loopDiagramSvg(state, content)];
    state.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
    svgs.push(loopDiagramSvg(state, content)); // continuous-deploy layout too

    for (const svg of svgs) {
      const textTags = svg.match(/<text\b[^>]*>/g) ?? [];
      expect(textTags.length).toBeGreaterThan(0);
      for (const tag of textTags) {
        expect(tag).toContain('fill="currentColor"');
      }
    }
  });

  // Issue #64: binding-stage bottleneck cue. Thresholds are BINDING_INFLOW_RATIO
  // (inflow capacity ≥ 1.5× outflow) and BINDING_SUSTAINED_DAYS (stock ≥ 3 days
  // of outflow capacity). Fixture mirrors tick.test.ts's deploy-bottleneck case.
  describe("issue #64: binding-stage bottleneck cue", () => {
    function injectStrongDev(state: GameState): void {
      state.decisions.push({ instanceId: "inst-dev", defId: "basic-dev" });
      state.modifiers.push(
        { id: "m-pull", source: "inst-dev", target: "pull", op: "add", value: 2 },
        { id: "m-fin", source: "inst-dev", target: "finish", op: "add", value: 2 },
      );
    }

    it("pins the sustained-window thresholds used by the cue", () => {
      expect(BINDING_INFLOW_RATIO).toBe(1.5);
      expect(BINDING_SUSTAINED_DAYS).toBe(3);
    });

    it("does not cue on a fresh balanced loop (no noise)", () => {
      const content = emptyContent();
      const state = initialState(content);
      expect(bindingBottleneckStage(state, content)).toBeNull();
      const svg = loopDiagramSvg(state, content);
      expect(svg).not.toContain("capacity-bound");
      expect(svg).not.toContain('data-binding="true"');
      expect(svg).toContain('aria-label="Delivery loop"');
    });

    it("cues Done as capacity-bound when finish outruns deploy and Done has piled up", () => {
      const content = fullDecisionsContent();
      const e = new Engine(content);
      injectStrongDev(e.getState() as GameState); // rates: pull 3, finish 3, deploy 1
      for (let i = 0; i < 15; i++) e.tick(); // warm until Done ≥ 3 days of deploy
      const state = e.getState();
      expect(state.stocks.done).toBeGreaterThanOrEqual(BINDING_SUSTAINED_DAYS * 1);
      expect(bindingBottleneckStage(state, content)).toBe("done");

      const svg = loopDiagramSvg(state, content);
      expect(svg).toContain("capacity-bound");
      expect(svg).toContain('data-binding="true"');
      expect(svg).toContain('data-binding-outflow="true"');
      expect(svg).toContain('aria-label="Delivery loop, Done capacity-bound"');
      // Machine-side only: no shop / unlock auto-navigation hooks.
      expect(svg).not.toContain("ci-cd");
      expect(svg).not.toContain("data-open-shop");
      expect(svg).not.toContain("Alter the system");
    });

    it("stops cueing Done once continuous deploy removes the Done stage", () => {
      const content = fullDecisionsContent();
      const e = new Engine(content);
      const state = e.getState() as GameState;
      injectStrongDev(state);
      state.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
      for (let i = 0; i < 15; i++) e.tick();
      // With ci-cd, Done never piles; equal pull/finish means no inProgress cue either.
      expect(bindingBottleneckStage(e.getState(), content)).toBeNull();
      expect(loopDiagramSvg(e.getState(), content)).not.toContain("capacity-bound");
    });

    it("cues In Progress when pull outruns finish and WIP has piled up", () => {
      const content = emptyContent();
      const state = initialState(content);
      // Manufacture a clear inProgress bind without shopping: pull 3, finish 1,
      // stock already past the sustained window.
      state.baseRates.pull = 3;
      state.baseRates.finish = 1;
      state.stocks.inProgress = BINDING_SUSTAINED_DAYS * 1 + 1;
      state.stocks.done = 0;
      expect(bindingBottleneckStage(state, content)).toBe("inProgress");
      const svg = loopDiagramSvg(state, content);
      expect(svg).toContain("capacity-bound");
      expect(svg).toContain('aria-label="Delivery loop, In Progress capacity-bound"');
    });

    it("does not cue when rates are imbalanced but the pile is still a blip", () => {
      const content = emptyContent();
      const state = initialState(content);
      state.baseRates.pull = 3;
      state.baseRates.finish = 1;
      state.stocks.inProgress = 1; // < 3 days of finish capacity
      expect(bindingBottleneckStage(state, content)).toBeNull();
    });
  });
});

