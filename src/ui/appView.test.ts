// @vitest-environment jsdom
//
// Issue #6: the driver re-renders up to 10x/second while unpaused. When a
// render tears down and rebuilds every button, a real mousedown/mouseup
// gesture can straddle the rebuild -- mousedown lands on a node that no
// longer exists by mouseup, so no click event is ever produced and the
// delegated listener on #app never fires.
//
// That native gesture timing is not reproducible in jsdom (a programmatic
// element.click() is a single synthetic event that does not care whether the
// node existed a moment ago), so these tests assert the property that
// actually fixes the bug: DOM NODE IDENTITY. An interactive element must be
// the very same node (===) after a render whose underlying data did not
// change. If identity holds, there is no teardown for a gesture to straddle.
import { describe, it, expect, vi } from "vitest";
import { mountAppView, type AppView } from "./appView";
import { Engine, initialState } from "../engine/engine";
import { parseStartConfig, parseDecisions, parseChallenges, parseProjects } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import challengesJson from "../../content/challenges.json";
import projectsJson from "../../content/projects.json";
import type { GameContent, GameState } from "../engine/types";
import type { Speed } from "./tickDriver";

// challenges default to [] so ticking is free of random challenge rolls: the
// only thing moving across ticks is the deterministic stock/flow simulation.
function makeContent(challenges: GameContent["challenges"] = []): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges,
    projects: parseProjects(projectsJson),
  };
}

interface Harness {
  root: HTMLElement;
  engine: Engine;
  view: AppView;
  state: GameState;
  speed: () => Speed;
  speedChanges: Speed[];
  actions: number;
  resets: number;
  errors: string[];
}

function mount(opts: { content?: GameContent; restored?: GameState; richBudget?: boolean } = {}): Harness {
  const content = opts.content ?? makeContent();
  document.body.innerHTML = `<div id="app"></div>`;
  const root = document.getElementById("app")!;
  const restored = opts.restored ?? initialState(content);
  // A budget far above every cost keeps affordability (and therefore the
  // tech-tree / project-offer markup) fixed across ticks, so a node identity
  // assertion is testing the render mechanism rather than racing the economy.
  if (opts.richBudget !== false) restored.stocks.budget = 1_000_000_000;
  const engine = new Engine(content, restored);

  let speed: Speed = 1;
  const h: Harness = {
    root,
    engine,
    state: restored,
    view: undefined as unknown as AppView,
    speed: () => speed,
    speedChanges: [],
    actions: 0,
    resets: 0,
    errors: [],
  };
  h.view = mountAppView({
    root,
    engine,
    content,
    getSpeed: () => speed,
    onSpeedChange: (s) => {
      speed = s;
      h.speedChanges.push(s);
    },
    onAction: () => {
      h.actions++;
    },
    onReset: () => {
      h.resets++;
    },
    onError: (m) => {
      h.errors.push(m);
    },
  });
  return h;
}

function pauseButton(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>("#pause");
  expect(el).not.toBeNull();
  return el!;
}

