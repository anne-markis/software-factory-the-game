// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { Engine } from "../engine/engine";
import { parseStartConfig, parseProjects } from "../engine/content";
import { loadShippedContent, projectsJson, startJson } from "../engine/loadShippedContent";
import { committedWork, unshippedWork, workLedgerIssues } from "../engine/work";
import type { GameContent, GameState } from "../engine/types";
import {
  DEV_CONSOLE_HELP,
  installDevConsole,
  peekCheats,
  setBudget,
  setStoryPoints,
  type StoryPointStage,
} from "./devConsole";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: parseProjects(projectsJson) };
}

describe("cheat mutators (ledger-safe)", () => {
  it("setBudget writes budget and rejects negatives", () => {
    const e = new Engine(content());
    const s = e.getState() as GameState;
    setBudget(s, 50000);
    expect(s.stocks.budget).toBe(50000);
    expect(() => setBudget(s, -1)).toThrow(/budget/);
    expect(() => setBudget(s, Number.NaN)).toThrow(/budget/);
  });

  it("setStoryPoints syncs oldest remaining and Ready, leaving no ledger issues", () => {
    const e = new Engine(content());
    const s = e.getState() as GameState;
    setStoryPoints(s, 40);
    expect(s.projects[0]!.remaining).toBe(40);
    expect(s.stocks.backlog).toBe(40);
    expect(s.stocks.inProgress).toBe(0);
    expect(s.stocks.done).toBe(0);
    expect(unshippedWork(s)).toBe(40);
    expect(committedWork(s)).toBe(40);
    expect(workLedgerIssues(s)).toEqual([]);
  });

  it("setStoryPoints(..., 'inProgress') parks the contract in WIP with Ready empty", () => {
    const e = new Engine(content());
    const s = e.getState() as GameState;
    setStoryPoints(s, 40, "inProgress");
    expect(s.stocks.backlog).toBe(0);
    expect(s.stocks.inProgress).toBe(40);
    expect(s.projects[0]!.remaining).toBe(40);
    expect(workLedgerIssues(s)).toEqual([]);
  });

  it("setStoryPoints keeps later contracts in the same stage so FIFO still adds up", () => {
    const e = new Engine(content());
    e.startProject("gig-bugfix");
    const s = e.getState() as GameState;
    const later = s.projects[1]!.remaining;
    setStoryPoints(s, 10, "done");
    expect(s.projects[0]!.remaining).toBe(10);
    expect(s.projects[1]!.remaining).toBe(later);
    expect(s.stocks.done).toBe(10 + later);
    expect(unshippedWork(s)).toBe(committedWork(s));
    expect(workLedgerIssues(s)).toEqual([]);
  });

  it("setStoryPoints rejects negatives and unknown stages", () => {
    const e = new Engine(content());
    const s = e.getState() as GameState;
    expect(() => setStoryPoints(s, -1)).toThrow(/story points/);
    expect(() => setStoryPoints(s, 10, "shipped" as StoryPointStage)).toThrow(/stage/);
  });

  it("setStoryPoints with no project only fills leftover pipeline", () => {
    const e = new Engine(content());
    const s = e.getState() as GameState;
    s.projects = [];
    setStoryPoints(s, 12, "done");
    expect(s.stocks.done).toBe(12);
    expect(s.stocks.backlog).toBe(0);
    expect(workLedgerIssues(s)).toEqual([]);
  });

  it("peekCheats reports era, budget, unshipped, and remaining", () => {
    const e = new Engine(loadShippedContent());
    const snap = peekCheats(e.getState());
    expect(snap.era).toBe("studio");
    expect(snap.budget).toBe(10000);
    expect(snap.unshipped).toBe(300);
    expect(snap.remaining[0]).toEqual({ name: "Launch beta", points: 300 });
  });

  it("peekCheats reports the restored era id, not the start-bundle default", () => {
    const snap = peekCheats(new Engine(loadShippedContent("company")).getState());
    expect(snap.era).toBe("company");
  });
});

describe("installDevConsole", () => {
  afterEach(() => {
    delete window.sf;
  });

  it("hangs sf on window, applies budget/points, renders, saves, and uninstalls", () => {
    const e = new Engine(content());
    let renders = 0;
    let saves = 0;
    const uninstall = installDevConsole({
      engine: e,
      render: () => {
        renders++;
      },
      save: () => {
        saves++;
      },
    });
    expect(window.sf).toBeDefined();
    expect(window.sf!.help()).toContain("sf.era");
    expect(window.sf!.help()).toContain("sf.budget");
    expect(DEV_CONSOLE_HELP).toContain("sf.points");
    expect(window.sf!.era()).toBe("_fixture");

    expect(window.sf!.budget(25000)).toBe(25000);
    expect(e.getState().stocks.budget).toBe(25000);
    expect(window.sf!.points(40, "inProgress")).toBe(40);
    expect(e.getState().stocks.inProgress).toBe(40);
    expect(e.getState().projects[0]!.remaining).toBe(40);
    expect(renders).toBe(2);
    expect(saves).toBe(2);
    expect(window.sf!.peek().unshipped).toBe(40);

    uninstall();
    expect(window.sf).toBeUndefined();
  });

  it("budget()/points()/era() with no args are reads and do not save", () => {
    const e = new Engine(loadShippedContent());
    let saves = 0;
    installDevConsole({ engine: e, render: () => {}, save: () => { saves++; } });
    expect(window.sf!.budget()).toBe(10000);
    expect(window.sf!.points()).toBe(300);
    expect(window.sf!.era()).toBe("studio");
    expect(saves).toBe(0);
  });

  it("era() follows a silent Company crossing", () => {
    const e = new Engine(loadShippedContent("company"));
    installDevConsole({ engine: e, render: () => {}, save: () => {} });
    expect(window.sf!.era()).toBe("company");
    expect(window.sf!.peek().era).toBe("company");
  });
});
