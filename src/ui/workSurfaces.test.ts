// @vitest-environment jsdom
//
// Cross-surface point counting (ADR 0009). The dual-ledger bug was invisible
// to engine unit tests that checked Ready-stage stock and project.remaining
// separately: each assertion passed while the cockpit, Delivery diagram,
// delivery stats, and Projects panel told three different stories. These
// tests parse every player-facing number and require they agree.
import { describe, it, expect } from "vitest";
import { mountAppView, type AppView } from "./appView";
import { Engine, initialState } from "../engine/engine";
import { parseStartConfig, parseDecisions, parseProjects } from "../engine/content";
import { decisionsJson, projectsJson, startJson } from "../engine/loadShippedContent";
import { surplusWork, unshippedWork, workLedgerIssues } from "../engine/work";
import { fmt } from "./render";
import { projectEtaDays } from "./projectEta";
import type { GameContent, GameState } from "../engine/types";
import type { Speed } from "./tickDriver";

function makeContent(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: [],
    projects: parseProjects(projectsJson),
  };
}

function mount(content: GameContent = makeContent(), restored?: GameState): { root: HTMLElement; engine: Engine; view: AppView } {
  document.body.innerHTML = `<div id="app"></div>`;
  const root = document.getElementById("app")!;
  const engine = new Engine(content, restored ?? initialState(content));
  let speed: Speed = 1;
  const view = mountAppView({
    root,
    engine,
    content,
    getSpeed: () => speed,
    onSpeedChange: (s) => {
      speed = s;
    },
    onAction: () => {},
    onReset: () => {},
    onError: () => {},
  });
  return { root, engine, view };
}

function statValue(root: HTMLElement, stat: string): string {
  const el = root.querySelector(`[data-stat="${stat}"] .stat-value`);
  expect(el, `missing [data-stat=${stat}]`).not.toBeNull();
  return el!.textContent ?? "";
}

function stageValue(root: HTMLElement, stage: string): string | null {
  const el = root.querySelector(`[data-stage="${stage}"] [data-stage-value]`);
  return el?.textContent ?? null;
}

function projectLine(root: HTMLElement, defId: string): string {
  const el = root.querySelector(`[data-project-status="${defId}"]`);
  expect(el, `missing [data-project-status=${defId}]`).not.toBeNull();
  return el!.textContent ?? "";
}

/** Every painted work number must match the engine ledger. */
function assertSurfacesAgree(root: HTMLElement, state: Readonly<GameState>): void {
  expect(workLedgerIssues(state)).toEqual([]);

  expect(statValue(root, "backlog")).toBe(fmt(unshippedWork(state)));
  expect(statValue(root, "inProgress")).toBe(fmt(state.stocks.inProgress));
  expect(statValue(root, "done")).toBe(fmt(state.stocks.done));
  expect(statValue(root, "shipped")).toBe(fmt(state.stocks.shipped));

  expect(stageValue(root, "ideas")).toBe(fmt(state.stocks.ideas));
  expect(stageValue(root, "plan")).toBe(fmt(state.stocks.plan));
  expect(stageValue(root, "backlog")).toBe(fmt(state.stocks.backlog));
  expect(stageValue(root, "inProgress")).toBe(fmt(state.stocks.inProgress));
  expect(stageValue(root, "shipped")).toBe(fmt(state.stocks.shipped));
  const doneBox = stageValue(root, "done");
  if (doneBox !== null) expect(doneBox).toBe(fmt(state.stocks.done));

  for (const p of state.projects) {
    expect(projectLine(root, p.defId)).toContain(`${fmt(p.remaining)} points left`);
  }

  for (const item of state.plan) {
    const el = root.querySelector(`[data-plan-status="${item.defId}"]`);
    expect(el, `missing [data-plan-status=${item.defId}]`).not.toBeNull();
    expect(el!.textContent ?? "").toContain(`${fmt(item.progress)} / ${fmt(item.size)}`);
    expect(el!.querySelector("[data-cancel]")?.textContent).toBe("Cancel");
  }

  // The reported bug: Ready empty, remaining still in later stages. Cockpit
  // Backlog and Projects remaining must still be the same number.
  if (state.projects.length === 1 && surplusWork(state) < 0.05) {
    expect(statValue(root, "backlog")).toBe(fmt(state.projects[0]!.remaining));
  }

  if (state.completedProjects < 1) {
    expect(statValue(root, "users")).toBe(fmt(0));
  }
}