describe("appView delivery-column stats layout (issue #8)", () => {
  it("keeps Day/Backlog/Budget/Points/Day in the top bar and places the other five under Delivery loop", () => {
    const h = mount();
    const top = h.root.querySelector(".stats")!;
    expect(top).toBeTruthy();
    const topLabels = Array.from(top.querySelectorAll(".stat-label")).map((el) => el.textContent);
    expect(topLabels).toEqual(["Day", "Backlog", "Budget", "Points/Day"]);

    const deliveryCol = h.root.querySelector(".delivery-column")!;
    expect(deliveryCol).toBeTruthy();
    expect(deliveryCol.querySelector("h3")!.textContent).toBe("Delivery loop");
    const under = deliveryCol.querySelector(".delivery-stats")!;
    expect(under).toBeTruthy();
    // Stats sit after the Delivery loop panel inside the same column
    // (issue #67: wrapped in a data-section host for in-place flash sync).
    const statsHost = deliveryCol.querySelector(".panel")!.nextElementSibling!;
    expect(statsHost.contains(under)).toBe(true);
    const underLabels = Array.from(under.querySelectorAll(".stat-label")).map((el) => el.textContent);
    expect(underLabels).toEqual(["In Progress", "Done", "Shipped", "Tech Debt", "Reputation"]);

    // Progress loop remains a sibling of the delivery column, not a parent of those stats.
    const loops = h.root.querySelector(".loops")!;
    expect(loops.contains(deliveryCol)).toBe(true);
    expect(loops.querySelector("h3")!.textContent).toBe("Delivery loop");
    const headings = Array.from(loops.querySelectorAll("h3")).map((el) => el.textContent);
    expect(headings).toContain("Progress loop");
    expect(under.closest(".panel")).toBeNull();
  });

  it("keeps delivery-stats nodes stable across ticks that only change values", () => {
    const h = mount();
    const before = h.root.querySelector(".delivery-stats")!;
    const beforeInProgress = before.querySelector(".v-count")!;
    for (let i = 0; i < 5; i++) {
      h.engine.tick();
      h.view.render();
    }
    // Issue #67: in-place sync keeps the row and value nodes identical across
    // ticks so flash animations are not torn down by string-memo patches.
    const after = h.root.querySelector(".delivery-stats")!;
    expect(after).toBe(before);
    expect(after.querySelector(".v-count")).toBe(beforeInProgress);
    expect(after.querySelector(".stat-label")!.textContent).toBe("In Progress");
    expect(h.root.querySelector(".delivery-column .delivery-stats")).toBe(after);
    expect(h.root.querySelector(".stats .stat-label")!.textContent).toBe("Day");
  });
});

describe("appView game feel (issue #67)", () => {
  it("flashes a material cockpit stat when its value changes on tick", () => {
    const h = mount();
    h.view.render();
    const backlog = h.root.querySelector<HTMLElement>(".stats .v-flow")!;
    expect(backlog.classList.contains("stat-flash")).toBe(false);
    for (let i = 0; i < 5; i++) h.engine.tick();
    h.view.render();
    // Backlog moves under the idle start config; Day must not flash.
    expect(h.root.querySelector(".stats .v-day")!.classList.contains("stat-flash")).toBe(false);
    expect(h.root.querySelector(".stats .v-flow")!.classList.contains("stat-flash")).toBe(true);
  });

  it("shows a short gamble reveal when buying a hire gamble, not only a log line", () => {
    vi.useFakeTimers();
    const h = mount();
    const buy = h.root.querySelector<HTMLElement>('[data-buy="basic-dev"]')!;
    expect(buy).toBeTruthy();
    buy.click();
    const inst = h.engine.getState().decisions.find((d) => d.defId === "basic-dev");
    expect(inst?.gambleLabel).toBeTruthy();
    const reveal = h.root.querySelector(".gamble-reveal")!;
    expect(reveal).toBeTruthy();
    expect(reveal.getAttribute("role")).toBe("status");
    expect(reveal.textContent).toContain("Hire basic developer");
    expect(reveal.textContent).toContain(inst!.gambleLabel!);
    // Still present in the Events log (reveal is additive).
    expect(h.root.querySelector(".log")!.textContent).toContain(inst!.gambleLabel!);
    vi.advanceTimersByTime(2600);
    expect(h.root.querySelector(".gamble-reveal")).toBeNull();
    vi.useRealTimers();
  });

  it("does not show a gamble reveal for a deterministic purchase", () => {
    const h = mount();
    const buy = h.root.querySelector<HTMLElement>('[data-buy="test-suite"]')!;
    expect(buy).toBeTruthy();
    buy.click();
    expect(h.root.querySelector(".gamble-reveal")).toBeNull();
    expect(h.root.querySelector(".log")!.textContent).toMatch(/Purchased: .*test suite/i);
  });
});

