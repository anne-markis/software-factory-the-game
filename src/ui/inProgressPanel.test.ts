import { describe, it, expect } from "vitest";
import { renderStageZoom } from "./inProgressPanel";
import { Engine } from "../engine/engine";
import { parseStartConfig, parseDecisions } from "../engine/content";
import { decisionsJson, startJson } from "../engine/loadShippedContent";
import type { GameContent } from "../engine/types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

// The three contributor-group headers always appear in this order in the
// emitted markup (see inProgressPanel.ts: speed stack, then friction stack,
// then leak stack), and each header is immediately followed by its own
// items before the next header appears. So "does `needle` fall inside group
// X's stack" reduces to "does it appear between X's header and the next
// header (or the end of the string)".
function indexBetween(svg: string, needle: string, afterHeader: string, beforeHeader?: string): boolean {
  const start = svg.indexOf(afterHeader);
  if (start === -1) return false;
  const needleIdx = svg.indexOf(needle, start); // first occurrence at/after the header, not the global first
  if (needleIdx === -1) return false;
  if (beforeHeader === undefined) return true;
  const end = svg.indexOf(beforeHeader, start);
  return end === -1 || needleIdx < end;
}

function inSpeedGroup(svg: string, needle: string): boolean {
  // Friction's header is omitted when the group is empty; bound the speed
  // group at whichever next header actually rendered so the search never
  // silently degrades to "anywhere after Cycle speed" (a fault-injection
  // review found that gap could mask a dropped speed-group node).
  const nextHeader = svg.includes("Friction") ? "Friction" : "Leak size";
  return indexBetween(svg, needle, "Cycle speed", nextHeader);
}

function inFrictionGroup(svg: string, needle: string): boolean {
  return indexBetween(svg, needle, "Friction", "Leak size");
}

function inLeakGroup(svg: string, needle: string): boolean {
  return indexBetween(svg, needle, "Leak size");
}

function panel(state: import("../engine/types").GameState, c: GameContent = content(), stage: "inProgress" | "done" = "inProgress"): string {
  return renderStageZoom(state, c, stage);
}

