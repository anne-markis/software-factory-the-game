import { describe, it, expect } from "vitest";
import { inProgressPanelSvg } from "./inProgressPanel";
import { Engine } from "../engine/engine";
import { parseStartConfig, parseDecisions } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
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

// Locates the exit box's own bold value text, distinct from the "Cycle
// speed" stack's "Base X.X/day" contributor line, which also matches a bare
// "X.X/day" substring search.
function exitBoxValue(svg: string): string | undefined {
  return svg.match(/font-weight="bold"[^>]*>(-?\d+\.\d)\/day</)?.[1];
}

function viewBoxHeight(svg: string): number {
  const height = svg.match(/viewBox="0 0 \d+ (\d+(?:\.\d+)?)"/)?.[1];
  expect(height).toBeDefined();
  return Number(height);
}

describe("inProgressPanelSvg", () => {
  it("renders the loop, exit flow, leak arc, and footer on a fresh engine", () => {
    const e = new Engine(content());
    const svg = inProgressPanelSvg(e.getState(), content());
    expect(svg).toContain("Progress loop");
    expect(svg).toContain("work cycling");
    expect(svg).toContain("Cycle speed");
    expect(svg).toContain("Base 1.0/day");
    expect(svg).toContain("escapes to Done");
    // Issue #9: no tick has run yet on this fresh engine, so inProgress is
    // still 0 -- nothing was there for "finish" to actually move this tick,
    // even though its base capacity is 1.0/day. The exit box must show the
    // realized (zero) flow, not the stage's uncapped capacity.
    expect(exitBoxValue(svg)).toBe("0.0");
    expect(svg).toContain("x0.50"); // effectiveDebtMultiplier on the leak arc label
    expect(svg).toContain("The inner loop's pace sets outer throughput; its leak feeds outer backlog.");
    expect(svg).not.toContain("Context switch");
    // The old caption asserted the exit box's number equals outer-loop
    // throughput unconditionally; that's false whenever Done piles up
    // between the finish and deploy stages (see tick.test.ts's deploy-
    // bottleneck cases), so it must not appear regardless of this number.
    expect(svg).not.toContain("= outer loop throughput");
  });

  it("issue #9: exit box tracks realized finish flow across ticks, not raw finish-stage capacity", () => {
    const e = new Engine(content());
    e.tick(); // day 1: inProgress still 0 pre-tick (pull hasn't landed anything into it yet)
    expect(exitBoxValue(inProgressPanelSvg(e.getState(), content()))).toBe("0.0");
    for (let i = 0; i < 5; i++) e.tick(); // let the pipeline warm up so inProgress is nonzero
    const s = e.getState();
    expect(s.stocks.inProgress).toBeGreaterThan(0);
    // Once the pipeline has warmed up, base rate (1) is fully saturated (there
    // is always at least 1 point sitting in inProgress to finish), so realized
    // flow now matches capacity -- this is the expected, non-bottlenecked case.
    expect(exitBoxValue(inProgressPanelSvg(s, content()))).toBe("1.0");
  });

  it("switches the exit caption to Shipped, and shows setup slowdowns and leak once test-suite + ci-cd are owned", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    e.applyDecision("ci-cd");
    const s = e.getState();
    const svg = inProgressPanelSvg(s, content());

    expect(svg).toContain("escapes to Shipped");
    expect(svg).not.toContain("escapes to Done");

    // Both purchases carry a temporary all-rates x0.5 slowdown, still active
    // on day 0 -- these are drag (mul < 1) so they land under Friction.
    expect(inFrictionGroup(svg, "Add test suite: x0.5")).toBe(true);
    expect(inFrictionGroup(svg, "CI/CD pipeline: x0.5")).toBe(true);

    // test-suite's permanent debtMultiplier x0.5 lands under Leak size, and
    // combined with the 0.5 base it makes the effective leak arc label x0.25.
    expect(inLeakGroup(svg, "Add test suite: x0.5")).toBe(true);
    expect(svg).toContain("x0.25");
  });

  it("shows only refactoring-sprint's temporary slowdown under Friction (scaleStock creates no modifier, Release 16)", () => {
    const e = new Engine(content());
    e.applyDecision("refactoring-sprint");
    const s = e.getState();
    const svg = inProgressPanelSvg(s, content());
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

    const svgPositive = inProgressPanelSvg(s, content());
    expect(svgPositive).toContain(inst.gambleLabel!);
    expect(inSpeedGroup(svgPositive, `Hire basic developer [${inst.gambleLabel}]: +${mod.value}/day`)).toBe(true);

    // Force a net-negative outcome shape via the mutable escape hatch and
    // confirm the same instance now renders under Friction instead.
    mod.value = -0.5;
    const svgNegative = inProgressPanelSvg(s, content());
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
    const svg = inProgressPanelSvg(s, content());
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
    const svg = inProgressPanelSvg(s, content());
    expect(svg).toContain("(sick)");
    expect(inSpeedGroup(svg, "(sick)")).toBe(true);
    expect(svg).toContain('opacity="0.5"');
  });

  it("labels a ramping add-op modifier under Cycle speed with its rounded value and a (ramping) suffix", () => {
    // Real purchase chain for self-learning-agents runs through agent-harness
    // -> agent-swarm -> self-learning-agents, which is expensive to set up
    // and would tie this test to gamble rng along the way. Instead, inject
    // the owned instance and its ramp modifier directly via the mutable-state
    // escape hatch, matching source to instanceId so it renders through the
    // owned-decision branch exactly as the real ramp modifier would.
    const e = new Engine(content());
    const s = e.getState() as MutableState;
    s.decisions.push({ instanceId: "inst-99", defId: "self-learning-agents" });
    s.modifiers.push({
      id: "mod-test-ramp",
      source: "inst-99",
      target: "finish",
      op: "add",
      value: 0.39999999999999997, // 20 accumulated 0.02 increments; float tail is the point
      rampPerDay: 0.02,
      rampCap: 2.0,
    });
    const svg = inProgressPanelSvg(s, content());
    expect(inSpeedGroup(svg, "Self-learning agents: +0.4/day (ramping)")).toBe(true);
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
    const svg = inProgressPanelSvg(s, content());
    expect(inFrictionGroup(svg, "prod-incident: x0.8 (2d left)")).toBe(true);
  });

  it("shows the tech-debt drag node under Friction once debt passes the grace band", () => {
    const e = new Engine(content());
    const s = e.getState() as MutableState;
    // Below the grace band (freeDebt 400 in shipped start.json): no drag node.
    s.stocks.techDebt = 100;
    expect(inProgressPanelSvg(s, content())).not.toContain("Tech debt drag");
    // Past the band: excess 1600 * 0.00015 = 0.24 drag -> multiplier 0.76.
    s.stocks.techDebt = 2000;
    const svg = inProgressPanelSvg(s, content());
    expect(inFrictionGroup(svg, "Tech debt drag x0.76")).toBe(true);
  });

  it("shows the context-switch tax node under Friction when more than one project is active", () => {
    const e = new Engine(content());
    const s = e.getState() as MutableState;
    s.projects.push({ ...s.projects[0], defId: "second", name: "Second Project" });
    const svg = inProgressPanelSvg(s, content());
    expect(inFrictionGroup(svg, "Context switch x0.85")).toBe(true);
  });

  it("keeps a fresh no-friction panel close to its content without the old six-row reserve", () => {
    const e0 = new Engine(content());
    const svg0 = inProgressPanelSvg(e0.getState(), content());
    expect(svg0).not.toContain("Friction"); // fresh engine has no drag, group omitted
    const height0 = viewBoxHeight(svg0);
    expect(height0).toBeLessThan(450);
    expect(height0).not.toBe(484); // old worst-case reserve for six rows in every group
  });

  it("lets the viewBox grow when contributor stacks are large", () => {
    const fresh = new Engine(content());
    const freshHeight = viewBoxHeight(inProgressPanelSvg(fresh.getState(), content()));

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

    const crowdedHeight = viewBoxHeight(inProgressPanelSvg(s, content()));
    expect(crowdedHeight).toBeGreaterThan(freshHeight);
    expect(crowdedHeight).toBeGreaterThan(484);
  });

  it("renders negative contributions with a bare minus, not +-", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const s = e.getState() as MutableState;
    // Target the finish modifier -- the one the panel surfaces (Release 15
    // hires now split into pull + finish add modifiers).
    const mod = s.modifiers.find((m) => m.source === s.decisions[0].instanceId && m.target === "finish")!;
    mod.value = -0.5;
    const svg = inProgressPanelSvg(s, content());
    expect(svg).toContain("-0.5/day");
    expect(svg).not.toContain("+-0.5");
  });

  // Issue #10 follow-up: <rect>/<line>/<ellipse>/<path> shapes use
  // stroke="currentColor" and correctly inherit dark-mode text color, but
  // SVG's fill defaults to black independent of the surrounding CSS cascade
  // -- a <text> element without an explicit fill renders unreadable
  // black-on-black in dark mode even though every other shape in the same
  // diagram adapts correctly. This test inspects the actual generated SVG
  // markup (not index.html's static stylesheet, which darkMode.test.ts
  // already covers and which never sees this dynamically-built markup at
  // all) so a future <text> element added without fill="currentColor" fails
  // immediately instead of shipping invisible.
  it("issue #10: every <text> element sets fill=currentColor so it adapts to dark mode", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    e.applyDecision("test-suite");
    e.applyDecision("ci-cd");
    const svg = inProgressPanelSvg(e.getState(), content());
    const textTags = svg.match(/<text\b[^>]*>/g) ?? [];
    expect(textTags.length).toBeGreaterThan(0);
    for (const tag of textTags) {
      expect(tag).toContain('fill="currentColor"');
    }
  });
});

// Local escape hatch: getState() returns Readonly<GameState>, but these tests
// deliberately poke at engine internals (sickness, injected modifiers, a
// second project) that have no public setter API. Cast through this alias
// rather than `any` so the mutated shape stays type-checked.
type MutableState = import("../engine/types").GameState;