describe("appView node identity across renders (issue #6)", () => {
  it("keeps the same Pause button node across repeated renders with unchanged state", () => {
    const h = mount();
    const before = pauseButton(h.root);
    for (let i = 0; i < 5; i++) h.view.render();
    expect(pauseButton(h.root)).toBe(before);
    expect(h.root.contains(before)).toBe(true);
  });

  it("keeps the same Pause button node across ticks, which change stats but not the time controls", () => {
    const h = mount();
    const before = pauseButton(h.root);
    for (let i = 0; i < 10; i++) {
      h.engine.tick();
      h.view.render();
      expect(pauseButton(h.root)).toBe(before);
    }
    // The render really did run: the day counter moved with the ticks.
    expect(h.root.querySelector(".stat-value.v-day")!.textContent).toBe("10");
  });

  it("keeps the same speed button nodes across ticks", () => {
    const h = mount();
    const before = h.root.querySelector<HTMLElement>('[data-speed="5"]')!;
    for (let i = 0; i < 10; i++) {
      h.engine.tick();
      h.view.render();
    }
    expect(h.root.querySelector('[data-speed="5"]')).toBe(before);
  });

  it("keeps the same tech-tree Buy button node across ticks when availability is unchanged", () => {
    const h = mount();
    const before = h.root.querySelector<HTMLElement>("[data-buy]:not([disabled])")!;
    expect(before).toBeTruthy();
    const id = before.dataset.buy!;
    for (let i = 0; i < 10; i++) {
      h.engine.tick();
      h.view.render();
      expect(h.root.querySelector(`[data-buy="${id}"]`)).toBe(before);
    }
  });

  // Issue #24: previously the whole Alter-the-loop block was one memoized
  // string, so any single node's affordability flip rebuilt every Buy button.
  // Per-node patched sections keep unrelated Buy nodes alive.
  it("keeps one decision's Buy button when another node's affordability flips (issue #24)", () => {
    const content = makeContent();
    content.start.stocks.budget = 500; // exactly affords test-suite ($500)
    // richBudget: false so the start budget above is not overwritten — the
    // flip from 500 → 499 is what rebuilds test-suite while basic-dev stays put.
    const h = mount({ content, richBudget: false });

    const stable = h.root.querySelector<HTMLElement>('[data-buy="basic-dev"]')!;
    expect(stable).toBeTruthy();
    expect(stable.hasAttribute("disabled")).toBe(false);

    const flipping = h.root.querySelector<HTMLElement>('[data-buy="test-suite"]')!;
    expect(flipping).toBeTruthy();
    expect(flipping.hasAttribute("disabled")).toBe(false);

    h.state.stocks.budget = 499;
    h.view.render();

    expect(h.root.querySelector('[data-buy="basic-dev"]')).toBe(stable);
    const flipped = h.root.querySelector<HTMLElement>('[data-buy="test-suite"]')!;
    expect(flipped).not.toBe(flipping);
    expect(flipped.hasAttribute("disabled")).toBe(true);
    expect(h.root.textContent).toContain("cannot afford");
  });

  it("keeps the same project Start button node across ticks even while an in-flight project's remaining points change", () => {
    const h = mount();
    const before = h.root.querySelector<HTMLElement>('[data-project="small-crm"]')!;
    expect(before).toBeTruthy();
    const remainingBefore = h.root.textContent!.match(/First Contract: [\d,.]+ points left/)![0];
    for (let i = 0; i < 10; i++) {
      h.engine.tick();
      h.view.render();
      expect(h.root.querySelector('[data-project="small-crm"]')).toBe(before);
    }
    // The volatile in-flight line beside the button did update.
    const remainingAfter = h.root.textContent!.match(/First Contract: [\d,.]+ points left/)![0];
    expect(remainingAfter).not.toBe(remainingBefore);
  });

  it("keeps the same choice option button nodes while the expiry countdown beside them ticks down", () => {
    const content = makeContent(parseChallenges(challengesJson));
    const restored = initialState(content);
    restored.day = 5;
    restored.pendingChoices = [{ challengeId: "key-dev-poached", expiresDay: 8 }];
    const h = mount({ content, restored });
    const before = h.root.querySelector<HTMLElement>('[data-choice="key-dev-poached"][data-option="match-offer"]')!;
    expect(before).toBeTruthy();
    expect(h.root.textContent).toContain("(3 days left)");

    // Advance the day directly rather than ticking, so the countdown is the
    // only thing that moves in this region.
    h.state.day = 6;
    h.view.render();

    expect(h.root.querySelector('[data-choice="key-dev-poached"][data-option="match-offer"]')).toBe(before);
    expect(h.root.textContent).toContain("(2 days left)");
    expect(h.root.textContent).not.toContain("(3 days left)");
  });

  it("keeps the same Reset button node across ticks", () => {
    const h = mount();
    const before = h.root.querySelector<HTMLElement>("#reset")!;
    for (let i = 0; i < 5; i++) {
      h.engine.tick();
      h.view.render();
    }
    expect(h.root.querySelector("#reset")).toBe(before);
  });
});