describe("renderStageZoom", () => {
  it("renders contributor columns on a fresh engine", () => {
    const e = new Engine(content());
    const svg = panel(e.getState());
    expect(svg).not.toContain("Progress loop");
    expect(svg).not.toContain("Progress system");
    expect(svg).not.toContain("work cycling");
    expect(svg).toContain("Cycle speed");
    expect(svg).toContain("Base 1.0/day");
    expect(svg).toContain("Base x0.5");
    expect(svg).not.toContain("The inner system's pace sets outer throughput");
    expect(svg).not.toContain("Rework leak");
    expect(svg).not.toContain("Context switch");
    expect(svg).not.toContain("= outer loop throughput");
    expect(renderStageZoom(e.getState(), content(), null)).toBe("");
  });

  it("shows setup slowdowns and leak once test-suite + ci-cd are owned", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    e.applyDecision("ci-cd");
    const s = e.getState();
    const svg = panel(s);

    // Both purchases carry a temporary all-rates x0.5 slowdown, still active
    // on day 0 -- these are drag (mul < 1) so they land under Friction.
    expect(inFrictionGroup(svg, "Add test suite: x0.5")).toBe(true);
    expect(inFrictionGroup(svg, "CI/CD pipeline: x0.5")).toBe(true);

    // test-suite's permanent debtMultiplier x0.5 lands under Leak size.
    expect(inLeakGroup(svg, "Add test suite: x0.5")).toBe(true);
    expect(svg).toContain("Base x0.5");
  });

  it("shows only a debt-paydown card's temporary slowdown under Friction (scaleStock creates no modifier, Release 16)", () => {
    // The lean Studio shop has no scaleStock card left (cut refactoring-sprint and redesign-rebuild), so the pairing this pins --
    // scaleStock alongside a temporary modifyRate -- comes from a fixture.
    const c = content();
    c.decisions = [
      ...c.decisions,
      {
        id: "refactoring-sprint",
        name: "Refactoring sprint",
        description: "r",
        category: "tame-debt",
        cost: {},
        effects: [
          { type: "scaleStock", stock: "techDebt", factor: 0.7 },
          { type: "modifyRate", target: "all", op: "mul", value: 0.6, durationDays: 8 },
        ],
        removable: false,
      },
    ];
    const e = new Engine(c);
    e.applyDecision("refactoring-sprint");
    const s = e.getState();
    const svg = panel(s, c);
    // The paired modifyRate all-mul-0.6 effect is drag (mul < 1), so it lands
    // under Friction as an instance-sourced contributor.
    expect(inFrictionGroup(svg, "Refactoring sprint: x0.6")).toBe(true);
    // scaleStock has no rate/debt-multiplier target, so it contributes no
    // Friction, Cycle-speed, or Leak-size row of its own -- techDebt isn't
    // surfaced as a rate contributor at all, so there is nothing else to see.
    const instanceModifiers = s.modifiers.filter((m) => m.source === s.decisions[0].instanceId);
    expect(instanceModifiers).toHaveLength(1);
    expect(instanceModifiers[0]).toMatchObject({ target: "allRates", op: "mul", value: 0.6 });
  });

  it("shows an owned dev's gamble contribution under Cycle speed, and moves it to Friction if forced negative", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const s = e.getState() as MutableState;
    const inst = s.decisions[0];
    // A hire now contributes two add modifiers (pull and finish, Release 15);
    // the panel only surfaces the finish/allRates one, so target that.
    const mod = s.modifiers.find((m) => m.source === inst.instanceId && m.target === "finish")!;
    expect(mod.value).toBeGreaterThan(0); // this seed rolls a positive hire

    const svgPositive = panel(s, content());
    expect(svgPositive).toContain(inst.gambleLabel!);
    expect(inSpeedGroup(svgPositive, `Hire basic developer [${inst.gambleLabel}]: +${mod.value}/day`)).toBe(true);

    // Force a net-negative outcome shape via the mutable escape hatch and
    // confirm the same instance now renders under Friction instead.
    mod.value = -0.5;
    const svgNegative = panel(s, content());
    expect(inFrictionGroup(svgNegative, "Hire basic developer")).toBe(true);
    expect(inSpeedGroup(svgNegative, "Hire basic developer")).toBe(false);
  });

  it("shows an agent's finish boost under Cycle speed and its debt cost under Leak size simultaneously", () => {
    const e = new Engine(content());
    const s = e.getState() as MutableState;
    s.decisions.push({ instanceId: "inst-agent", defId: "agent" });
    s.modifiers.push(
      { id: "mod-agent-1", source: "inst-agent", target: "finish", op: "mul", value: 1.2 },
      { id: "mod-agent-2", source: "inst-agent", target: "debtMultiplier", op: "mul", value: 1.2 },
    );
    const svg = panel(s, content());
    expect(inSpeedGroup(svg, "Add coding agent: x1.2")).toBe(true);
    expect(inLeakGroup(svg, "Add coding agent: x1.2")).toBe(true);
  });

  it("dims a sick instance's node under Cycle speed", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const s = e.getState() as MutableState;
    const inst = s.decisions[0];
    const mod = s.modifiers.find((m) => m.source === inst.instanceId)!;
    mod.value = Math.abs(mod.value) || 1; // guarantee a positive (speed-group) contribution
    inst.sickUntilDay = s.day + 3;
    inst.sickFactor = 0.5;
    const svg = panel(s, content());
    expect(svg).toContain("(sick)");
    expect(inSpeedGroup(svg, "(sick)")).toBe(true);
    expect(svg).toContain('class="stage-zoom-dim"');
  });

  it("labels a ramping add-op modifier under Cycle speed with its rounded value and a (ramping) suffix", () => {
    // No shipped Studio card ramps any more (cut self-learning-agents), but rampRate is still an engine effect content can
    // use, and the panel has to label it. Inject the owned instance and its ramp
    // modifier directly via the mutable-state escape hatch, matching source to
    // instanceId so it renders through the owned-decision branch exactly as a
    // real ramp modifier would.
    const e = new Engine(content());
    const s = e.getState() as MutableState;
    s.decisions.push({ instanceId: "inst-99", defId: "agent" });
    s.modifiers.push({
      id: "mod-test-ramp",
      source: "inst-99",
      target: "finish",
      op: "add",
      value: 0.39999999999999997, // 20 accumulated 0.02 increments; float tail is the point
      rampPerDay: 0.02,
      rampCap: 2.0,
    });
    const svg = panel(s, content());
    expect(inSpeedGroup(svg, "Add coding agent: +0.4/day (ramping)")).toBe(true);
    expect(svg).not.toContain("0.39999");
    expect(svg).not.toContain("0.4/day (ramping)/day"); // no double suffix/unit
  });

  it("shows a cleaned-up, expiry-labeled challenge modifier under Friction", () => {
    const e = new Engine(content());
    const s = e.getState() as MutableState;
    s.modifiers.push({
      id: "mod-test-1",
      source: "chal-prod-incident-d90",
      target: "allRates",
      op: "mul",
      value: 0.8,
      expiresDay: s.day + 2,
    });
    const svg = panel(s, content());
    expect(inFrictionGroup(svg, "prod-incident: x0.8 (2d left)")).toBe(true);
  });

  it("shows the tech-debt drag node under Friction once debt passes the grace band", () => {
    const e = new Engine(content());
    const s = e.getState() as MutableState;
    // Below the grace band (freeDebt 400 in shipped start.json): no drag node.
    s.stocks.techDebt = 100;
    expect(panel(s, content())).not.toContain("Tech debt drag");
    // Past the band: excess 1600 * 0.00015 = 0.24 drag -> multiplier 0.76.
    s.stocks.techDebt = 2000;
    const svg = panel(s, content());
    expect(inFrictionGroup(svg, "Tech debt drag x0.76")).toBe(true);
  });

  it("does not show a context-switch tax node when more than one project is active", () => {
    const e = new Engine(content());
    const s = e.getState() as MutableState;
    s.projects.push({ ...s.projects[0], defId: "second", name: "Second Project" });
    const svg = panel(s, content());
    expect(svg).not.toContain("Context switch");
  });

  it("omits the Friction header when there is no drag", () => {
    const e0 = new Engine(content());
    const svg0 = panel(e0.getState(), content());
    expect(svg0).not.toContain("Friction");
  });

  it("lists every injected contributor when stacks are large", () => {
    const e = new Engine(content());
    const s = e.getState() as MutableState;
    for (let i = 0; i < 8; i++) {
      s.modifiers.push(
        {
          id: `mod-speed-${i}`,
          source: `chal-test-speed-${i}`,
          target: "finish",
          op: "add",
          value: 0.2,
        },
        {
          id: `mod-leak-${i}`,
          source: `chal-test-leak-${i}`,
          target: "debtMultiplier",
          op: "mul",
          value: 1.1,
        },
        {
          id: `mod-friction-${i}`,
          source: `chal-test-friction-${i}`,
          target: "allRates",
          op: "mul",
          value: 0.9,
        },
      );
    }

    const crowded = panel(s, content());
    expect(crowded).toContain("test-speed-0");
    expect(crowded).toContain("test-speed-7");
    expect(crowded).toContain("test-leak-7");
    expect(crowded).toContain("test-friction-7");
  });

  it("renders negative contributions with a bare minus, not +-", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const s = e.getState() as MutableState;
    // Target the finish modifier -- the one the panel surfaces (Release 15
    // hires now split into pull + finish add modifiers).
    const mod = s.modifiers.find((m) => m.source === s.decisions[0].instanceId && m.target === "finish")!;
    mod.value = -0.5;
    const svg = panel(s, content());
    expect(svg).toContain("-0.5/day");
    expect(svg).not.toContain("+-0.5");
  });

  it("Done zoom shows deploy capacity vs finish inflow, not a card-id next lever", () => {
    const e = new Engine(content());
    const html = panel(e.getState(), content(), "done");
    expect(html).toContain("Deploy speed");
    expect(html).toContain("Why bound");
    expect(html).toContain("Base 1.0/day");
    expect(html).toContain("waiting");
    expect(html).not.toContain("pts waiting to ship");
    expect(html).not.toContain("ci-cd");
    expect(html).not.toContain("Cycle speed");
    expect(html).not.toContain("Leak size");
  });
});

// Local escape hatch: getState() returns Readonly<GameState>, but these tests
// deliberately poke at engine internals (sickness, injected modifiers, a
// second project) that have no public setter API. Cast through this alias
// rather than `any` so the mutated shape stays type-checked.
type MutableState = import("../engine/types").GameState;
