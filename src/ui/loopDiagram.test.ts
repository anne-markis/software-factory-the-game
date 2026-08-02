import { describe, it, expect } from "vitest";
import { loopDiagramSvg } from "./loopDiagram";
import { initialState } from "../engine/engine";
import { tick } from "../engine/tick";
import { createRng } from "../engine/rng";
import { parseStartConfig, parseDecisions } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import type { GameContent } from "../engine/types";

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
    for (const label of ["Backlog", "In Progress", "Done", "Shipped"]) expect(svg).toContain(label);
    expect(svg).toContain("1,500"); // backlog value
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
    // First tick: backlog (1500) is plentiful so pull saturates its 1.0/day
    // capacity, but inProgress and done both start at 0, so nothing was
    // actually there yet for finish/deploy to move -- their realized flow is
    // genuinely 0 this tick even though their base capacity is also 1.0/day.
    // Buggy behavior (pre-fix): all three arrows print the uncapped
    // 1.0/day capacity regardless of what actually moved.
    tick(state, createRng(content.start.seed), content, () => {});
    const svg = loopDiagramSvg(state, content);
    expect(svg).toContain("1.0/day"); // pull: realized flow == capacity here, backlog wasn't the constraint
    expect(svg.match(/0\.0\/day/g)).toHaveLength(2); // finish AND deploy: realized flow, not capacity
  });

  it("drops the Done box and shows the continuous-deploy caption once ci-cd is owned", () => {
    const content = fullDecisionsContent();
    const state = initialState(content);
    // Mutable escape hatch: grant ci-cd directly rather than routing through
    // a full purchase (requires/budget/gamble are exercised elsewhere).
    state.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
    const svg = loopDiagramSvg(state, content);
    expect(svg).toContain("Backlog");
    expect(svg).toContain("In Progress");
    expect(svg).toContain("Shipped");
    expect(svg).not.toContain(">Done<");
    expect(svg).toContain("continuous deploy");
    expect(svg.match(/<line /g)).toHaveLength(2); // pull, finish only
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
});
