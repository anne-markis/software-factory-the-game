import { describe, it, expect } from "vitest";
import {
  BINDING_INFLOW_RATIO,
  BINDING_SUSTAINED_DAYS,
  bindingBottleneckStage,
  loopDiagramSvg,
  renderDeliveryCarets,
  zoomableStages,
} from "./loopDiagram";
import { renderStageZoom } from "./inProgressPanel";
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
  it("renders seven stage boxes in order with Ideas/Plan count+capacity and realized pull/finish/review/deploy", () => {
    const content = emptyContent();
    const state = initialState(content);
    const svg = loopDiagramSvg(state, content);
    expect(svg).toContain("<svg");
    expect(stageKeys(svg)).toEqual(["ideas", "plan", "backlog", "inProgress", "inReview", "done", "shipped"]);
    for (const label of ["Ideas", "Plan", "Ready", "In Progress", "In Review", "Done", "Shipped"]) expect(svg).toContain(label);

    expect(stageValue(svg, "ideas")).toBe("100");
    expect(stageValue(svg, "plan")).toBe("0");
    expect(stageValue(svg, "backlog")).toBe("300");
    expect(stageRate(svg, "ideas")).toBe("0.5/day");
    expect(stageRate(svg, "plan")).toBe("1.0/day");
    expect(stageRate(svg, "backlog")).toBeNull();
    expect(stageGroup(svg, "inProgress")).toContain("data-stage-cycle");
    expect(stageGroup(svg, "ideas")).not.toContain("data-stage-cycle");
    expect(stageRate(svg, "inReview")).toBeNull();
    expect(stageRate(svg, "done")).toBeNull();
    expect(stageRate(svg, "shipped")).toBeNull();

    // Pull / finish / review / deploy arrows stay realized flow. Before any tick,
    // that is 0 even though finish/review/deploy capacity is 1.0/day. Plan's
    // 1.0/day is capacity on the box, not an arrow.
    expect(svg.match(/0\.0\/day/g)).toHaveLength(4);
    expect(svg).toContain("debt +0.5/pt");
    expect(svg).not.toContain("slower");
    expect(svg).not.toContain("data-debt-drag");
    expect(svg).not.toContain("data-debt-hot");
    expect(svg.match(/<line /g)).toHaveLength(6);
  });

  it("on a fresh game's first tick, pull/finish/review/deploy arrows show realized flow, not raw capacity", () => {
    const content = emptyContent();
    const state = initialState(content);
    tick(state, createRng(content.start.seed), content, () => {});
    const svg = loopDiagramSvg(state, content);
    expect(svg).toContain("2.0/day"); // Ready drain: 1 finished + 1 seated
    expect(svg).toContain("1.0/day"); // finish realized
    expect(svg.match(/0\.0\/day/g)).toHaveLength(2); // review and deploy: nothing waiting yet
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

  it("drops the Done box, keeps In Review, and keeps Ideas and Plan once ci-cd is owned", () => {
    const content = fullDecisionsContent();
    const state = initialState(content);
    // Mutable escape hatch: grant ci-cd directly rather than routing through
    // a full purchase (requires/budget/gamble are exercised elsewhere).
    state.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
    const svg = loopDiagramSvg(state, content);
    expect(stageKeys(svg)).toEqual(["ideas", "plan", "backlog", "inProgress", "inReview", "shipped"]);
    expect(svg).toContain("Ideas");
    expect(svg).toContain("Plan");
    expect(svg).toContain("Ready");
    expect(svg).toContain("In Progress");
    expect(svg).toContain("In Review");
    expect(svg).toContain("Shipped");
    expect(svg).not.toContain(">Done<");
    expect(svg).toContain("continuous deploy");
    expect(stageRate(svg, "ideas")).toBe("0.5/day");
    expect(stageRate(svg, "plan")).toBe("1.0/day");
    expect(svg.match(/<line /g)).toHaveLength(5); // Ideas→Plan, Plan→Ready, pull, finish, review
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

  it("tints pull/finish/deploy arrows once drag is live and leaves the leak caption alone", () => {
    const content = emptyContent();
    const state = initialState(content);
    state.stocks.techDebt = 1400;
    const svg = loopDiagramSvg(state, content);
    expect(svg.match(/data-debt-drag="warn"/g)).toHaveLength(4);
    expect(svg).not.toContain("data-debt-hot");
    expect(svg).toContain("debt +0.5/pt");
    expect(svg).not.toContain("slower");
    expect(svg).not.toContain("-15%");
    // Ideas and Plan are not debt-dragged; their connecting arrows stay clean.
    expect(stageGroup(svg, "ideas")).not.toContain("data-debt-drag");
    expect(stageGroup(svg, "plan")).not.toContain("data-debt-drag");
  });

  it("keeps seven boxes from overlapping or running off the viewBox", () => {
    const content = emptyContent();
    const svg = loopDiagramSvg(initialState(content), content);
    const { w, h } = viewBoxSize(svg);
    const rects = boxRects(svg);
    expect(rects).toHaveLength(7);
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

  describe("Delivery loop has no teaching caption", () => {
    it("omits the old steady-vs-growing lecture on a fresh seven-box Delivery loop", () => {
      const content = emptyContent();
      const svg = loopDiagramSvg(initialState(content), content);
      expect(svg).not.toMatch(/steady box/i);
      expect(svg).not.toMatch(/growing box/i);
      expect(svg).not.toMatch(/marks the bottleneck/i);
    });

    it("stays caption-free once continuous deploy drops the Done box", () => {
      const content = fullDecisionsContent();
      const state = initialState(content);
      state.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
      const svg = loopDiagramSvg(state, content);
      expect(svg).not.toMatch(/steady box/i);
      expect(svg).not.toMatch(/growing box/i);
    });

    it("does not lecture in the stage-zoom drawer either", () => {
      const content = emptyContent();
      const zoom = renderStageZoom(initialState(content), content, "inProgress");
      expect(zoom).not.toContain("The inner system's pace sets outer throughput");
      expect(zoom).not.toContain("Rework leak");
      expect(zoom).toContain("Cycle speed");
      expect(zoom).toContain("Leak size");
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

    it("cues In Review as capacity-bound when finish outruns review and In Review has piled up", () => {
      const content = fullDecisionsContent();
      const e = new Engine(content);
      injectStrongDev(e.getState() as GameState); // rates: pull 3, finish 3, review 1, deploy 1
      for (let i = 0; i < 15; i++) e.tick(); // warm until In Review ≥ 3 days of review
      const state = e.getState();
      expect(state.stocks.inReview).toBeGreaterThanOrEqual(BINDING_SUSTAINED_DAYS * 1);
      expect(bindingBottleneckStage(state, content)).toBe("inReview");

      const svg = loopDiagramSvg(state, content);
      expect(svg).toContain("capacity-bound");
      expect(svg).toContain('data-binding="true"');
      expect(svg).toContain('data-binding-outflow="true"');
      expect(svg).toContain('aria-label="Delivery loop, In Review capacity-bound"');
      expect(stageGroup(svg, "inReview")).toContain("capacity-bound");
      expect(stageGroup(svg, "ideas")).not.toContain("capacity-bound");
      expect(stageGroup(svg, "plan")).not.toContain("capacity-bound");
      expect(svg).not.toContain("ci-cd");
      expect(svg).not.toContain("data-open-shop");
      expect(svg).not.toContain("Alter the system");
    });

    it("still cues In Review once continuous deploy removes the Done stage", () => {
      const content = fullDecisionsContent();
      const e = new Engine(content);
      const state = e.getState() as GameState;
      injectStrongDev(state);
      state.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
      for (let i = 0; i < 15; i++) e.tick();
      expect(bindingBottleneckStage(e.getState(), content)).toBe("inReview");
      expect(loopDiagramSvg(e.getState(), content)).toContain("capacity-bound");
      expect(loopDiagramSvg(e.getState(), content)).not.toContain(">Done<");
    });

    it("cues Done as capacity-bound when review outruns deploy and Done has piled up", () => {
      const content = emptyContent();
      const state = initialState(content);
      state.baseRates.review = 3;
      state.stocks.inReview = 0;
      state.stocks.done = 8;
      state.stocks.inProgress = 1;
      expect(bindingBottleneckStage(state, content)).toBe("done");
      const svg = loopDiagramSvg(state, content);
      expect(stageGroup(svg, "done")).toContain("capacity-bound");
      expect(svg).toContain('aria-label="Delivery loop, Done capacity-bound"');
    });

    it("does not cue In Progress when seats are full and Ready is waiting", () => {
      const content = emptyContent();
      const state = initialState(content);
      state.stocks.inProgress = 1;
      state.stocks.backlog = 200;
      state.stocks.done = 0;
      expect(bindingBottleneckStage(state, content)).toBeNull();
      const svg = loopDiagramSvg(state, content);
      expect(svg).not.toContain("capacity-bound");
      expect(stageGroup(svg, "inProgress")).not.toContain("capacity-bound");
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

describe("delivery zoom carets", () => {
  it("places In Progress, In Review, and Done carets collapsed, and drops Done under continuous deploy", () => {
    const content = emptyContent();
    expect(zoomableStages(initialState(content), content)).toEqual(["inProgress", "inReview", "done"]);
    const html = renderDeliveryCarets(initialState(content), content);
    expect(html).toContain('data-zoom="inProgress"');
    expect(html).toContain('data-zoom="inReview"');
    expect(html).toContain('data-zoom="done"');
    expect(html).toContain('aria-expanded="false"');

    const contentCd = fullDecisionsContent();
    const stateCd = initialState(contentCd);
    stateCd.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
    expect(zoomableStages(stateCd, contentCd)).toEqual(["inProgress", "inReview"]);
    const htmlCd = renderDeliveryCarets(stateCd, contentCd);
    expect(htmlCd).toContain('data-zoom="inProgress"');
    expect(htmlCd).toContain('data-zoom="inReview"');
    expect(htmlCd).not.toContain('data-zoom="done"');
  });
});
