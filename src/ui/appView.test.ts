// @vitest-environment jsdom
//
// the driver re-renders up to 10x/second while unpaused. When a
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
import { Engine, initialState, type LoadEraContent } from "../engine/engine";
import { parseStartConfig, parseDecisions, parseChallenges, parseProjects } from "../engine/content";
import { startJson, decisionsJson, projectsJson, loadShippedContent } from "../engine/loadShippedContent";
import type { GameContent, GameState } from "../engine/types";
import type { Speed } from "./tickDriver";
import { USERS_LOOP_CAPTION } from "./usersLoop";

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

// Shipped Studio challenges are immediate-only. Choice UI/engine
// paths are pinned against this fixture so Decision-needed chrome stays covered.
function fixtureChoiceChallenges(): GameContent["challenges"] {
  return parseChallenges([
    {
      id: "fixture-choice",
      name: "Fixture choice",
      description: "Pick one.",
      probabilityPerDay: 0,
      effects: [],
      choice: {
        expiresInDays: 4,
        defaultOptionId: "pay",
        options: [
          { id: "pay", label: "Pay", effects: [] },
          { id: "skip", label: "Skip", effects: [] },
        ],
      },
    },
  ]);
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

function mount(opts: { content?: GameContent; restored?: GameState; richBudget?: boolean; loadEra?: LoadEraContent } = {}): Harness {
  const content = opts.content ?? makeContent();
  document.body.innerHTML = `<div id="app"></div>`;
  const root = document.getElementById("app")!;
  const restored = opts.restored ?? initialState(content);
  // A budget far above every cost keeps affordability (and therefore the
  // tech-tree / project-offer markup) fixed across ticks, so a node identity
  // assertion is testing the render mechanism rather than racing the economy.
  if (opts.richBudget !== false) restored.stocks.budget = 1_000_000_000;
  const engine = new Engine(content, restored, opts.loadEra);

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

describe("appView delivery-column stats layout", () => {
  it("keeps Day/Backlog/Budget/Points/Day in the top bar and places the other stocks under Delivery loop", () => {
    const h = mount();
    const top = h.root.querySelector(".stats")!;
    expect(top).toBeTruthy();
    const topLabels = Array.from(top.querySelectorAll(".stat-label")).map((el) => el.textContent);
    expect(topLabels).toEqual(["Day", "Backlog", "Budget", "Points/Day"]);

    const deliveryCol = h.root.querySelector(".delivery-column")!;
    expect(deliveryCol).toBeTruthy();
    const colHeadings = Array.from(deliveryCol.querySelectorAll("h3")).map((el) => el.textContent);
    expect(colHeadings).toEqual(["Delivery loop", "User loop"]);
    const under = deliveryCol.querySelector(".delivery-stats")!;
    expect(under).toBeTruthy();
    // Stats sit after the Delivery + User loop panels inside the same column
    // (wrapped in a data-section host for in-place flash sync).
    const panels = deliveryCol.querySelectorAll(":scope > .panel");
    expect(panels).toHaveLength(2);
    const statsHost = panels[1]!.nextElementSibling!;
    expect(statsHost.contains(under)).toBe(true);
    const underLabels = Array.from(under.querySelectorAll(".stat-label")).map((el) => el.textContent);
    expect(underLabels).toEqual(["In Progress", "Done", "Shipped", "Tech Debt", "Reputation", "Users", "Ideas"]);

    // Progress loop remains a sibling of the delivery column, not a parent of those stats.
    const loops = h.root.querySelector(".loops")!;
    expect(loops.contains(deliveryCol)).toBe(true);
    const headings = Array.from(loops.querySelectorAll("h3")).map((el) => el.textContent);
    expect(headings).toEqual(["Delivery loop", "User loop", "Progress loop"]);
    expect(headings).not.toContain("Delivery system");
    expect(headings).not.toContain("Progress system");
    expect(headings).not.toContain("Users system");
    expect(headings).not.toContain("User system");
    expect(h.root.textContent).toContain("Alter the system");
    expect(under.closest(".panel")).toBeNull();

    const usersLoop = deliveryCol.querySelector('[aria-label="User loop"]');
    expect(usersLoop).not.toBeNull();
    expect(deliveryCol.textContent).toContain(USERS_LOOP_CAPTION);
  });

  it("keeps delivery-stats nodes stable across ticks that only change values", () => {
    const h = mount();
    const before = h.root.querySelector(".delivery-stats")!;
    const beforeInProgress = before.querySelector(".v-count")!;
    for (let i = 0; i < 5; i++) {
      h.engine.tick();
      h.view.render();
    }
    // in-place sync keeps the row and value nodes identical across
    // ticks so flash animations are not torn down by string-memo patches.
    const after = h.root.querySelector(".delivery-stats")!;
    expect(after).toBe(before);
    expect(after.querySelector(".v-count")).toBe(beforeInProgress);
    expect(after.querySelector(".stat-label")!.textContent).toBe("In Progress");
    expect(h.root.querySelector(".delivery-column .delivery-stats")).toBe(after);
    expect(h.root.querySelector(".stats .stat-label")!.textContent).toBe("Day");
  });
});

describe("appView era identity stays off the player chrome", () => {
  it("never shows an era name on the title, then silently swaps into Company after the budget floor fires", () => {
    const content = loadShippedContent();
    const restored = initialState(content);
    restored.stocks.budget = content.eras!.eras.find((era) => era.id === "company")!.entryAnyOf![0].minBudget! + 20;
    const h = mount({ content, restored, loadEra: loadShippedContent, richBudget: false });
    expect(h.root.querySelector("h1.game-title")!.textContent!.trim()).toBe("Software Factory");
    expect(h.root.querySelector(".era-kicker")).toBeNull();
    expect(h.root.textContent).not.toContain("Studio");
    expect(document.title).not.toMatch(/Studio|Company/);
    expect(h.root.querySelector('[data-next-era="company"]')).toBeNull();
    h.engine.tick();
    h.view.render();
    expect(h.root.querySelector("h1.game-title")!.textContent!.trim()).toBe("Software Factory");
    expect(h.root.textContent).not.toContain("Company");
    expect(h.root.textContent).not.toContain("Entered Company");
    expect(h.root.querySelector('[data-next-era="megacorp"]')).toBeNull();
    expect(h.engine.getState().eraId).toBe("company");
  });
});

describe("appView game feel", () => {
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
    vi.advanceTimersByTime(4999);
    expect(h.root.querySelector(".gamble-reveal")).toBeTruthy();
    vi.advanceTimersByTime(2);
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

  // missing-requires cards are absent until the gate is met; buying
  // the prereq rebuilds the shop scaffold so the unlocked card gets a Buy shell.
  it("hides ci-cd until test-suite is bought, then shows it", () => {
    const h = mount();
    expect(h.root.querySelector('[data-buy="ci-cd"]')).toBeNull();
    expect(h.root.textContent).not.toContain("requires Add test suite");
    h.root.querySelector<HTMLElement>('[data-buy="test-suite"]')!.click();
    const cicd = h.root.querySelector<HTMLElement>('[data-buy="ci-cd"]');
    expect(cicd).toBeTruthy();
    expect(cicd!.hasAttribute("disabled")).toBe(false);
    expect(h.root.querySelector('[data-buy="test-suite"]')).toBeNull();
  });

  it("keeps hack day in the shop after purchase; CI/CD and harness stay hidden", () => {
    const h = mount();
    expect(h.root.querySelector('[data-buy="hack-day"]')).toBeTruthy();
    expect(h.root.querySelector('[data-buy="ci-cd"]')).toBeNull();
    expect(h.root.querySelector('[data-buy="agent-harness"]')).toBeNull();
    h.root.querySelector<HTMLElement>('[data-buy="hack-day"]')!.click();
    const hack = h.root.querySelector<HTMLElement>('[data-buy="hack-day"]');
    expect(hack).toBeTruthy();
    expect(hack!.hasAttribute("disabled")).toBe(false);
    expect(h.root.textContent).toMatch(/owned x1/);
    expect(h.root.querySelector('[data-buy="ci-cd"]')).toBeNull();
    expect(h.root.querySelector('[data-buy="agent-harness"]')).toBeNull();
  });
});

describe("appView node identity across renders", () => {
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

  // previously the whole Alter-the-loop block was one memoized
  // string, so any single node's affordability flip rebuilt every Buy button.
  // Per-node patched sections keep unrelated Buy nodes alive.
  it("keeps one decision's Buy button when another node's affordability flips", () => {
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
    const before = h.root.querySelector<HTMLElement>('[data-project="gig-bugfix"]')!;
    expect(before).toBeTruthy();
    const remainingBefore = h.root.textContent!.match(/Launch beta: [\d,.]+ points left/)![0];
    for (let i = 0; i < 10; i++) {
      h.engine.tick();
      h.view.render();
      expect(h.root.querySelector('[data-project="gig-bugfix"]')).toBe(before);
    }
    // The volatile in-flight line beside the button did update.
    const remainingAfter = h.root.textContent!.match(/Launch beta: [\d,.]+ points left/)![0];
    expect(remainingAfter).not.toBe(remainingBefore);
  });

  it("keeps the same choice option button nodes while the expiry countdown beside them ticks down", () => {
    const content = makeContent(fixtureChoiceChallenges());
    const restored = initialState(content);
    restored.day = 5;
    restored.paused = false;
    restored.pendingChoices = [{ challengeId: "fixture-choice", expiresDay: 8 }];
    const h = mount({ content, restored });
    // choice appear does not pause — countdown is live while running.
    expect(h.engine.getState().paused).toBe(false);
    const before = h.root.querySelector<HTMLElement>('[data-choice="fixture-choice"][data-option="pay"]')!;
    expect(before).toBeTruthy();
    expect(h.root.textContent).toContain("(3 days left)");

    // Advance the day directly rather than ticking, so the countdown is the
    // only thing that moves in this region.
    h.state.day = 6;
    h.view.render();

    expect(h.root.querySelector('[data-choice="fixture-choice"][data-option="pay"]')).toBe(before);
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

describe("appView page layout", () => {
  it("places Start/speed on the left of the chrome row and Reset on the right", () => {
    const h = mount();
    const order = () => {
      const kids = Array.from(h.root.children) as HTMLElement[];
      return {
        title: kids.findIndex((el) => el.matches("h1.game-title")),
        chrome: kids.findIndex((el) => el.classList.contains("chrome-row")),
        stats: kids.findIndex((el) => el.getAttribute("data-section") === "stats"),
        loops: kids.findIndex((el) => el.classList.contains("loops")),
      };
    };
    const before = order();
    expect(h.root.querySelector("h1.game-title")).toBe(h.root.children[0]);
    expect(before.title).toBe(0);
    expect(before.chrome).toBe(1);
    expect(before.stats).toBeGreaterThan(before.chrome);
    expect(before.loops).toBeGreaterThan(before.stats);

    const row = h.root.querySelector(".chrome-row")!;
    expect(row).toBeTruthy();
    expect(row.firstElementChild!.getAttribute("data-section")).toBe("time-controls");
    expect(row.lastElementChild!.id).toBe("reset");
    expect(row.contains(pauseButton(h.root))).toBe(true);
    expect(h.root.querySelector('[data-section="next-goal"]')).toBeNull();
    expect(h.root.querySelector(".next-goal")).toBeNull();
    // Scaffold is static: order holds across ticks.
    h.engine.tick();
    h.view.render();
    expect(order()).toEqual(before);
    expect(row.lastElementChild!.id).toBe("reset");
  });
});

describe("appView keeps the DOM in step with state (no stale memoized regions)", () => {
  it("shows the build stamp with version, deployed time, and repo link on mount", () => {
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
    expect(pauseButton(h.root).textContent).toBe("Start");
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
    const side = h.root.querySelector(".side")!;
    const ownedHeading = Array.from(side.querySelectorAll("h3")).find((el) => el.textContent === "Owned");
    expect(ownedHeading).toBeTruthy();
    const ownedPanel = ownedHeading!.closest(".panel")!;
    expect(ownedPanel.textContent).toContain(name);
    // Left column no longer hosts Owned between shop and Projects.
    const main = h.root.querySelector(".main")!;
    expect(Array.from(main.querySelectorAll("h3")).map((el) => el.textContent)).not.toContain("Owned");
    expect(h.actions).toBe(1);
  });

  it("places Owned under Events in the right rail", () => {
    const h = mount();
    const side = h.root.querySelector(".side")!;
    const headings = Array.from(side.querySelectorAll("h3")).map((el) => el.textContent);
    expect(headings).toEqual(["Events", "Owned"]);
    expect(side.querySelector('[data-section="owned-list"]')!.textContent).toContain(
      "Nothing yet. You are a solo dev.",
    );
    const main = h.root.querySelector(".main")!;
    const mainHeadings = Array.from(main.querySelectorAll("h3")).map((el) => el.textContent);
    expect(mainHeadings[0]).toBe("Alter the system");
    expect(mainHeadings.some((t) => t?.startsWith("Projects"))).toBe(true);
    expect(mainHeadings).not.toContain("Owned");
  });

  it("drops a resolved choice out of the DOM", () => {
    const content = makeContent(fixtureChoiceChallenges());
    const restored = initialState(content);
    restored.day = 5;
    restored.pendingChoices = [{ challengeId: "fixture-choice", expiresDay: 8 }];
    const h = mount({ content, restored });
    h.root.querySelector<HTMLElement>('[data-choice="fixture-choice"]')!.click();
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

  it("starts the day clock when a speed is clicked while paused", () => {
    const h = mount();
    h.engine.pause();
    h.view.render();
    expect(pauseButton(h.root).textContent).toBe("Start");
    expect(pauseButton(h.root).className).toContain("tc-active");
    h.root.querySelector<HTMLElement>('[data-speed="2"]')!.click();
    expect(h.engine.getState().paused).toBe(false);
    expect(h.speedChanges).toEqual([2]);
    expect(h.actions).toBe(1);
    expect(pauseButton(h.root).textContent).toBe("Pause");
  });

  it("starts a project through data-project", () => {
    const h = mount();
    h.root.querySelector<HTMLElement>('[data-project="gig-bugfix"]')!.click();
    expect(h.engine.getState().projects.some((p) => p.defId === "gig-bugfix")).toBe(true);
    expect(h.actions).toBe(1);
  });

  it("pursues a flagged offer through the existing project button", () => {
    const h = mount();
    const s = h.engine.getState() as GameState;
    s.completedProjects = 1;
    s.completedProjectIds = ["launch-beta"];
    s.stocks.ideas = 400;
    h.view.render();
    h.root.querySelector<HTMLElement>('[data-project="ship-v1"]')!.click();
    expect(h.engine.getState().plan.some((p) => p.defId === "ship-v1")).toBe(true);
    expect(h.engine.getState().stocks.ideas).toBe(0);
    expect(h.engine.getState().projects.some((p) => p.defId === "ship-v1")).toBe(false);
    expect(h.actions).toBe(1);
  });

  it("abandons an in-flight project through data-abandon after confirm", () => {
    const h = mount();
    const btn = h.root.querySelector<HTMLElement>('[data-abandon="launch-beta"]')!;
    expect(btn).toBeTruthy();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    btn.click();
    expect(confirmSpy).toHaveBeenCalledWith(
      "Abandon Launch beta? Remaining work is discarded. Already shipped pay is kept.",
    );
    expect(h.engine.getState().projects).toHaveLength(0);
    expect(h.engine.getState().completedProjects).toBe(0);
    expect(h.actions).toBe(1);
    confirmSpy.mockRestore();
  });

  it("leaves in-flight projects unchanged when abandon confirm is canceled", () => {
    const h = mount();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    h.root.querySelector<HTMLElement>('[data-abandon="launch-beta"]')!.click();
    expect(h.engine.getState().projects).toHaveLength(1);
    expect(h.actions).toBe(0);
    confirmSpy.mockRestore();
  });

  it("removes an owned decision through data-remove after confirm", () => {
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
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    removeBtn!.click();
    expect(confirmSpy).toHaveBeenCalledWith(
      "Remove this decision? One-time cost is not refunded.",
    );
    expect(h.engine.getState().decisions.length).toBe(owned - 1);
    expect(h.actions).toBeGreaterThan(0);
    confirmSpy.mockRestore();
  });

  it("leaves owned decisions unchanged when remove confirm is canceled", () => {
    const h = mount();
    let removeBtn: HTMLElement | null = null;
    for (const buy of Array.from(h.root.querySelectorAll<HTMLElement>("[data-buy]:not([disabled])"))) {
      const live = h.root.querySelector<HTMLElement>(`[data-buy="${buy.dataset.buy}"]:not([disabled])`);
      live?.click();
      removeBtn = h.root.querySelector<HTMLElement>("[data-remove]");
      if (removeBtn) break;
    }
    expect(removeBtn).not.toBeNull();
    const before = structuredClone(h.engine.getState());
    const actionsBefore = h.actions;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    removeBtn!.click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(h.engine.getState()).toEqual(before);
    expect(h.actions).toBe(actionsBefore);
    confirmSpy.mockRestore();
  });

  it("shows the insolvency banner when budget is 0 and work is still in the pipeline", () => {
    const h = mount({ richBudget: false });
    const state = h.engine.getState() as GameState;
    state.stocks.budget = 0;
    h.view.render();
    expect(h.root.querySelector(".stall")?.textContent).toMatch(/insolvent/i);
    expect(h.root.querySelector(".stall")?.textContent).toMatch(/frozen/i);
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

describe("appView Decision-needed interrupt", () => {
  it("places the choices interrupt in glanceable chrome above the loops", () => {
    const content = makeContent(fixtureChoiceChallenges());
    const restored = initialState(content);
    restored.day = 5;
    restored.pendingChoices = [{ challengeId: "fixture-choice", expiresDay: 8 }];
    const h = mount({ content, restored });
    const kids = Array.from(h.root.children) as HTMLElement[];
    const choicesIdx = kids.findIndex((el) => el.getAttribute("data-section") === "choices");
    const loopsIdx = kids.findIndex((el) => el.classList.contains("loops"));
    const side = h.root.querySelector(".side")!;
    expect(choicesIdx).toBeGreaterThan(-1);
    expect(choicesIdx).toBeLessThan(loopsIdx);
    expect(side.querySelector('[data-section="choices"]')).toBeNull();
    expect(h.root.querySelector(".choice-interrupt")).not.toBeNull();
    expect(h.root.querySelector('[data-choice="fixture-choice"]')).not.toBeNull();
  });

  // challenges must never stop gameplay — sticky UI + Events only.
  it("does not pause when a Decision-needed challenge newly appears", () => {
    const content = makeContent(fixtureChoiceChallenges());
    const h = mount({ content });
    expect(h.engine.getState().paused).toBe(false);
    h.state.pendingChoices = [{ challengeId: "fixture-choice", expiresDay: h.state.day + 3 }];
    h.view.render();
    expect(h.engine.getState().paused).toBe(false);
    expect(pauseButton(h.root).textContent).toBe("Pause");
  });

  // hide days-left while manually paused (expiresDay is frozen).
  it("hides days-left on a manually paused Decision-needed interrupt", () => {
    const content = makeContent(fixtureChoiceChallenges());
    const restored = initialState(content);
    restored.day = 5;
    restored.paused = true;
    restored.pendingChoices = [{ challengeId: "fixture-choice", expiresDay: 8 }];
    const h = mount({ content, restored });
    expect(h.engine.getState().paused).toBe(true);
    expect(h.root.querySelector(".choice-interrupt")).not.toBeNull();
    expect(h.root.textContent).not.toContain("days left");
    expect(h.root.textContent).not.toContain("days to respond");
  });

  it("shows days-left while the clock is running with a pending choice", () => {
    const content = makeContent(fixtureChoiceChallenges());
    const restored = initialState(content);
    restored.day = 5;
    restored.paused = false;
    restored.pendingChoices = [{ challengeId: "fixture-choice", expiresDay: 8 }];
    const h = mount({ content, restored });
    expect(h.engine.getState().paused).toBe(false);
    expect(h.root.textContent).toContain("days left");
  });

  it("resolves a choice from the interrupt surface and clears it", () => {
    const content = makeContent(fixtureChoiceChallenges());
    const restored = initialState(content);
    restored.day = 5;
    restored.pendingChoices = [{ challengeId: "fixture-choice", expiresDay: 8 }];
    const h = mount({ content, restored });
    h.root.querySelector<HTMLElement>('[data-choice="fixture-choice"][data-option="pay"]')!.click();
    expect(h.engine.getState().pendingChoices).toHaveLength(0);
    expect(h.root.querySelector(".choice-interrupt")).toBeNull();
    expect(h.root.querySelector("[data-choice]")).toBeNull();
  });

  it("does not change pause state when a choice option is picked", () => {
    const content = makeContent(fixtureChoiceChallenges());
    const restored = initialState(content);
    restored.day = 5;
    restored.paused = false;
    restored.pendingChoices = [{ challengeId: "fixture-choice", expiresDay: 8 }];
    const h = mount({ content, restored });
    h.root.querySelector<HTMLElement>('[data-choice="fixture-choice"][data-option="pay"]')!.click();
    expect(h.engine.getState().paused).toBe(false);
    expect(pauseButton(h.root).textContent).toBe("Pause");
  });
});

describe("appView slim shop disclosure", () => {
  it("toggles details on name tap without purchasing", () => {
    const h = mount();
    const buy = h.root.querySelector<HTMLElement>('[data-buy="test-suite"]')!;
    const node = buy.closest(".tt-node")!;
    const name = node.querySelector<HTMLElement>(".tt-node-name")!;
    const disclose = node.querySelector<HTMLElement>(".tt-node-disclose")!;
    expect(node.classList.contains("tt-open")).toBe(false);
    const ownedBefore = h.engine.getState().decisions.length;
    name.click();
    expect(h.engine.getState().decisions.length).toBe(ownedBefore);
    expect(h.actions).toBe(0);
    expect(node.classList.contains("tt-open")).toBe(true);
    expect(disclose.getAttribute("aria-expanded")).toBe("true");
    name.click();
    expect(node.classList.contains("tt-open")).toBe(false);
    expect(disclose.getAttribute("aria-expanded")).toBe("false");
    expect(h.engine.getState().decisions.length).toBe(ownedBefore);
  });

  it("still buys when Buy is clicked after the name was tapped", () => {
    const h = mount();
    const buy = h.root.querySelector<HTMLElement>('[data-buy="test-suite"]')!;
    const node = buy.closest(".tt-node")!;
    node.querySelector<HTMLElement>(".tt-node-name")!.click();
    expect(node.classList.contains("tt-open")).toBe(true);
    expect(h.engine.getState().decisions.some((d) => d.defId === "test-suite")).toBe(false);
    buy.click();
    expect(h.engine.getState().decisions.some((d) => d.defId === "test-suite")).toBe(true);
    expect(h.actions).toBe(1);
  });

  it("keeps an expanded shop row open across ticks that do not rewrite the card", () => {
    const h = mount();
    const buy = h.root.querySelector<HTMLElement>('[data-buy="test-suite"]')!;
    const node = buy.closest(".tt-node")!;
    node.querySelector<HTMLElement>(".tt-node-name")!.click();
    expect(node.classList.contains("tt-open")).toBe(true);
    for (let i = 0; i < 5; i++) {
      h.engine.tick();
      h.view.render();
    }
    expect(h.root.querySelector('[data-buy="test-suite"]')!.closest(".tt-node")).toBe(node);
    expect(node.classList.contains("tt-open")).toBe(true);
  });
});

describe("appView next-goal indicator is not shown", () => {
  it("does not render the Next line on a fresh game", () => {
    const h = mount();
    expect(h.root.querySelector('[data-section="next-goal"]')).toBeNull();
    expect(h.root.querySelector(".next-goal")).toBeNull();
    expect(h.root.textContent).not.toMatch(/\bNext\b/);
    expect(h.root.textContent).not.toContain("Trusted vendor");
  });
});