describe("cross-surface work counting (ADR 0009)", () => {
  it("agrees on a fresh game: cockpit Backlog = Ready = remaining = 300, users 0", () => {
    const { root, engine } = mount();
    const s = engine.getState();
    assertSurfacesAgree(root, s);
    expect(statValue(root, "backlog")).toBe("300");
    expect(stageValue(root, "backlog")).toBe("300");
    expect(projectLine(root, "launch-beta")).toContain("Launch beta: 300 points left");
    expect(statValue(root, "users")).toBe("0");
  });

  it("keeps cockpit Backlog on unshipped work after pull (Ready drops, remaining does not)", () => {
    const { root, engine, view } = mount();
    engine.tick();
    view.render();
    const s = engine.getState();
    expect(s.stocks.backlog).toBe(298);
    expect(s.stocks.inProgress).toBe(2);
    expect(s.projects[0]!.remaining).toBe(300);
    assertSurfacesAgree(root, s);
    expect(statValue(root, "backlog")).toBe("300");
    expect(stageValue(root, "backlog")).toBe("298");
    expect(stageValue(root, "inProgress")).toBe("2");
    expect(statValue(root, "inProgress")).toBe("2");
    expect(projectLine(root, "launch-beta")).toContain("300 points left");
  });

  it("at the Ready-empty WIP bubble, cockpit Backlog matches Projects remaining (not 0)", () => {
    const { root, engine, view } = mount();
    let readyEmpty = false;
    for (let i = 0; i < 400 && !readyEmpty; i++) {
      engine.tick();
      const s = engine.getState();
      if (s.stocks.backlog <= 1e-9 && s.completedProjects === 0) readyEmpty = true;
    }
    view.render();
    const s = engine.getState();
    expect(readyEmpty).toBe(true);
    expect(s.stocks.backlog).toBeLessThanOrEqual(1e-9);
    expect(s.projects[0]!.remaining).toBeGreaterThan(1);
    expect(s.stocks.users).toBe(0);
    assertSurfacesAgree(root, s);
    expect(statValue(root, "backlog")).not.toBe("0");
    expect(statValue(root, "backlog")).toBe(fmt(s.projects[0]!.remaining));
    expect(stageValue(root, "backlog")).toBe(fmt(s.stocks.backlog));
    expect(projectLine(root, "launch-beta")).toContain(`${fmt(s.projects[0]!.remaining)} points left`);
    expect(statValue(root, "users")).toBe("0");
    if (s.pointsPerDay > 0) {
      expect(projectLine(root, "launch-beta")).toContain(
        `~${fmt(projectEtaDays(s.projects[0]!.remaining, s.pointsPerDay, s.projects.length)!)}`,
      );
    }
  });

  it("agrees after the beta completes (users grant, no in-flight remaining)", () => {
    const { root, engine, view } = mount();
    for (let i = 0; i < 400 && engine.getState().completedProjects === 0; i++) engine.tick();
    view.render();
    const s = engine.getState();
    expect(s.completedProjects).toBe(1);
    assertSurfacesAgree(root, s);
    expect(root.querySelector('[data-project-status="launch-beta"]')).toBeNull();
    expect(statValue(root, "users")).not.toBe("0");
  });

  it("paints Planning progress / size that matches the engine Plan ledger", () => {
    const { root, engine, view } = mount();
    const s = engine.getState();
    s.completedProjects = 1;
    s.completedProjectIds = ["launch-beta"];
    s.stocks.ideas = 850;
    engine.pursueProject("ship-v1");
    engine.pursueProject("gig-plugin");
    view.render();
    assertSurfacesAgree(root, engine.getState());
    expect(projectLine(root, "launch-beta")).toContain("Abandon");
    expect(root.querySelector('[data-plan-status="ship-v1"]')!.textContent).toContain("~800 days");
    expect(root.querySelector('[data-plan-status="gig-plugin"]')!.textContent).toContain("~900 days");
    engine.tick();
    view.render();
    assertSurfacesAgree(root, engine.getState());
    expect(engine.getState().plan[0]!.progress).toBe(0.5);
    expect(engine.getState().plan[1]!.progress).toBe(0.5);
  });

  it("agrees under continuous deploy (no Done box, delivery Done stat still 0-ish after ship)", () => {
    const content = makeContent();
    const restored = initialState(content);
    restored.decisions.push({ instanceId: "inst-cd", defId: "ci-cd" });
    const { root, engine, view } = mount(content, restored);
    for (let i = 0; i < 10; i++) engine.tick();
    view.render();
    expect(stageValue(root, "done")).toBeNull();
    assertSurfacesAgree(root, engine.getState());
  });
});