describe("appView page layout (issue #7)", () => {
  it("places time controls and Reset above the stats bar and loop panels", () => {
    const h = mount();
    const order = () => {
      const kids = Array.from(h.root.children) as HTMLElement[];
      return {
        time: kids.findIndex((el) => el.getAttribute("data-section") === "time-controls"),
        reset: kids.findIndex((el) => el.id === "reset"),
        stats: kids.findIndex((el) => el.getAttribute("data-section") === "stats"),
        loops: kids.findIndex((el) => el.classList.contains("loops")),
      };
    };
    const before = order();
    expect(before.time).toBe(0);
    expect(before.reset).toBe(1);
    expect(before.stats).toBeGreaterThan(before.reset);
    expect(before.loops).toBeGreaterThan(before.stats);
    // Scaffold is static: order holds across ticks.
    h.engine.tick();
    h.view.render();
    expect(order()).toEqual(before);
  });
});

describe("appView keeps the DOM in step with state (no stale memoized regions)", () => {
  it("shows the build stamp with version, deployed time, and repo link on mount (issue #45)", () => {
    const h = mount();
    const stamp = h.root.querySelector(".build-stamp");
    expect(stamp).not.toBeNull();
    expect(stamp!.textContent).toMatch(/deployed/);
    const link = stamp!.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://github.com/anne-markis/software-factory-the-game");
    expect(link!.textContent).toBe("source");
  });

  it("flips the Pause label when the pause state changes", () => {
    const h = mount();
    expect(pauseButton(h.root).textContent).toBe("Pause");
    h.view.togglePause();
    expect(pauseButton(h.root).textContent).toBe("Resume");
    h.view.togglePause();
    expect(pauseButton(h.root).textContent).toBe("Pause");
  });

  it("moves the active speed marker when a speed button is clicked", () => {
    const h = mount();
    h.root.querySelector<HTMLElement>('[data-speed="5"]')!.click();
    expect(h.speedChanges).toEqual([5]);
    expect(h.root.querySelector('[data-speed="5"]')!.className).toContain("tc-active");
    expect(h.root.querySelector('[data-speed="1"]')!.className).not.toContain("tc-active");
  });

  it("shows a newly purchased decision in the Owned panel", () => {
    const h = mount();
    const buy = h.root.querySelector<HTMLElement>("[data-buy]:not([disabled])")!;
    const id = buy.dataset.buy!;
    const name = buy.closest(".tt-node")!.querySelector(".tt-node-name")!.textContent!;
    buy.click();
    expect(h.engine.getState().decisions.some((d) => d.defId === id)).toBe(true);
    const owned = h.root.querySelectorAll(".panel")[0];
    expect(owned).toBeTruthy();
    expect(h.root.textContent).toContain(name);
    expect(h.actions).toBe(1);
  });

  it("drops a resolved choice out of the DOM", () => {
    const content = makeContent(parseChallenges(challengesJson));
    const restored = initialState(content);
    restored.day = 5;
    restored.pendingChoices = [{ challengeId: "key-dev-poached", expiresDay: 8 }];
    const h = mount({ content, restored });
    h.root.querySelector<HTMLElement>('[data-choice="key-dev-poached"]')!.click();
    expect(h.root.querySelector("[data-choice]")).toBeNull();
    expect(h.root.textContent).not.toContain("days left");
  });

  it("shows a new log line as soon as one is appended to state", () => {
    const h = mount();
    expect(h.root.querySelector(".log")!.textContent).toContain("Quiet so far.");
    h.state.log.push({ day: 3, message: "a thing happened" });
    h.view.render();
    expect(h.root.querySelector(".log")!.textContent).toContain("Day 3: a thing happened");
  });
});

