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

function stageKeys(svg: string): string[] {
  return [...svg.matchAll(/data-stage="([^"]+)"/g)].map((m) => m[1]!);
}

function stageGroup(svg: string, key: string): string {
  const re = new RegExp(`<g data-stage="${key}">([\\s\\S]*?)</g>`);
  const m = svg.match(re);
  expect(m, `missing data-stage=${key}`).not.toBeNull();
  return m![1]!;
}

function stageValue(svg: string, key: string): string {
  const group = stageGroup(svg, key);
  const m = group.match(/data-stage-value="true"[^>]*>([^<]+)/);
  expect(m, `missing data-stage-value in ${key}`).not.toBeNull();
  return m![1]!;
}

function stageRate(svg: string, key: string): string | null {
  const group = stageGroup(svg, key);
  const m = group.match(/data-stage-rate="true"[^>]*>([^<]+)/);
  return m?.[1] ?? null;
}

function viewBoxSize(svg: string): { w: number; h: number } {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  expect(m).not.toBeNull();
  return { w: Number(m![1]), h: Number(m![2]) };
}

function boxRects(svg: string): { x: number; y: number; w: number; h: number }[] {
  return [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    w: Number(m[3]),
    h: Number(m[4]),
  }));
}

function dashedPathEnds(svg: string): { startX: number; endX: number } {
  const m = svg.match(/<path d="M ([\d.]+) [\d.]+ V [\d.]+ H ([\d.]+)/);
  expect(m, "missing dashed debt path").not.toBeNull();
  return { startX: Number(m![1]), endX: Number(m![2]) };
}

function boxCenterX(svg: string, key: string): number {
  const m = stageGroup(svg, key).match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
  expect(m, `missing rect in ${key}`).not.toBeNull();
  return Number(m![1]) + Number(m![3]) / 2;
}

describe("loopDiagramSvg", () => {
  it("renders six stage boxes in order with Ideas/Plan count+capacity and realized pull/finish/deploy", () => {
    const content = emptyContent();
    const state = initialState(content);
    const svg = loopDiagramSvg(state, content);
    expect(svg).toContain("<svg");
    expect(stageKeys(svg)).toEqual(["ideas", "plan", "backlog", "inProgress", "done", "shipped"]);
    for (const label of ["Ideas", "Plan", "Ready", "In Progress", "Done", "Shipped"]) expect(svg).toContain(label);

    expect(stageValue(svg, "ideas")).toBe("100");
    expect(stageValue(svg, "plan")).toBe("0");
    expect(stageValue(svg, "backlog")).toBe("300");
    expect(stageRate(svg, "ideas")).toBe("0.5/day");
    expect(stageRate(svg, "plan")).toBe("1.0/day");
    expect(stageRate(svg, "backlog")).toBeNull();
    expect(stageRate(svg, "inProgress")).toBeNull();
    expect(stageRate(svg, "done")).toBeNull();
    expect(stageRate(svg, "shipped")).toBeNull();

    // Pull / finish / deploy arrows stay realized flow. Before any tick,
    // that is 0 even though finish/deploy capacity is 1.0/day. Plan's
    // 1.0/day is capacity on the box, not an arrow.
    expect(svg.match(/0\.0\/day/g)).toHaveLength(3);
    expect(svg).toContain("debt +0.5/pt");
    expect(svg.match(/<line /g)).toHaveLength(5);
  });

  it("on a fresh game's first tick, pull/finish/deploy arrows show realized flow, not raw capacity", () => {
    const content = emptyContent();
    const state = initialState(content);
    // First tick: the backlog is plentiful so pull saturates its 2.0/day
    // capacity, but inProgress and done both start at 0, so nothing was
    // actually there yet for finish/deploy to move -- their realized flow is
    // genuinely 0 this tick even though their base capacity is 1.0/day.
    tick(state, createRng(content.start.seed), content, () => {});
    const svg = loopDiagramSvg(state, content);
    expect(svg).toContain("2.0/day"); // pull: realized flow == capacity here, backlog wasn't the constraint
    expect(svg.match(/0\.0\/day/g)).toHaveLength(2); // finish AND deploy: realized flow, not capacity
    // Ideas/Plan still paint capacity, not a realized Ideas→Plan flow.
    expect(stageRate(svg, "ideas")).toBe("0.5/day");
    expect(stageRate(svg, "plan")).toBe("1.0/day");
  });

  it("shows Plan capacity on an empty Plan pile (unused 1/day, no split on the box)", () => {
    const content = emptyContent();
    const state = initialState(content);
    expect(state.stocks.plan).toBe(0);
    expect(state.plan).toEqual([]);
    const svg = loopDiagramSvg(state, content);
    expect(stageValue(svg, "plan")).toBe("0");
    expect(stageRate(svg, "plan")).toBe("1.0/day");
    expect(stageGroup(svg, "plan")).not.toMatch(/0\.5\/day/);
  });

  it("Ideas and Plan rates follow current discover/plan capacity, including modifiers", () => {
    const content = emptyContent();
    const state = initialState(content);
    state.modifiers.push(
      { id: "m-disc", source: "test", target: "discover", op: "add", value: 1.5 },
      { id: "m-plan", source: "test", target: "plan", op: "add", value: 2 },
    );
    const svg = loopDiagramSvg(state, content);
    expect(stageRate(svg, "ideas")).toBe("2.0/day"); // 0.5 + 1.5
    expect(stageRate(svg, "plan")).toBe("3.0/day"); // 1 + 2
  });

  it("does not print Plan split on the box when several named items share capacity", () => {
    const content = emptyContent();
    const state = initialState(content);
    state.plan = [
      { defId: "a", name: "A", progress: 2, size: 10 },
      { defId: "b", name: "B", progress: 3, size: 10 },
    ];
    state.stocks.plan = 5;
    const svg = loopDiagramSvg(state, content);
    expect(stageValue(svg, "plan")).toBe("5");
    expect(stageRate(svg, "plan")).toBe("1.0/day");
    expect(stageGroup(svg, "plan")).not.toContain("0.5/day");
    expect(stageGroup(svg, "plan")).not.toContain("A");
    expect(stageGroup(svg, "plan")).not.toContain("B");
  });

  it("drops the Done box and keeps Ideas and Plan once ci-cd is owned", () => {
    const content = fullDecisionsContent();
    const state = initialState(content);
    // Mutable escape hatch: grant ci-cd directly rather than routing through
    // a full purchase (requires/budget/gamble are exercised elsewhere).
    state.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
    const svg = loopDiagramSvg(state, content);
    expect(stageKeys(svg)).toEqual(["ideas", "plan", "backlog", "inProgress", "shipped"]);
    expect(svg).toContain("Ideas");
    expect(svg).toContain("Plan");
    expect(svg).toContain("Ready");
    expect(svg).toContain("In Progress");
    expect(svg).toContain("Shipped");
    expect(svg).not.toContain(">Done<");
    expect(svg).toContain("continuous deploy");
    expect(stageRate(svg, "ideas")).toBe("0.5/day");
    expect(stageRate(svg, "plan")).toBe("1.0/day");
    expect(svg.match(/<line /g)).toHaveLength(4); // Ideas→Plan, Plan→Ready, pull, finish
  });

  it("routes the dashed debt path to Ready, not Ideas", () => {
    const content = emptyContent();
    const svg = loopDiagramSvg(initialState(content), content);
    const { startX, endX } = dashedPathEnds(svg);
    expect(startX).toBeCloseTo(boxCenterX(svg, "shipped"), 5);
    expect(endX).toBeCloseTo(boxCenterX(svg, "backlog"), 5);
    expect(endX).not.toBeCloseTo(boxCenterX(svg, "ideas"), 5);

    const contentCd = fullDecisionsContent();
    const stateCd = initialState(contentCd);
    stateCd.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
    const svgCd = loopDiagramSvg(stateCd, contentCd);
    const debtCd = dashedPathEnds(svgCd);
    expect(debtCd.startX).toBeCloseTo(boxCenterX(svgCd, "shipped"), 5);
    expect(debtCd.endX).toBeCloseTo(boxCenterX(svgCd, "backlog"), 5);
    expect(debtCd.endX).not.toBeCloseTo(boxCenterX(svgCd, "ideas"), 5);
  });

  it("keeps six boxes from overlapping or running off the viewBox", () => {
    const content = emptyContent();
    const svg = loopDiagramSvg(initialState(content), content);
    const { w, h } = viewBoxSize(svg);
    const rects = boxRects(svg);
    expect(rects).toHaveLength(6);
    const sorted = [...rects].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i]!;
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(w);
      expect(r.y + r.h).toBeLessThanOrEqual(h);
      if (i > 0) expect(r.x).toBeGreaterThan(sorted[i - 1]!.x + sorted[i - 1]!.w);
    }
    // Full-width six-box: wider than the old 860 half-width four-box viewBox
    // so labels are not scaled into unreadable soup.
    expect(w).toBeGreaterThanOrEqual(1100);
    expect(svg).toMatch(/font-size="16"/);
    expect(svg).toMatch(/font-size="18"/);
  });

  // FR-2.1: Delivery loop needs terse teaching copy (steady vs growing boxes). Voice-matched to the Progress panel footer.
  describe("Delivery loop teaching caption", () => {
    it("includes the steady-vs-growing caption on a fresh six-box Delivery loop", () => {
      const content = emptyContent();
      const svg = loopDiagramSvg(initialState(content), content);
      expect(svg).toContain(DELIVERY_LOOP_CAPTION);
      expect(DELIVERY_LOOP_CAPTION).toMatch(/steady/i);
      expect(DELIVERY_LOOP_CAPTION).toMatch(/growing/i);
      expect(DELIVERY_LOOP_CAPTION).toMatch(/bottleneck/i);
      // Caption text itself must set fill=currentColor.
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

  // follow-up: <rect>/<line>/<path> shapes use stroke="currentColor"
  // and correctly inherit dark-mode text color, but SVG's fill defaults to
  // black independent of the surrounding CSS cascade -- a <text> element
  // without an explicit fill renders unreadable black-on-black in dark mode
  // even though every other shape in the same diagram adapts correctly. This
  // test inspects the actual generated SVG markup (not index.html's static
  // stylesheet, which darkMode.test.ts already covers and which never sees
  // this dynamically-built markup at all) so a future <text> element added
  // without fill="currentColor" fails immediately instead of shipping invisible.
  it("every <text> element sets fill=currentColor so it adapts to dark mode", () => {
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

  // binding-stage bottleneck cue. Thresholds are BINDING_INFLOW_RATIO
  // (inflow capacity ≥ 1.5× outflow) and BINDING_SUSTAINED_DAYS (stock ≥ 3 days
  // of outflow capacity). Fixture mirrors tick.test.ts's deploy-bottleneck case.
  describe("binding-stage bottleneck cue", () => {
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
      expect(stageGroup(svg, "done")).toContain("capacity-bound");
      expect(stageGroup(svg, "ideas")).not.toContain("capacity-bound");
      expect(stageGroup(svg, "plan")).not.toContain("capacity-bound");
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
      expect(stageGroup(svg, "inProgress")).toContain("capacity-bound");
      expect(stageGroup(svg, "ideas")).not.toContain("capacity-bound");
      expect(stageGroup(svg, "plan")).not.toContain("capacity-bound");
    });

    it("does not cue Ideas or Plan even when those piles are large", () => {
      const content = emptyContent();
      const state = initialState(content);
      state.stocks.ideas = 400;
      state.stocks.plan = 50;
      expect(bindingBottleneckStage(state, content)).toBeNull();
      const svg = loopDiagramSvg(state, content);
      expect(svg).not.toContain("capacity-bound");
      expect(stageGroup(svg, "ideas")).not.toContain('data-binding="true"');
      expect(stageGroup(svg, "plan")).not.toContain('data-binding="true"');
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