describe("appView click delegation on the stable root", () => {
  it("toggles pause through the delegated listener and saves on the action", () => {
    const h = mount();
    pauseButton(h.root).click();
    expect(h.engine.getState().paused).toBe(true);
    expect(h.actions).toBe(1);
    pauseButton(h.root).click();
    expect(h.engine.getState().paused).toBe(false);
    expect(h.actions).toBe(2);
  });

  it("starts the day clock when a speed is clicked while paused (issue #38)", () => {
    const h = mount();
    h.engine.pause();
    h.view.render();
    expect(pauseButton(h.root).textContent).toBe("Resume");
    expect(pauseButton(h.root).className).toContain("tc-active");
    h.root.querySelector<HTMLElement>('[data-speed="2"]')!.click();
    expect(h.engine.getState().paused).toBe(false);
    expect(h.speedChanges).toEqual([2]);
    expect(h.actions).toBe(1);
    expect(pauseButton(h.root).textContent).toBe("Pause");
  });

  it("starts a project through data-project", () => {
    const h = mount();
    h.root.querySelector<HTMLElement>('[data-project="small-crm"]')!.click();
    expect(h.engine.getState().projects.some((p) => p.defId === "small-crm")).toBe(true);
    expect(h.actions).toBe(1);
  });

  it("removes an owned decision through data-remove", () => {
    const h = mount();
    // Buy every removable decision that is affordable until one shows Remove.
    let removeBtn: HTMLElement | null = null;
    for (const buy of Array.from(h.root.querySelectorAll<HTMLElement>("[data-buy]:not([disabled])"))) {
      const live = h.root.querySelector<HTMLElement>(`[data-buy="${buy.dataset.buy}"]:not([disabled])`);
      live?.click();
      removeBtn = h.root.querySelector<HTMLElement>("[data-remove]");
      if (removeBtn) break;
    }
    expect(removeBtn).not.toBeNull();
    const owned = h.engine.getState().decisions.length;
    removeBtn!.click();
    expect(h.engine.getState().decisions.length).toBe(owned - 1);
  });

  it("reports an engine error through onError instead of throwing", () => {
    const h = mount({ richBudget: false });
    const state = h.engine.getState() as GameState;
    state.stocks.budget = 0;
    h.view.render();
    // Force a click on a decision that is now unaffordable by targeting the
    // disabled button's dataset directly through the delegated listener.
    const node = h.root.querySelector<HTMLElement>("[data-buy]")!;
    node.removeAttribute("disabled");
    node.click();
    expect(h.errors.length).toBe(1);
    expect(h.errors[0]).toMatch(/afford|requires/i);
  });

  it("routes the reset button to onReset and skips the shared save tail", () => {
    const h = mount();
    h.root.querySelector<HTMLElement>("#reset")!.click();
    expect(h.resets).toBe(1);
    expect(h.actions).toBe(0);
  });

  it("ignores clicks that are not one of ours", () => {
    const h = mount();
    const renderSpy = vi.spyOn(h.view, "render");
    h.root.querySelector<HTMLElement>(".stat-label")!.click();
    expect(h.actions).toBe(0);
    renderSpy.mockRestore();
  });

  it("stops handling clicks after dispose (so an HMR re-mount cannot double every action)", () => {
    const h = mount();
    h.view.dispose();
    pauseButton(h.root).click();
    expect(h.engine.getState().paused).toBe(false);
    expect(h.actions).toBe(0);
  });

  it("ignores a speed value outside the allowed options", () => {
    const h = mount();
    const btn = h.root.querySelector<HTMLElement>('[data-speed="2"]')!;
    btn.dataset.speed = "3";
    btn.click();
    expect(h.speedChanges).toEqual([]);
  });
});
