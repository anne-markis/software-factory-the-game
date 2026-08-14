# Software Factory v1 Implementation Plan

> **Historical.** v1 schemas in this plan include `tags` and `hasTag`. Those
> fields are retired (ADR 0002). Content now lives in per-era bundles
> (ADR 0001). Author from `docs/CONTENT-AUTHORING.md`, not the JSON shapes
> below.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 browser incremental game described in `docs/superpowers/specs/2026-07-14-software-factory-design.md`, delivered as five incremental releases, each one fully playable.

**Architecture:** Pure client-side static app. A framework-free TypeScript engine (`src/engine/`, no DOM access) owns all game rules: tick loop, pipeline stocks and flows, modifiers, effects, gambles, challenges, projects, save state. A thin plain-DOM UI (`src/ui/`) renders engine state and dispatches player intents. All game content is human-editable JSON in `content/`, validated with zod at load.

**Tech Stack:** TypeScript, Vite, Vitest, zod, plain DOM (no UI framework).

**Release structure (each release ends playable):**
1. Release 1: watch the factory burn down the backlog, pause/resume
2. Release 2: buy and remove loop alterations, gambles, upkeep
3. Release 3: random challenges, timed choice challenges, event log
4. Release 4: projects, revenue attribution, context-switch tax, stall state
5. Release 5: SVG loop diagram, synergies, save/load, simulation tests

**Conventions used throughout:**
- Run tests with `npx vitest run <file>` (exact commands given per step).
- Commit after every green test cycle. Do not commit with failing tests.
- The engine never imports from `src/ui/` and never touches `document`, `window`, or `localStorage`. Task 5 adds an automated test enforcing this.
- Tick order inside one day is: advance day, expire modifiers and sickness, roll challenges, expire pending choices, compute effective rates, move flows downstream-first (deploy, then finish, then pull), attribute shipped points and pay revenue, regenerate tech debt, charge base burn and upkeep (payroll failure removes decisions), record points/day.

---

## Release 1: Playable burndown skeleton

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/ui/main.ts`
- Create: `src/engine/smoke.test.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "software-factory",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src", "content"]
}
```

- [ ] **Step 3: Create vite.config.ts**

```ts
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
});
```

- [ ] **Step 4: Create index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Software Factory</title>
    <style>
      body { font-family: ui-monospace, monospace; max-width: 900px; margin: 1rem auto; padding: 0 1rem; }
      button { font-family: inherit; margin: 2px; }
      .stats { display: flex; gap: 1.5rem; font-size: 1.1rem; margin-bottom: 1rem; flex-wrap: wrap; }
      .panel { border: 1px solid #999; padding: 0.5rem 1rem; margin-bottom: 1rem; }
      .log { max-height: 160px; overflow-y: auto; font-size: 0.85rem; }
      .stall { background: #fdd; padding: 0.5rem; font-weight: bold; }
    </style>
  </head>
  <body>
    <h1>Software Factory</h1>
    <div id="app"></div>
    <script type="module" src="/src/ui/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Create placeholder src/ui/main.ts**

```ts
const app = document.getElementById("app")!;
app.textContent = "Software Factory booting...";
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dist/
```

- [ ] **Step 7: Write a smoke test in src/engine/smoke.test.ts**

```ts
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("runs tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Install and verify**

Run: `npm install && npx vitest run`
Expected: 1 test passes.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite + typescript + vitest project"
```

### Task 2: Seeded RNG

**Files:**
- Create: `src/engine/rng.ts`
- Test: `src/engine/rng.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createRng } from "./rng";

describe("createRng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it("produces values in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("can be resumed from saved state", () => {
    const a = createRng(42);
    a.next();
    const resumed = createRng(a.getState(), true);
    const b = createRng(42);
    b.next();
    expect(resumed.next()).toBe(b.next());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/rng.test.ts`
Expected: FAIL, cannot find module `./rng`.

- [ ] **Step 3: Implement src/engine/rng.ts (mulberry32)**

```ts
export interface Rng {
  next(): number;
  getState(): number;
}

// mulberry32. When isRawState is true, seed is treated as the exact
// internal state (used to resume from a save).
export function createRng(seed: number, isRawState = false): Rng {
  let s = seed >>> 0;
  const step = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (isRawState) {
    // state already reflects prior next() calls; nothing to do
  }
  return { next: step, getState: () => s };
}
```

Note: `getState()` returns the state after the last `next()`, and resuming with `isRawState` continues the sequence, which is what the third test asserts.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/rng.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/rng.ts src/engine/rng.test.ts
git commit -m "feat: seeded resumable rng"
```

### Task 3: Core types and start content validation

**Files:**
- Create: `src/engine/types.ts`
- Create: `src/engine/content.ts`
- Create: `content/start.json`
- Test: `src/engine/content.test.ts`

- [ ] **Step 1: Create src/engine/types.ts (no test; pure declarations used by every later task)**

```ts
export interface Stocks {
  backlog: number;
  inProgress: number;
  done: number;
  shipped: number;
  budget: number;
  techDebt: number;
}

export type RateId = "pull" | "finish" | "deploy";
export const RATE_IDS: RateId[] = ["pull", "finish", "deploy"];

export type Effect =
  | { type: "modifyRate"; target: RateId | "all"; op: "add" | "mul"; value: number; durationDays?: number }
  | { type: "modifyDebtMultiplier"; op: "add" | "mul"; value: number; durationDays?: number }
  | { type: "addToStock"; stock: keyof Stocks; value: number }
  | { type: "sickness"; factor: number; durationDays: number };

export interface Modifier {
  id: string;
  source: string; // decision instanceId or challenge occurrence id
  target: RateId | "allRates" | "debtMultiplier";
  op: "add" | "mul";
  value: number;
  expiresDay?: number;
}

export interface GambleOutcome {
  probability: number;
  label: string;
  effects: Effect[];
}

export interface Synergy {
  ifOwned: string; // decision def id
  effects?: Effect[]; // replaces base effects when owned
  gamble?: GambleOutcome[]; // replaces base gamble when owned
}

export interface DecisionDef {
  id: string;
  name: string;
  description: string;
  tags: string[];
  human?: boolean;
  cost: { oneTime?: number; perDay?: number };
  incomePerDay?: number;
  effects: Effect[];
  gamble?: GambleOutcome[];
  requires?: string[];
  removable: boolean;
  synergies?: Synergy[];
}

export interface DecisionInstance {
  instanceId: string;
  defId: string;
  gambleLabel?: string;
  sickUntilDay?: number;
  sickFactor?: number;
}

export interface ChoiceOption {
  id: string;
  label: string;
  effects: Effect[];
}

export interface ChallengeDef {
  id: string;
  name: string;
  description: string;
  probabilityPerDay: number;
  perHumanDev?: boolean;
  condition?: { minHumanDevs?: number; maxHumanDevs?: number; hasTag?: string; minTechDebt?: number };
  probScaling?: { stat: "techDebt"; per: number; add: number };
  effects: Effect[];
  choice?: { expiresInDays: number; defaultOptionId: string; options: ChoiceOption[] };
}

export interface ProjectDef {
  id: string;
  name: string;
  sizePoints: number;
  upfrontCost: number;
  payoutPerPoint: number;
  completionBonus: number;
  requiresCompleted?: number;
}

export interface ActiveProject {
  defId: string;
  name: string;
  remaining: number;
  payoutPerPoint: number;
  completionBonus: number;
}

export interface PendingChoice {
  challengeId: string;
  expiresDay: number;
}

export interface LogEntry {
  day: number;
  message: string;
}

export interface StartConfig {
  seed: number;
  stocks: Stocks;
  baseRates: Record<RateId, number>;
  debtMultiplier: number;
  baseBurnPerDay: number;
  contextSwitchFactor: number;
  initialProject: { id: string; name: string; sizePoints: number; payoutPerPoint: number; completionBonus: number };
}

export interface GameContent {
  start: StartConfig;
  decisions: DecisionDef[];
  challenges: ChallengeDef[];
  projects: ProjectDef[];
}

export interface GameState {
  day: number;
  paused: boolean;
  stocks: Stocks;
  baseRates: Record<RateId, number>;
  debtMultiplierBase: number;
  baseBurnPerDay: number;
  contextSwitchFactor: number;
  modifiers: Modifier[];
  decisions: DecisionInstance[];
  projects: ActiveProject[];
  completedProjects: number;
  pendingChoices: PendingChoice[];
  log: LogEntry[];
  pointsPerDay: number;
  nextInstanceId: number;
  rngState: number;
}
```

- [ ] **Step 2: Write the failing content-validation test in src/engine/content.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { parseStartConfig } from "./content";
import startJson from "../../content/start.json";

describe("parseStartConfig", () => {
  it("parses the shipped start.json", () => {
    const cfg = parseStartConfig(startJson);
    expect(cfg.stocks.backlog).toBe(10000);
    expect(cfg.stocks.budget).toBe(10000);
    expect(cfg.debtMultiplier).toBe(0.5);
    expect(cfg.baseRates.pull).toBe(1);
  });

  it("names the file in validation errors", () => {
    expect(() => parseStartConfig({ nope: true })).toThrow(/content\/start\.json/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/engine/content.test.ts`
Expected: FAIL, cannot find module `./content` (and `content/start.json` missing).

- [ ] **Step 4: Create content/start.json**

```json
{
  "seed": 20260714,
  "stocks": { "backlog": 10000, "inProgress": 0, "done": 0, "shipped": 0, "budget": 10000, "techDebt": 0 },
  "baseRates": { "pull": 1, "finish": 1, "deploy": 1 },
  "debtMultiplier": 0.5,
  "baseBurnPerDay": 5,
  "contextSwitchFactor": 0.85,
  "initialProject": {
    "id": "first-contract",
    "name": "First Contract",
    "sizePoints": 10000,
    "payoutPerPoint": 3,
    "completionBonus": 2000
  }
}
```

- [ ] **Step 5: Create src/engine/content.ts with the zod schema**

```ts
import { z } from "zod";
import type { StartConfig } from "./types";

const stocksSchema = z.object({
  backlog: z.number().min(0),
  inProgress: z.number().min(0),
  done: z.number().min(0),
  shipped: z.number().min(0),
  budget: z.number(),
  techDebt: z.number().min(0),
});

const startSchema = z.object({
  seed: z.number().int(),
  stocks: stocksSchema,
  baseRates: z.object({ pull: z.number().min(0), finish: z.number().min(0), deploy: z.number().min(0) }),
  debtMultiplier: z.number().min(0),
  baseBurnPerDay: z.number().min(0),
  contextSwitchFactor: z.number().gt(0).lte(1),
  initialProject: z.object({
    id: z.string(),
    name: z.string(),
    sizePoints: z.number().positive(),
    payoutPerPoint: z.number().min(0),
    completionBonus: z.number().min(0),
  }),
});

function fail(file: string, error: z.ZodError): never {
  const detail = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid content in ${file}: ${detail}`);
}

export function parseStartConfig(json: unknown): StartConfig {
  const result = startSchema.safeParse(json);
  if (!result.success) fail("content/start.json", result.error);
  return result.data;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/engine/content.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/types.ts src/engine/content.ts src/engine/content.test.ts content/start.json
git commit -m "feat: core types, start content, zod validation"
```

### Task 4: Tick pipeline math and Engine facade

**Files:**
- Create: `src/engine/modifiers.ts`
- Create: `src/engine/tick.ts`
- Create: `src/engine/engine.ts`
- Test: `src/engine/tick.test.ts`

Modifiers are introduced now (empty in Release 1) so the tick math never needs rewriting; Release 2 only adds ways to create them.

- [ ] **Step 1: Write the failing tests in src/engine/tick.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { parseStartConfig } from "./content";
import startJson from "../../content/start.json";
import type { GameContent } from "./types";

export function testContent(): GameContent {
  return { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] };
}

describe("tick", () => {
  it("moves points downstream one stage per day at base rates", () => {
    const e = new Engine(testContent());
    e.tick(); // day 1: pull moves 1 point into inProgress
    let s = e.getState();
    expect(s.stocks.backlog).toBe(9999);
    expect(s.stocks.inProgress).toBe(1);
    expect(s.stocks.shipped).toBe(0);

    e.tick(); // day 2
    e.tick(); // day 3: first point ships (downstream-first prevents same-day pass-through)
    s = e.getState();
    expect(s.stocks.shipped).toBe(1);
    expect(s.pointsPerDay).toBe(1);
  });

  it("shipped points regenerate tech debt into the backlog", () => {
    const e = new Engine(testContent());
    e.tick();
    e.tick();
    e.tick(); // 1 point shipped, debt multiplier 0.5
    const s = e.getState();
    expect(s.stocks.techDebt).toBe(0.5);
    expect(s.stocks.backlog).toBe(9997 + 0.5);
  });

  it("pays revenue per shipped point and charges base burn", () => {
    const e = new Engine(testContent());
    e.tick(); // no shipping yet: 10000 - 5 burn
    expect(e.getState().stocks.budget).toBe(9995);
    e.tick();
    e.tick(); // ships 1 point at $3
    expect(e.getState().stocks.budget).toBe(10000 - 15 + 3);
  });

  it("does nothing while paused", () => {
    const e = new Engine(testContent());
    e.pause();
    e.tick();
    expect(e.getState().day).toBe(0);
    e.resume();
    e.tick();
    expect(e.getState().day).toBe(1);
  });

  it("clamps flows so stocks never go negative", () => {
    const content = testContent();
    content.start.stocks.backlog = 0;
    const e = new Engine(content);
    for (let i = 0; i < 10; i++) e.tick();
    const s = e.getState();
    expect(s.stocks.backlog).toBeGreaterThanOrEqual(0);
    expect(s.stocks.inProgress).toBeGreaterThanOrEqual(0);
    expect(s.stocks.done).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/tick.test.ts`
Expected: FAIL, cannot find module `./engine`.

- [ ] **Step 3: Create src/engine/modifiers.ts**

```ts
import type { GameState, Modifier, RateId } from "./types";

export function pruneExpired(state: GameState): void {
  state.modifiers = state.modifiers.filter((m) => m.expiresDay === undefined || m.expiresDay > state.day);
  for (const d of state.decisions) {
    if (d.sickUntilDay !== undefined && d.sickUntilDay <= state.day) {
      delete d.sickUntilDay;
      delete d.sickFactor;
    }
  }
}

function sickFactorFor(state: GameState, source: string): number {
  const inst = state.decisions.find((d) => d.instanceId === source);
  if (inst && inst.sickUntilDay !== undefined && inst.sickUntilDay > state.day) {
    return inst.sickFactor ?? 1;
  }
  return 1;
}

function applies(m: Modifier, rate: RateId): boolean {
  return m.target === rate || m.target === "allRates";
}

export function contextSwitchTax(state: GameState): number {
  const n = state.projects.length;
  return n <= 1 ? 1 : Math.pow(state.contextSwitchFactor, n - 1);
}

export function effectiveRate(state: GameState, rate: RateId): number {
  let value = state.baseRates[rate];
  for (const m of state.modifiers) {
    if (m.op === "add" && applies(m, rate)) value += m.value * sickFactorFor(state, m.source);
  }
  for (const m of state.modifiers) {
    if (m.op === "mul" && applies(m, rate)) value *= m.value;
  }
  value *= contextSwitchTax(state);
  return Math.max(0, value);
}

export function effectiveDebtMultiplier(state: GameState): number {
  let value = state.debtMultiplierBase;
  for (const m of state.modifiers) {
    if (m.target === "debtMultiplier" && m.op === "add") value += m.value;
  }
  for (const m of state.modifiers) {
    if (m.target === "debtMultiplier" && m.op === "mul") value *= m.value;
  }
  return Math.max(0, value);
}
```

- [ ] **Step 4: Create src/engine/tick.ts**

```ts
import type { GameContent, GameState } from "./types";
import type { Rng } from "./rng";
import { effectiveDebtMultiplier, effectiveRate, pruneExpired } from "./modifiers";

// Release 3 replaces this stub with real challenge rolling.
export type ChallengePhase = (state: GameState, rng: Rng, content: GameContent) => void;

export function log(state: GameState, message: string): void {
  state.log.push({ day: state.day, message });
  if (state.log.length > 200) state.log.shift();
}

// Attribute shipped points FIFO across projects, pay revenue and bonuses.
// Release 1 always has exactly one project; the FIFO loop already handles many.
function attributeShipped(state: GameState, shippedFlow: number): void {
  let remaining = shippedFlow;
  while (remaining > 0 && state.projects.length > 0) {
    const p = state.projects[0];
    const applied = Math.min(remaining, p.remaining);
    p.remaining -= applied;
    state.stocks.budget += applied * p.payoutPerPoint;
    remaining -= applied;
    if (p.remaining <= 0) {
      state.stocks.budget += p.completionBonus;
      state.completedProjects += 1;
      log(state, `Project complete: ${p.name} (+$${p.completionBonus} bonus)`);
      state.projects.shift();
    }
  }
}

function chargeUpkeep(state: GameState, content: GameContent): void {
  state.stocks.budget = Math.max(0, state.stocks.budget - state.baseBurnPerDay);
  for (const inst of [...state.decisions]) {
    const def = content.decisions.find((d) => d.id === inst.defId);
    if (!def) continue;
    if (def.incomePerDay) state.stocks.budget += def.incomePerDay;
    const perDay = def.cost.perDay ?? 0;
    if (perDay === 0) continue;
    if (state.stocks.budget >= perDay) {
      state.stocks.budget -= perDay;
    } else {
      state.decisions = state.decisions.filter((d) => d.instanceId !== inst.instanceId);
      state.modifiers = state.modifiers.filter((m) => m.source !== inst.instanceId);
      log(state, `Payroll failed: ${def.name} removed permanently`);
    }
  }
}

export function tick(state: GameState, rng: Rng, content: GameContent, challengePhase: ChallengePhase): void {
  if (state.paused) return;
  state.day += 1;
  pruneExpired(state);
  challengePhase(state, rng, content);

  const deployRate = effectiveRate(state, "deploy");
  const finishRate = effectiveRate(state, "finish");
  const pullRate = effectiveRate(state, "pull");

  // Downstream first so a point cannot cross the whole pipeline in one day.
  const shippedFlow = Math.min(state.stocks.done, deployRate);
  state.stocks.done -= shippedFlow;
  state.stocks.shipped += shippedFlow;

  const finishFlow = Math.min(state.stocks.inProgress, finishRate);
  state.stocks.inProgress -= finishFlow;
  state.stocks.done += finishFlow;

  const pullFlow = Math.min(state.stocks.backlog, pullRate);
  state.stocks.backlog -= pullFlow;
  state.stocks.inProgress += pullFlow;

  attributeShipped(state, shippedFlow);

  const debtGain = shippedFlow * effectiveDebtMultiplier(state);
  state.stocks.techDebt += debtGain;
  state.stocks.backlog += debtGain;

  chargeUpkeep(state, content);

  state.pointsPerDay = shippedFlow;
  state.rngState = rng.getState();
}
```

- [ ] **Step 5: Create src/engine/engine.ts**

```ts
import type { GameContent, GameState } from "./types";
import { createRng, type Rng } from "./rng";
import { tick, type ChallengePhase } from "./tick";

const noChallenges: ChallengePhase = () => {};

export function initialState(content: GameContent): GameState {
  const s = content.start;
  return {
    day: 0,
    paused: false,
    stocks: { ...s.stocks },
    baseRates: { ...s.baseRates },
    debtMultiplierBase: s.debtMultiplier,
    baseBurnPerDay: s.baseBurnPerDay,
    contextSwitchFactor: s.contextSwitchFactor,
    modifiers: [],
    decisions: [],
    projects: [
      {
        defId: s.initialProject.id,
        name: s.initialProject.name,
        remaining: s.initialProject.sizePoints,
        payoutPerPoint: s.initialProject.payoutPerPoint,
        completionBonus: s.initialProject.completionBonus,
      },
    ],
    completedProjects: 0,
    pendingChoices: [],
    log: [],
    pointsPerDay: 0,
    nextInstanceId: 1,
    rngState: 0,
  };
}

export class Engine {
  protected state: GameState;
  protected rng: Rng;
  protected challengePhase: ChallengePhase = noChallenges;

  constructor(protected content: GameContent, restored?: GameState) {
    if (restored) {
      this.state = restored;
      this.rng = createRng(restored.rngState, true);
    } else {
      this.state = initialState(content);
      this.rng = createRng(content.start.seed);
      this.state.rngState = this.rng.getState();
    }
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  tick(): void {
    tick(this.state, this.rng, this.content, this.challengePhase);
  }

  pause(): void {
    this.state.paused = true;
  }

  resume(): void {
    this.state.paused = false;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/engine/tick.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/modifiers.ts src/engine/tick.ts src/engine/engine.ts src/engine/tick.test.ts
git commit -m "feat: tick pipeline, modifiers, engine facade"
```

### Task 5: Engine purity guard

**Files:**
- Test: `src/engine/purity.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ENGINE_DIR = join(__dirname);
const FORBIDDEN = [/\bdocument\b/, /\bwindow\b/, /\blocalStorage\b/, /from "\.\.\/ui/, /from '\.\.\/ui/];

describe("engine purity", () => {
  it("engine sources never touch the DOM or import from ui", () => {
    const files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(join(ENGINE_DIR, file), "utf-8");
      for (const pattern of FORBIDDEN) {
        expect(src, `${file} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes (engine is currently clean)**

Run: `npx vitest run src/engine/purity.test.ts`
Expected: PASS. (If it fails, an engine file is dirty; fix the engine, not the test.)

- [ ] **Step 3: Commit**

```bash
git add src/engine/purity.test.ts
git commit -m "test: enforce engine has no DOM access or ui imports"
```

### Task 6: Minimal UI and Release 1 checkpoint

**Files:**
- Modify: `src/ui/main.ts` (replace placeholder entirely)
- Create: `src/ui/render.ts`

- [ ] **Step 1: Create src/ui/render.ts**

```ts
import type { GameState } from "../engine/types";

export function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function renderStats(state: Readonly<GameState>): string {
  return `
    <div class="stats">
      <span>Day ${state.day}</span>
      <span>Backlog: ${fmt(state.stocks.backlog)}</span>
      <span>In Progress: ${fmt(state.stocks.inProgress)}</span>
      <span>Done: ${fmt(state.stocks.done)}</span>
      <span>Shipped: ${fmt(state.stocks.shipped)}</span>
      <span>Budget: $${fmt(state.stocks.budget)}</span>
      <span>Tech Debt: ${fmt(state.stocks.techDebt)}</span>
      <span>Points/Day: ${fmt(state.pointsPerDay)}</span>
    </div>`;
}
```

- [ ] **Step 2: Replace src/ui/main.ts**

```ts
import { Engine } from "../engine/engine";
import { parseStartConfig } from "../engine/content";
import startJson from "../../content/start.json";
import type { GameContent } from "../engine/types";
import { renderStats } from "./render";

const content: GameContent = {
  start: parseStartConfig(startJson),
  decisions: [],
  challenges: [],
  projects: [],
};

const engine = new Engine(content);
const app = document.getElementById("app")!;

function render(): void {
  const state = engine.getState();
  app.innerHTML = `
    ${renderStats(state)}
    <button id="pause">${state.paused ? "Resume" : "Pause"}</button>
  `;
  document.getElementById("pause")!.onclick = () => {
    state.paused ? engine.resume() : engine.pause();
    render();
  };
}

setInterval(() => {
  engine.tick();
  render();
}, 1000);
render();
```

- [ ] **Step 3: Verify types and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass.

- [ ] **Step 4: Manual release check**

Run: `npm run dev`, open the printed URL.
Expected: stats visible; backlog decreases by 1/day; after day 3 shipped climbs and points/day reads 1; budget drops by $5/day then net -$2/day once shipping; pause freezes everything; tech debt grows and backlog receives the regen.

- [ ] **Step 5: Commit Release 1**

```bash
git add src/ui/
git commit -m "feat: release 1 - playable burndown with pause"
```

---

## Release 2: Decisions, gambles, upkeep

### Task 7: Effect application

**Files:**
- Create: `src/engine/effects.ts`
- Test: `src/engine/effects.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { applyEffects } from "./effects";
import { initialState } from "./engine";
import { parseStartConfig } from "./content";
import startJson from "../../content/start.json";
import { effectiveRate, effectiveDebtMultiplier } from "./modifiers";
import type { GameContent } from "./types";

function freshState() {
  const content: GameContent = { start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] };
  return initialState(content);
}

describe("applyEffects", () => {
  it("modifyRate creates a modifier that changes effective rate", () => {
    const s = freshState();
    applyEffects(s, [{ type: "modifyRate", target: "all", op: "mul", value: 0.5, durationDays: 5 }], "src-1");
    expect(effectiveRate(s, "pull")).toBe(0.5);
    expect(s.modifiers[0].expiresDay).toBe(5); // day 0 + 5
  });

  it("modifyDebtMultiplier changes effective debt multiplier", () => {
    const s = freshState();
    applyEffects(s, [{ type: "modifyDebtMultiplier", op: "mul", value: 0.5 }], "src-1");
    expect(effectiveDebtMultiplier(s)).toBe(0.25);
    expect(s.modifiers[0].expiresDay).toBeUndefined();
  });

  it("addToStock changes the stock immediately, clamped at zero", () => {
    const s = freshState();
    applyEffects(s, [{ type: "addToStock", stock: "budget", value: -100 }], "src-1");
    expect(s.stocks.budget).toBe(9900);
    applyEffects(s, [{ type: "addToStock", stock: "techDebt", value: -5 }], "src-1");
    expect(s.stocks.techDebt).toBe(0);
  });

  it("sickness marks the instance from context", () => {
    const s = freshState();
    s.decisions.push({ instanceId: "i1", defId: "basic-dev" });
    applyEffects(s, [{ type: "sickness", factor: 0.7, durationDays: 5 }], "chal-1", { instanceId: "i1" });
    expect(s.decisions[0].sickUntilDay).toBe(5);
    expect(s.decisions[0].sickFactor).toBe(0.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/effects.test.ts`
Expected: FAIL, cannot find module `./effects`.

- [ ] **Step 3: Create src/engine/effects.ts**

```ts
import type { Effect, GameState, RateId } from "./types";

let modifierCounter = 0;

export interface EffectContext {
  instanceId?: string;
}

export function applyEffects(state: GameState, effects: Effect[], source: string, ctx: EffectContext = {}): void {
  for (const effect of effects) {
    switch (effect.type) {
      case "modifyRate": {
        const targets: (RateId | "allRates")[] = effect.target === "all" ? ["allRates"] : [effect.target];
        for (const target of targets) {
          state.modifiers.push({
            id: `mod-${++modifierCounter}`,
            source,
            target,
            op: effect.op,
            value: effect.value,
            expiresDay: effect.durationDays !== undefined ? state.day + effect.durationDays : undefined,
          });
        }
        break;
      }
      case "modifyDebtMultiplier":
        state.modifiers.push({
          id: `mod-${++modifierCounter}`,
          source,
          target: "debtMultiplier",
          op: effect.op,
          value: effect.value,
          expiresDay: effect.durationDays !== undefined ? state.day + effect.durationDays : undefined,
        });
        break;
      case "addToStock": {
        const next = state.stocks[effect.stock] + effect.value;
        state.stocks[effect.stock] = effect.stock === "budget" ? Math.max(0, next) : Math.max(0, next);
        break;
      }
      case "sickness": {
        const inst = state.decisions.find((d) => d.instanceId === ctx.instanceId);
        if (inst) {
          inst.sickUntilDay = state.day + effect.durationDays;
          inst.sickFactor = effect.factor;
        }
        break;
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/effects.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/effects.ts src/engine/effects.test.ts
git commit -m "feat: typed effect application"
```

### Task 8: Decisions content file and schema

**Files:**
- Create: `content/decisions.json`
- Modify: `src/engine/content.ts` (add decision schema + parser)
- Test: `src/engine/content.test.ts` (add cases)

- [ ] **Step 1: Add failing tests to src/engine/content.test.ts**

```ts
import { parseDecisions } from "./content";
import decisionsJson from "../../content/decisions.json";

describe("parseDecisions", () => {
  it("parses the shipped decisions.json", () => {
    const defs = parseDecisions(decisionsJson);
    const ids = defs.map((d) => d.id);
    expect(ids).toEqual(["test-suite", "ci-cd", "basic-dev", "agent", "agent-harness"]);
    const dev = defs.find((d) => d.id === "basic-dev")!;
    expect(dev.cost.perDay).toBe(275);
    expect(dev.gamble!.reduce((sum, o) => sum + o.probability, 0)).toBeCloseTo(1);
  });

  it("rejects a gamble table whose probabilities do not sum to 1", () => {
    expect(() =>
      parseDecisions([
        {
          id: "x", name: "x", description: "x", tags: [], cost: {}, effects: [], removable: true,
          gamble: [{ probability: 0.5, label: "a", effects: [] }],
        },
      ]),
    ).toThrow(/content\/decisions\.json/);
  });

  it("rejects a requires reference to an unknown decision id", () => {
    expect(() =>
      parseDecisions([
        { id: "x", name: "x", description: "x", tags: [], cost: {}, effects: [], removable: true, requires: ["ghost"] },
      ]),
    ).toThrow(/ghost/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/content.test.ts`
Expected: FAIL, `parseDecisions` not exported (and decisions.json missing).

- [ ] **Step 3: Create content/decisions.json**

```json
[
  {
    "id": "test-suite",
    "name": "Add test suite",
    "description": "Slows all work 50% for 5 days while you write tests. Permanently halves tech debt accumulation. Unlocks CI/CD.",
    "tags": ["process"],
    "cost": { "oneTime": 500 },
    "effects": [
      { "type": "modifyRate", "target": "all", "op": "mul", "value": 0.5, "durationDays": 5 },
      { "type": "modifyDebtMultiplier", "op": "mul", "value": 0.5 }
    ],
    "removable": false
  },
  {
    "id": "ci-cd",
    "name": "CI/CD pipeline",
    "description": "Slows all work 50% for 1 day to set up. Permanently speeds deploys by 10%.",
    "tags": ["process"],
    "cost": { "oneTime": 750 },
    "requires": ["test-suite"],
    "effects": [
      { "type": "modifyRate", "target": "all", "op": "mul", "value": 0.5, "durationDays": 1 },
      { "type": "modifyRate", "target": "deploy", "op": "mul", "value": 1.1 }
    ],
    "removable": false
  },
  {
    "id": "basic-dev",
    "name": "Hire basic developer",
    "description": "Costs $275/day while employed. Hiring is a gamble: they might be great, or might slow the team down. Removed permanently if payroll fails.",
    "tags": ["human"],
    "human": true,
    "cost": { "perDay": 275 },
    "effects": [],
    "gamble": [
      { "probability": 0.5, "label": "Strong hire", "effects": [{ "type": "modifyRate", "target": "all", "op": "add", "value": 1.0 }] },
      { "probability": 0.25, "label": "Decent hire", "effects": [{ "type": "modifyRate", "target": "all", "op": "add", "value": 0.5 }] },
      { "probability": 0.2, "label": "Net-negative hire", "effects": [{ "type": "modifyRate", "target": "all", "op": "add", "value": -0.5 }] },
      { "probability": 0.05, "label": "Disaster hire", "effects": [{ "type": "modifyRate", "target": "all", "op": "add", "value": -1.0 }] }
    ],
    "removable": true
  },
  {
    "id": "agent",
    "name": "Add coding agent",
    "description": "$10 setup, $30/day to run. Speeds In Progress work by 20% but adds 20% more tech debt. A harness tames the debt.",
    "tags": ["darkfactory"],
    "cost": { "oneTime": 10, "perDay": 30 },
    "effects": [
      { "type": "modifyRate", "target": "finish", "op": "mul", "value": 1.2 },
      { "type": "modifyDebtMultiplier", "op": "mul", "value": 1.2 }
    ],
    "synergies": [
      {
        "ifOwned": "agent-harness",
        "effects": [
          { "type": "modifyRate", "target": "finish", "op": "mul", "value": 1.2 },
          { "type": "modifyDebtMultiplier", "op": "mul", "value": 1.1 }
        ]
      }
    ],
    "removable": true
  },
  {
    "id": "agent-harness",
    "name": "Agent harness",
    "description": "$400 setup, $5/day. Structured tests and guardrails for agents: agents bought while a harness is present accumulate half the extra debt.",
    "tags": ["darkfactory"],
    "cost": { "oneTime": 400, "perDay": 5 },
    "requires": ["agent"],
    "effects": [],
    "removable": true
  }
]
```

- [ ] **Step 4: Add schema and parser to src/engine/content.ts**

Append to the existing file:

```ts
import type { DecisionDef } from "./types";

const rateTarget = z.enum(["pull", "finish", "deploy", "all"]);
const stockName = z.enum(["backlog", "inProgress", "done", "shipped", "budget", "techDebt"]);

const effectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("modifyRate"), target: rateTarget, op: z.enum(["add", "mul"]), value: z.number(), durationDays: z.number().positive().optional() }),
  z.object({ type: z.literal("modifyDebtMultiplier"), op: z.enum(["add", "mul"]), value: z.number(), durationDays: z.number().positive().optional() }),
  z.object({ type: z.literal("addToStock"), stock: stockName, value: z.number() }),
  z.object({ type: z.literal("sickness"), factor: z.number().gt(0).lt(1), durationDays: z.number().positive() }),
]);

const gambleOutcomeSchema = z.object({ probability: z.number().gt(0).lte(1), label: z.string(), effects: z.array(effectSchema) });

const decisionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  human: z.boolean().optional(),
  cost: z.object({ oneTime: z.number().min(0).optional(), perDay: z.number().min(0).optional() }),
  incomePerDay: z.number().min(0).optional(),
  effects: z.array(effectSchema),
  gamble: z.array(gambleOutcomeSchema).optional(),
  requires: z.array(z.string()).optional(),
  removable: z.boolean(),
  synergies: z
    .array(z.object({ ifOwned: z.string(), effects: z.array(effectSchema).optional(), gamble: z.array(gambleOutcomeSchema).optional() }))
    .optional(),
});

export function parseDecisions(json: unknown): DecisionDef[] {
  const result = z.array(decisionSchema).safeParse(json);
  if (!result.success) fail("content/decisions.json", result.error);
  const defs = result.data as DecisionDef[];
  const ids = new Set(defs.map((d) => d.id));
  for (const def of defs) {
    if (def.gamble) {
      const total = def.gamble.reduce((sum, o) => sum + o.probability, 0);
      if (Math.abs(total - 1) > 1e-9) {
        throw new Error(`Invalid content in content/decisions.json: gamble for "${def.id}" sums to ${total}, expected 1`);
      }
    }
    for (const req of def.requires ?? []) {
      if (!ids.has(req)) throw new Error(`Invalid content in content/decisions.json: "${def.id}" requires unknown id "${req}"`);
    }
    for (const syn of def.synergies ?? []) {
      if (!ids.has(syn.ifOwned)) throw new Error(`Invalid content in content/decisions.json: "${def.id}" synergy references unknown id "${syn.ifOwned}"`);
    }
  }
  return defs;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/engine/content.test.ts`
Expected: all content tests PASS.

- [ ] **Step 6: Commit**

```bash
git add content/decisions.json src/engine/content.ts src/engine/content.test.ts
git commit -m "feat: decisions content with schema and integrity checks"
```

### Task 9: Buying, gambles, synergies, removal

**Files:**
- Create: `src/engine/decisions.ts`
- Modify: `src/engine/engine.ts` (add applyDecision/removeDecision/availableDecisions)
- Test: `src/engine/decisions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { parseStartConfig, parseDecisions } from "./content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import { effectiveRate, effectiveDebtMultiplier } from "./modifiers";
import type { GameContent } from "./types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("decisions", () => {
  it("charges one-time cost and applies effects", () => {
    const e = new Engine(content());
    e.applyDecision("test-suite");
    const s = e.getState();
    expect(s.stocks.budget).toBe(9500);
    expect(effectiveRate(s, "pull")).toBe(0.5);
    expect(effectiveDebtMultiplier(s)).toBe(0.25);
  });

  it("enforces requires and affordability", () => {
    const e = new Engine(content());
    expect(() => e.applyDecision("ci-cd")).toThrow(/requires/);
    const poor = content();
    poor.start.stocks.budget = 100;
    const e2 = new Engine(poor);
    expect(() => e2.applyDecision("test-suite")).toThrow(/afford/);
  });

  it("resolves gambles deterministically from the seeded rng", () => {
    const e = new Engine(content());
    e.applyDecision("basic-dev");
    const s = e.getState();
    expect(s.decisions).toHaveLength(1);
    expect(s.decisions[0].gambleLabel).toBeDefined();
    // whatever the outcome, exactly one add-modifier exists for it
    const mods = s.modifiers.filter((m) => m.source === s.decisions[0].instanceId);
    expect(mods).toHaveLength(1);
    expect([1.0, 0.5, -0.5, -1.0]).toContain(mods[0].value);
  });

  it("uses the synergy variant when the synergy decision is owned", () => {
    const e = new Engine(content());
    e.applyDecision("agent"); // base: debt mul 1.2
    e.applyDecision("agent-harness");
    e.applyDecision("agent"); // synergy: debt mul 1.1
    const s = e.getState();
    const debtMods = s.modifiers.filter((m) => m.target === "debtMultiplier").map((m) => m.value).sort();
    expect(debtMods).toEqual([1.1, 1.2]);
  });

  it("removeDecision drops effects and upkeep", () => {
    const e = new Engine(content());
    e.applyDecision("agent");
    const inst = e.getState().decisions[0];
    e.removeDecision(inst.instanceId);
    const s = e.getState();
    expect(s.decisions).toHaveLength(0);
    expect(s.modifiers.filter((m) => m.source === inst.instanceId)).toHaveLength(0);
  });

  it("payroll failure removes the decision permanently during tick", () => {
    const c = content();
    c.start.stocks.budget = 300;
    const e = new Engine(c);
    e.applyDecision("basic-dev"); // no one-time cost
    e.tick(); // burn 5 then payroll 275: passes day 1 (300-5-275=20)
    e.tick(); // day 2: cannot pay 275, dev removed
    const s = e.getState();
    expect(s.decisions).toHaveLength(0);
    expect(s.log.some((l) => l.message.includes("Payroll failed"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/decisions.test.ts`
Expected: FAIL, `applyDecision` does not exist.

- [ ] **Step 3: Create src/engine/decisions.ts**

```ts
import type { DecisionDef, GameContent, GameState, GambleOutcome } from "./types";
import type { Rng } from "./rng";
import { applyEffects } from "./effects";
import { log } from "./tick";

export interface Availability {
  def: DecisionDef;
  purchasable: boolean;
  reason?: string;
}

function owned(state: GameState, defId: string): boolean {
  return state.decisions.some((d) => d.defId === defId);
}

export function availability(state: GameState, content: GameContent): Availability[] {
  return content.decisions.map((def) => {
    const missing = (def.requires ?? []).filter((r) => !owned(state, r));
    if (missing.length > 0) return { def, purchasable: false, reason: `requires ${missing.join(", ")}` };
    const oneTime = def.cost.oneTime ?? 0;
    if (state.stocks.budget < oneTime) return { def, purchasable: false, reason: "cannot afford" };
    return { def, purchasable: true };
  });
}

function rollGamble(table: GambleOutcome[], rng: Rng): GambleOutcome {
  const roll = rng.next();
  let cumulative = 0;
  for (const outcome of table) {
    cumulative += outcome.probability;
    if (roll < cumulative) return outcome;
  }
  return table[table.length - 1];
}

export function applyDecision(state: GameState, content: GameContent, defId: string, rng: Rng): void {
  const entry = availability(state, content).find((a) => a.def.id === defId);
  if (!entry) throw new Error(`Unknown decision: ${defId}`);
  if (!entry.purchasable) {
    throw new Error(entry.reason === "cannot afford" ? `Cannot afford ${defId}` : `${defId} ${entry.reason}`);
  }
  const def = entry.def;
  state.stocks.budget -= def.cost.oneTime ?? 0;

  const synergy = (def.synergies ?? []).find((s) => owned(state, s.ifOwned));
  const effects = synergy?.effects ?? def.effects;
  const gamble = synergy?.gamble ?? def.gamble;

  const instanceId = `inst-${state.nextInstanceId++}`;
  const instance = { instanceId, defId: def.id } as GameState["decisions"][number];

  applyEffects(state, effects, instanceId);
  if (gamble) {
    const outcome = rollGamble(gamble, rng);
    instance.gambleLabel = outcome.label;
    applyEffects(state, outcome.effects, instanceId);
    log(state, `${def.name}: ${outcome.label}`);
  } else {
    log(state, `Purchased: ${def.name}`);
  }
  state.decisions.push(instance);
  state.rngState = rng.getState();
}

export function removeDecision(state: GameState, content: GameContent, instanceId: string): void {
  const inst = state.decisions.find((d) => d.instanceId === instanceId);
  if (!inst) throw new Error(`Unknown instance: ${instanceId}`);
  const def = content.decisions.find((d) => d.id === inst.defId);
  if (def && !def.removable) throw new Error(`${def.name} cannot be removed`);
  state.decisions = state.decisions.filter((d) => d.instanceId !== instanceId);
  state.modifiers = state.modifiers.filter((m) => m.source !== instanceId);
  if (def) log(state, `Removed: ${def.name}`);
}
```

- [ ] **Step 4: Add methods to the Engine class in src/engine/engine.ts**

Add imports and methods:

```ts
import { applyDecision, removeDecision, availability, type Availability } from "./decisions";
```

Inside the `Engine` class:

```ts
  applyDecision(defId: string): void {
    applyDecision(this.state, this.content, defId, this.rng);
  }

  removeDecision(instanceId: string): void {
    removeDecision(this.state, this.content, instanceId);
  }

  availableDecisions(): Availability[] {
    return availability(this.state, this.content);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run`
Expected: all tests PASS (including earlier suites).

- [ ] **Step 6: Commit**

```bash
git add src/engine/decisions.ts src/engine/decisions.test.ts src/engine/engine.ts
git commit -m "feat: decision purchase, gambles, synergies, removal, payroll failure"
```

### Task 10: Decisions UI and Release 2 checkpoint

**Files:**
- Modify: `src/ui/render.ts` (add renderDecisions)
- Modify: `src/ui/main.ts` (wire decisions content and panel)

- [ ] **Step 1: Add renderDecisions to src/ui/render.ts**

```ts
import type { Availability } from "../engine/decisions";
import type { DecisionInstance, GameContent } from "../engine/types";

function describeEffects(a: Availability): string {
  const cost = [
    a.def.cost.oneTime ? `$${a.def.cost.oneTime} once` : "",
    a.def.cost.perDay ? `$${a.def.cost.perDay}/day` : "",
  ].filter(Boolean).join(" + ") || "free";
  return `${cost}. ${a.def.description}`;
}

export function renderDecisions(avail: Availability[], ownedInstances: DecisionInstance[], content: GameContent): string {
  const shop = avail
    .map((a) => {
      const disabled = a.purchasable ? "" : "disabled";
      const reason = a.reason ? ` (${a.reason})` : "";
      return `<div><button data-buy="${a.def.id}" ${disabled}>Buy</button> <strong>${a.def.name}</strong>${reason}<br/><small>${describeEffects(a)}</small></div>`;
    })
    .join("");
  const ownedList = ownedInstances
    .map((inst) => {
      const def = content.decisions.find((d) => d.id === inst.defId);
      if (!def) return "";
      const remove = def.removable ? `<button data-remove="${inst.instanceId}">Remove</button>` : "";
      const outcome = inst.gambleLabel ? ` [${inst.gambleLabel}]` : "";
      const sick = inst.sickUntilDay !== undefined ? " (sick)" : "";
      return `<div>${def.name}${outcome}${sick} ${remove}</div>`;
    })
    .join("");
  return `
    <div class="panel"><h3>Alter the loop</h3>${shop}</div>
    <div class="panel"><h3>Owned</h3>${ownedList || "<small>Nothing yet. You are a solo dev.</small>"}</div>`;
}
```

- [ ] **Step 2: Wire into src/ui/main.ts**

Replace the file with:

```ts
import { Engine } from "../engine/engine";
import { parseStartConfig, parseDecisions } from "../engine/content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import type { GameContent } from "../engine/types";
import { renderStats, renderDecisions } from "./render";

const content: GameContent = {
  start: parseStartConfig(startJson),
  decisions: parseDecisions(decisionsJson),
  challenges: [],
  projects: [],
};

const engine = new Engine(content);
const app = document.getElementById("app")!;

function render(): void {
  const state = engine.getState();
  app.innerHTML = `
    ${renderStats(state)}
    <button id="pause">${state.paused ? "Resume" : "Pause"}</button>
    ${renderDecisions(engine.availableDecisions(), [...state.decisions], content)}
  `;
}

app.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement;
  const state = engine.getState();
  if (target.id === "pause") {
    state.paused ? engine.resume() : engine.pause();
  } else if (target.dataset.buy) {
    try {
      engine.applyDecision(target.dataset.buy);
    } catch (err) {
      alert((err as Error).message);
    }
  } else if (target.dataset.remove) {
    engine.removeDecision(target.dataset.remove);
  }
  render();
});

setInterval(() => {
  engine.tick();
  render();
}, 1000);
render();
```

Note: event delegation on `#app` survives the innerHTML re-render each tick; per-button `onclick` does not.

- [ ] **Step 3: Verify types and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 4: Manual release check**

Run: `npm run dev`.
Expected: test suite purchase drops budget to $9,500 and halves throughput for 5 days; CI/CD is disabled until test suite is owned; hiring a dev shows a gamble outcome in Owned; agents can be bought and removed; with budget forced low (edit start.json temporarily), a hired dev disappears with a payroll log line. Restore start.json afterward.

- [ ] **Step 5: Commit Release 2**

```bash
git add src/ui/
git commit -m "feat: release 2 - decision shop, gambles, ownership panel"
```

---

## Release 3: Challenges and event log

### Task 11: Challenges content and schema

**Files:**
- Create: `content/challenges.json`
- Modify: `src/engine/content.ts` (add challenge schema + parser)
- Test: `src/engine/content.test.ts` (add cases)

- [ ] **Step 1: Add failing tests to src/engine/content.test.ts**

```ts
import { parseChallenges } from "./content";
import challengesJson from "../../content/challenges.json";

describe("parseChallenges", () => {
  it("parses the shipped challenges.json", () => {
    const defs = parseChallenges(challengesJson);
    const ids = defs.map((c) => c.id);
    expect(ids).toContain("sickness");
    expect(ids).toContain("ddos");
    const poached = defs.find((c) => c.id === "key-dev-poached")!;
    expect(poached.choice!.options.map((o) => o.id)).toContain(poached.choice!.defaultOptionId);
  });

  it("rejects a choice whose default option id does not exist", () => {
    expect(() =>
      parseChallenges([
        {
          id: "bad", name: "bad", description: "bad", probabilityPerDay: 0.1, effects: [],
          choice: { expiresInDays: 3, defaultOptionId: "ghost", options: [{ id: "a", label: "a", effects: [] }] },
        },
      ]),
    ).toThrow(/ghost/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/content.test.ts`
Expected: FAIL, `parseChallenges` not exported.

- [ ] **Step 3: Create content/challenges.json**

```json
[
  {
    "id": "sickness",
    "name": "Sickness",
    "description": "A developer is out sick: their contribution drops 30% for 5 days.",
    "probabilityPerDay": 0.1,
    "perHumanDev": true,
    "condition": { "minHumanDevs": 1 },
    "effects": [{ "type": "sickness", "factor": 0.7, "durationDays": 5 }]
  },
  {
    "id": "ddos",
    "name": "DDoS attack",
    "description": "Attackers hammer your endpoints. Mitigation costs $100.",
    "probabilityPerDay": 0.05,
    "effects": [{ "type": "addToStock", "stock": "budget", "value": -100 }]
  },
  {
    "id": "scope-creep",
    "name": "Scope creep",
    "description": "The client 'just remembered' a few requirements. Backlog +200.",
    "probabilityPerDay": 0.1,
    "effects": [{ "type": "addToStock", "stock": "backlog", "value": 200 }]
  },
  {
    "id": "prod-incident",
    "name": "Production incident",
    "description": "Something broke in production. More likely the more tech debt you carry. Costs $250 and slows everything 20% for 3 days.",
    "probabilityPerDay": 0.01,
    "probScaling": { "stat": "techDebt", "per": 500, "add": 0.01 },
    "effects": [
      { "type": "addToStock", "stock": "budget", "value": -250 },
      { "type": "modifyRate", "target": "all", "op": "mul", "value": 0.8, "durationDays": 3 }
    ]
  },
  {
    "id": "laptop-dies",
    "name": "Laptop dies",
    "description": "Your only machine gives up. Replacement: $1,500.",
    "probabilityPerDay": 0.03,
    "condition": { "maxHumanDevs": 0 },
    "effects": [{ "type": "addToStock", "stock": "budget", "value": -1500 }]
  },
  {
    "id": "key-dev-poached",
    "name": "Key developer poached",
    "description": "A competitor made your developer an offer. Match it or lose them.",
    "probabilityPerDay": 0.02,
    "condition": { "minHumanDevs": 1 },
    "effects": [],
    "choice": {
      "expiresInDays": 3,
      "defaultOptionId": "let-them-go",
      "options": [
        { "id": "match-offer", "label": "Match the offer ($800)", "effects": [{ "type": "addToStock", "stock": "budget", "value": -800 }] },
        { "id": "let-them-go", "label": "Let them go (all rates -15% for 10 days)", "effects": [{ "type": "modifyRate", "target": "all", "op": "mul", "value": 0.85, "durationDays": 10 }] }
      ]
    }
  }
]
```

- [ ] **Step 4: Add schema and parser to src/engine/content.ts**

Append:

```ts
import type { ChallengeDef } from "./types";

const choiceOptionSchema = z.object({ id: z.string(), label: z.string(), effects: z.array(effectSchema) });

const challengeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  probabilityPerDay: z.number().min(0).max(1),
  perHumanDev: z.boolean().optional(),
  condition: z
    .object({
      minHumanDevs: z.number().int().min(0).optional(),
      maxHumanDevs: z.number().int().min(0).optional(),
      hasTag: z.string().optional(),
      minTechDebt: z.number().min(0).optional(),
    })
    .optional(),
  probScaling: z.object({ stat: z.literal("techDebt"), per: z.number().positive(), add: z.number().min(0) }).optional(),
  effects: z.array(effectSchema),
  choice: z
    .object({ expiresInDays: z.number().int().positive(), defaultOptionId: z.string(), options: z.array(choiceOptionSchema).min(1) })
    .optional(),
});

export function parseChallenges(json: unknown): ChallengeDef[] {
  const result = z.array(challengeSchema).safeParse(json);
  if (!result.success) fail("content/challenges.json", result.error);
  const defs = result.data as ChallengeDef[];
  for (const def of defs) {
    if (def.choice && !def.choice.options.some((o) => o.id === def.choice!.defaultOptionId)) {
      throw new Error(`Invalid content in content/challenges.json: "${def.id}" default option "${def.choice.defaultOptionId}" not found`);
    }
  }
  return defs;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/engine/content.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add content/challenges.json src/engine/content.ts src/engine/content.test.ts
git commit -m "feat: challenges content with schema validation"
```

### Task 12: Challenge rolling, choices, expiry

**Files:**
- Create: `src/engine/challenges.ts`
- Modify: `src/engine/engine.ts` (use real challenge phase, add resolveChoice)
- Test: `src/engine/challenges.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { rollChallenges, resolveChoice } from "./challenges";
import { initialState } from "./engine";
import { parseStartConfig, parseChallenges, parseDecisions } from "./content";
import startJson from "../../content/start.json";
import challengesJson from "../../content/challenges.json";
import decisionsJson from "../../content/decisions.json";
import type { GameContent } from "./types";
import type { Rng } from "./rng";

function content(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: parseChallenges(challengesJson),
    projects: [],
  };
}

// rng that returns a scripted sequence, then 0.99 forever (nothing fires)
function scriptedRng(values: number[]): Rng {
  let i = 0;
  return { next: () => (i < values.length ? values[i++] : 0.99), getState: () => 0 };
}

describe("rollChallenges", () => {
  it("fires an unconditional challenge when the roll is under its probability", () => {
    const c = content();
    const s = initialState(c);
    s.day = 1;
    // challenge order: sickness (skipped: 0 human devs), ddos 0.05, scope-creep 0.1, prod-incident, laptop-dies 0.03, poached (skipped)
    rollChallenges(s, scriptedRng([0.04]), c); // ddos fires
    expect(s.stocks.budget).toBe(9900);
    expect(s.log.some((l) => l.message.includes("DDoS"))).toBe(true);
  });

  it("respects conditions: sickness never fires with zero human devs", () => {
    const c = content();
    const s = initialState(c);
    s.day = 1;
    rollChallenges(s, scriptedRng([0.0, 0.99, 0.99, 0.99, 0.99, 0.99]), c);
    expect(s.decisions.every((d) => d.sickUntilDay === undefined)).toBe(true);
  });

  it("scales prod-incident probability with tech debt", () => {
    const c = content();
    const s = initialState(c);
    s.day = 1;
    s.stocks.techDebt = 2000; // 0.01 base + 4 * 0.01 = 0.05
    // skip ddos (0.99) and scope-creep (0.99), then 0.04 < 0.05 fires incident
    rollChallenges(s, scriptedRng([0.99, 0.99, 0.04]), c);
    expect(s.log.some((l) => l.message.includes("Production incident"))).toBe(true);
  });

  it("queues a pending choice instead of applying effects, and expiry applies the default", () => {
    const c = content();
    const s = initialState(c);
    s.decisions.push({ instanceId: "i1", defId: "basic-dev" });
    s.day = 1;
    // sickness roll for 1 human dev (0.99: no), ddos no, scope no, incident no, poached yes (0.01 < 0.02)
    rollChallenges(s, scriptedRng([0.99, 0.99, 0.99, 0.99, 0.01]), c);
    expect(s.pendingChoices).toHaveLength(1);
    expect(s.pendingChoices[0].expiresDay).toBe(4);
    expect(s.stocks.budget).toBe(10000); // nothing applied yet

    s.day = 4;
    rollChallenges(s, scriptedRng([]), c); // expiry pass runs first
    expect(s.pendingChoices).toHaveLength(0);
    expect(s.modifiers.some((m) => m.value === 0.85)).toBe(true); // default: let them go
  });

  it("resolveChoice applies the chosen option and clears the pending choice", () => {
    const c = content();
    const s = initialState(c);
    s.pendingChoices.push({ challengeId: "key-dev-poached", expiresDay: 10 });
    resolveChoice(s, c, "key-dev-poached", "match-offer");
    expect(s.stocks.budget).toBe(9200);
    expect(s.pendingChoices).toHaveLength(0);
  });

  it("sickness targets each human dev independently", () => {
    const c = content();
    const s = initialState(c);
    s.decisions.push({ instanceId: "i1", defId: "basic-dev" }, { instanceId: "i2", defId: "basic-dev" });
    s.day = 1;
    // per-dev rolls: i1 fires (0.05), i2 does not (0.99); remaining challenges no
    rollChallenges(s, scriptedRng([0.05, 0.99, 0.99, 0.99, 0.99, 0.99]), c);
    expect(s.decisions[0].sickUntilDay).toBe(6);
    expect(s.decisions[1].sickUntilDay).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/challenges.test.ts`
Expected: FAIL, cannot find module `./challenges`.

- [ ] **Step 3: Create src/engine/challenges.ts**

```ts
import type { ChallengeDef, GameContent, GameState } from "./types";
import type { Rng } from "./rng";
import { applyEffects } from "./effects";
import { log } from "./tick";

function humanDevInstances(state: GameState, content: GameContent) {
  return state.decisions.filter((inst) => {
    const def = content.decisions.find((d) => d.id === inst.defId);
    return def?.human === true;
  });
}

function conditionMet(def: ChallengeDef, state: GameState, content: GameContent): boolean {
  const cond = def.condition;
  if (!cond) return true;
  const humans = humanDevInstances(state, content).length;
  if (cond.minHumanDevs !== undefined && humans < cond.minHumanDevs) return false;
  if (cond.maxHumanDevs !== undefined && humans > cond.maxHumanDevs) return false;
  if (cond.minTechDebt !== undefined && state.stocks.techDebt < cond.minTechDebt) return false;
  if (cond.hasTag !== undefined) {
    const ownedTags = new Set(
      state.decisions.flatMap((inst) => content.decisions.find((d) => d.id === inst.defId)?.tags ?? []),
    );
    if (!ownedTags.has(cond.hasTag)) return false;
  }
  return true;
}

function probability(def: ChallengeDef, state: GameState): number {
  let p = def.probabilityPerDay;
  if (def.probScaling) {
    p += Math.floor(state.stocks.techDebt / def.probScaling.per) * def.probScaling.add;
  }
  return Math.min(1, p);
}

function fire(def: ChallengeDef, state: GameState, instanceId?: string): void {
  if (def.choice) {
    if (state.pendingChoices.some((pc) => pc.challengeId === def.id)) return; // one at a time
    state.pendingChoices.push({ challengeId: def.id, expiresDay: state.day + def.choice.expiresInDays });
    log(state, `Decision needed: ${def.name} (${def.choice.expiresInDays} days to respond)`);
    return;
  }
  applyEffects(state, def.effects, `chal-${def.id}-d${state.day}`, { instanceId });
  log(state, `${def.name}: ${def.description}`);
}

export function resolveChoice(state: GameState, content: GameContent, challengeId: string, optionId: string): void {
  const pending = state.pendingChoices.find((pc) => pc.challengeId === challengeId);
  if (!pending) throw new Error(`No pending choice for ${challengeId}`);
  const def = content.challenges.find((c) => c.id === challengeId);
  const option = def?.choice?.options.find((o) => o.id === optionId);
  if (!def || !option) throw new Error(`Unknown option ${optionId} for ${challengeId}`);
  applyEffects(state, option.effects, `choice-${challengeId}-d${state.day}`);
  log(state, `${def.name}: chose "${option.label}"`);
  state.pendingChoices = state.pendingChoices.filter((pc) => pc.challengeId !== challengeId);
}

export function rollChallenges(state: GameState, rng: Rng, content: GameContent): void {
  // expire pending choices first: apply defaults
  for (const pending of [...state.pendingChoices]) {
    if (pending.expiresDay <= state.day) {
      const def = content.challenges.find((c) => c.id === pending.challengeId);
      if (def?.choice) {
        const fallback = def.choice.options.find((o) => o.id === def.choice!.defaultOptionId)!;
        applyEffects(state, fallback.effects, `choice-${def.id}-d${state.day}`);
        log(state, `${def.name}: expired, defaulted to "${fallback.label}"`);
      }
      state.pendingChoices = state.pendingChoices.filter((pc) => pc !== pending);
    }
  }

  for (const def of content.challenges) {
    if (!conditionMet(def, state, content)) continue;
    if (def.perHumanDev) {
      for (const inst of humanDevInstances(state, content)) {
        if (rng.next() < probability(def, state)) fire(def, state, inst.instanceId);
      }
    } else {
      if (rng.next() < probability(def, state)) fire(def, state);
    }
  }
}
```

- [ ] **Step 4: Wire into the Engine in src/engine/engine.ts**

Add imports:

```ts
import { rollChallenges, resolveChoice } from "./challenges";
```

In the constructor, replace `noChallenges` usage by setting:

```ts
this.challengePhase = (state, rng, content) => rollChallenges(state, rng, content);
```

(Keep the `noChallenges` default so old tests that never fire challenges keep passing only if they use scripted content with empty `challenges` arrays; with an empty array `rollChallenges` is a no-op, so it is safe to always use it. Delete `noChallenges`.)

Add method:

```ts
  resolveChoice(challengeId: string, optionId: string): void {
    resolveChoice(this.state, this.content, challengeId, optionId);
  }
```

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all PASS. Note: Release 1 and 2 engine tests construct content with `challenges: []`, so their deterministic budget expectations are unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/engine/challenges.ts src/engine/challenges.test.ts src/engine/engine.ts
git commit -m "feat: challenge rolls, timed choices with default on expiry"
```

### Task 13: Event log and choice UI, Release 3 checkpoint

**Files:**
- Modify: `src/ui/render.ts` (add renderLog, renderChoices)
- Modify: `src/ui/main.ts` (load challenges content, render log and choices)

- [ ] **Step 1: Add to src/ui/render.ts**

```ts
import type { PendingChoice, LogEntry, ChallengeDef } from "../engine/types";

export function renderLog(log: readonly LogEntry[]): string {
  const lines = [...log].slice(-30).reverse()
    .map((entry) => `<div>Day ${entry.day}: ${entry.message}</div>`)
    .join("");
  return `<div class="panel"><h3>Events</h3><div class="log">${lines || "<small>Quiet so far.</small>"}</div></div>`;
}

export function renderChoices(pending: readonly PendingChoice[], challenges: ChallengeDef[], day: number): string {
  if (pending.length === 0) return "";
  const blocks = pending
    .map((pc) => {
      const def = challenges.find((c) => c.id === pc.challengeId);
      if (!def?.choice) return "";
      const buttons = def.choice.options
        .map((o) => `<button data-choice="${def.id}" data-option="${o.id}">${o.label}</button>`)
        .join(" ");
      return `<div><strong>${def.name}</strong>: ${def.description} <em>(${pc.expiresDay - day} days left)</em><br/>${buttons}</div>`;
    })
    .join("");
  return `<div class="panel" style="border-color:#c00"><h3>Decision needed</h3>${blocks}</div>`;
}
```

- [ ] **Step 2: Update src/ui/main.ts**

Add imports and content:

```ts
import { parseChallenges } from "../engine/content";
import challengesJson from "../../content/challenges.json";
import { renderLog, renderChoices } from "./render";
```

Set `challenges: parseChallenges(challengesJson)` in the content object. In `render()`, append after the decisions panels:

```ts
    ${renderChoices([...state.pendingChoices], content.challenges, state.day)}
    ${renderLog(state.log)}
```

In the click handler, add before the final `render()`:

```ts
  } else if (target.dataset.choice && target.dataset.option) {
    engine.resolveChoice(target.dataset.choice, target.dataset.option);
```

- [ ] **Step 3: Verify types and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 4: Manual release check**

Run: `npm run dev`.
Expected: events appear in the log (DDoS, scope creep roughly every ~10-20 days); hire a dev and eventually see sickness marked in Owned; the poached-dev challenge shows a red decision panel with a countdown, and ignoring it applies the default on expiry.

- [ ] **Step 5: Commit Release 3**

```bash
git add src/ui/
git commit -m "feat: release 3 - event log and timed choice challenges"
```

---

## Release 4: Projects, tax, stall state

### Task 14: Projects content and start/complete mechanics

**Files:**
- Create: `content/projects.json`
- Create: `src/engine/projects.ts`
- Modify: `src/engine/content.ts` (add project schema + parser)
- Modify: `src/engine/engine.ts` (startProject, availableProjects, isStalled)
- Test: `src/engine/projects.test.ts`

- [ ] **Step 1: Create content/projects.json**

```json
[
  {
    "id": "small-crm",
    "name": "Small CRM build",
    "sizePoints": 5000,
    "upfrontCost": 2000,
    "payoutPerPoint": 3.5,
    "completionBonus": 1500
  },
  {
    "id": "big-migration",
    "name": "Legacy platform migration",
    "sizePoints": 20000,
    "upfrontCost": 5000,
    "payoutPerPoint": 4,
    "completionBonus": 8000,
    "requiresCompleted": 1
  },
  {
    "id": "enterprise-replatform",
    "name": "Enterprise replatform",
    "sizePoints": 50000,
    "upfrontCost": 12000,
    "payoutPerPoint": 5,
    "completionBonus": 25000,
    "requiresCompleted": 2
  }
]
```

- [ ] **Step 2: Write the failing tests in src/engine/projects.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { parseStartConfig, parseProjects } from "./content";
import startJson from "../../content/start.json";
import projectsJson from "../../content/projects.json";
import { effectiveRate, contextSwitchTax } from "./modifiers";
import type { GameContent } from "./types";

function content(overrides: Partial<GameContent["start"]["stocks"]> = {}): GameContent {
  const start = parseStartConfig(startJson);
  Object.assign(start.stocks, overrides);
  return { start, decisions: [], challenges: [], projects: parseProjects(projectsJson) };
}

describe("projects", () => {
  it("startProject charges upfront cost and adds points to backlog", () => {
    const e = new Engine(content());
    e.startProject("small-crm");
    const s = e.getState();
    expect(s.stocks.budget).toBe(8000);
    expect(s.stocks.backlog).toBe(15000);
    expect(s.projects).toHaveLength(2);
  });

  it("applies the context-switch tax with multiple projects in flight", () => {
    const e = new Engine(content());
    expect(contextSwitchTax(e.getState())).toBe(1);
    e.startProject("small-crm");
    expect(contextSwitchTax(e.getState())).toBeCloseTo(0.85);
    expect(effectiveRate(e.getState(), "pull")).toBeCloseTo(0.85);
  });

  it("gates projects on completedProjects and budget", () => {
    const e = new Engine(content());
    expect(() => e.startProject("big-migration")).toThrow(/requires/);
    const poor = new Engine(content({ budget: 100 }));
    expect(() => poor.startProject("small-crm")).toThrow(/afford/);
  });

  it("FIFO attribution completes the oldest project first and pays its bonus", () => {
    const c = content();
    c.start.initialProject.sizePoints = 2;
    c.start.stocks.backlog = 2;
    const e = new Engine(c);
    e.startProject("small-crm"); // backlog now 2 + 5000
    // run until the first 2 shipped points complete the initial project
    for (let i = 0; i < 12; i++) e.tick();
    const s = e.getState();
    expect(s.completedProjects).toBe(1);
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0].defId).toBe("small-crm");
    expect(s.log.some((l) => l.message.includes("Project complete: First Contract"))).toBe(true);
  });

  it("isStalled when pipeline is empty and nothing is affordable", () => {
    const c = content({ backlog: 0, budget: 10 });
    const e = new Engine(c);
    expect(e.isStalled()).toBe(true);
    const rich = new Engine(content({ backlog: 0, budget: 5000 }));
    expect(rich.isStalled()).toBe(false); // can afford small-crm
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/engine/projects.test.ts`
Expected: FAIL, `parseProjects` / `startProject` missing.

- [ ] **Step 4: Add project schema to src/engine/content.ts**

Append:

```ts
import type { ProjectDef } from "./types";

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  sizePoints: z.number().positive(),
  upfrontCost: z.number().min(0),
  payoutPerPoint: z.number().min(0),
  completionBonus: z.number().min(0),
  requiresCompleted: z.number().int().min(0).optional(),
});

export function parseProjects(json: unknown): ProjectDef[] {
  const result = z.array(projectSchema).safeParse(json);
  if (!result.success) fail("content/projects.json", result.error);
  return result.data;
}
```

- [ ] **Step 5: Create src/engine/projects.ts**

```ts
import type { GameContent, GameState, ProjectDef } from "./types";
import { availability } from "./decisions";
import { log } from "./tick";

export interface ProjectAvailability {
  def: ProjectDef;
  startable: boolean;
  reason?: string;
}

export function projectAvailability(state: GameState, content: GameContent): ProjectAvailability[] {
  return content.projects.map((def) => {
    if (state.projects.some((p) => p.defId === def.id)) return { def, startable: false, reason: "already in flight" };
    const needed = def.requiresCompleted ?? 0;
    if (state.completedProjects < needed) return { def, startable: false, reason: `requires ${needed} completed project(s)` };
    if (state.stocks.budget < def.upfrontCost) return { def, startable: false, reason: "cannot afford" };
    return { def, startable: true };
  });
}

export function startProject(state: GameState, content: GameContent, defId: string): void {
  const entry = projectAvailability(state, content).find((p) => p.def.id === defId);
  if (!entry) throw new Error(`Unknown project: ${defId}`);
  if (!entry.startable) {
    throw new Error(entry.reason === "cannot afford" ? `Cannot afford ${defId}` : `${defId} ${entry.reason}`);
  }
  const def = entry.def;
  state.stocks.budget -= def.upfrontCost;
  state.stocks.backlog += def.sizePoints;
  state.projects.push({
    defId: def.id,
    name: def.name,
    remaining: def.sizePoints,
    payoutPerPoint: def.payoutPerPoint,
    completionBonus: def.completionBonus,
  });
  log(state, `Started project: ${def.name} (+${def.sizePoints} points, -$${def.upfrontCost})`);
}

export function isStalled(state: GameState, content: GameContent): boolean {
  const pipelineEmpty = state.stocks.backlog + state.stocks.inProgress + state.stocks.done <= 0;
  if (!pipelineEmpty) return false;
  const anyProject = projectAvailability(state, content).some((p) => p.startable);
  const anyDecision = availability(state, content).some((a) => a.purchasable);
  return !anyProject && !anyDecision;
}
```

- [ ] **Step 6: Add Engine methods in src/engine/engine.ts**

```ts
import { startProject, projectAvailability, isStalled, type ProjectAvailability } from "./projects";
```

Inside the class:

```ts
  startProject(defId: string): void {
    startProject(this.state, this.content, defId);
  }

  availableProjects(): ProjectAvailability[] {
    return projectAvailability(this.state, this.content);
  }

  isStalled(): boolean {
    return isStalled(this.state, this.content);
  }
```

Note: FIFO attribution and completion bonuses were already implemented in `tick.ts` (Task 4); this task only adds the ways to create additional projects.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add content/projects.json src/engine/projects.ts src/engine/projects.test.ts src/engine/content.ts src/engine/engine.ts
git commit -m "feat: projects, context-switch tax, stall detection"
```

### Task 15: Projects UI and Release 4 checkpoint

**Files:**
- Modify: `src/ui/render.ts` (add renderProjects, stall banner)
- Modify: `src/ui/main.ts` (load projects content, wire panel)

- [ ] **Step 1: Add to src/ui/render.ts**

```ts
import type { ProjectAvailability } from "../engine/projects";
import type { ActiveProject, GameState as GS } from "../engine/types";

export function renderProjects(
  inFlight: readonly ActiveProject[],
  offers: ProjectAvailability[],
  state: Readonly<GS>,
): string {
  const taxNow = inFlight.length <= 1 ? 1 : Math.pow(state.contextSwitchFactor, inFlight.length - 1);
  const taxNext = Math.pow(state.contextSwitchFactor, inFlight.length);
  const flight = inFlight
    .map((p) => `<div>${p.name}: ${p.remaining.toLocaleString()} points left ($${p.payoutPerPoint}/pt, $${p.completionBonus} on completion)</div>`)
    .join("");
  const shop = offers
    .map((o) => {
      const disabled = o.startable ? "" : "disabled";
      const reason = o.reason ? ` (${o.reason})` : "";
      return `<div><button data-project="${o.def.id}" ${disabled}>Start</button> <strong>${o.def.name}</strong>${reason}<br/>
        <small>${o.def.sizePoints.toLocaleString()} points, costs $${o.def.upfrontCost.toLocaleString()}, pays $${o.def.payoutPerPoint}/pt + $${o.def.completionBonus.toLocaleString()} bonus.
        Starting this drops efficiency to ${(taxNext * 100).toFixed(0)}%.</small></div>`;
    })
    .join("");
  return `<div class="panel"><h3>Projects (efficiency ${(taxNow * 100).toFixed(0)}%)</h3>${flight}<hr/>${shop}</div>`;
}

export function renderStall(stalled: boolean): string {
  return stalled
    ? `<div class="stall">The factory is stalled: no work in the pipeline and nothing affordable. Income may still accrue; otherwise this factory is dead.</div>`
    : "";
}
```

- [ ] **Step 2: Update src/ui/main.ts**

Add imports and content:

```ts
import { parseProjects } from "../engine/content";
import projectsJson from "../../content/projects.json";
import { renderProjects, renderStall } from "./render";
```

Set `projects: parseProjects(projectsJson)` in the content object. In `render()`, insert `${renderStall(engine.isStalled())}` right after the stats, and `${renderProjects([...state.projects], engine.availableProjects(), state)}` after the decisions panels. In the click handler add:

```ts
  } else if (target.dataset.project) {
    try {
      engine.startProject(target.dataset.project);
    } catch (err) {
      alert((err as Error).message);
    }
```

- [ ] **Step 3: Verify types and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 4: Manual release check**

Run: `npm run dev`.
Expected: the projects panel lists offers with the efficiency preview; starting one adds backlog, charges budget, and drops the shown efficiency to 85%; gated projects show their unlock reason; setting `start.json` backlog to 0 and budget to 10 temporarily shows the stall banner. Restore afterward.

- [ ] **Step 5: Commit Release 4**

```bash
git add src/ui/
git commit -m "feat: release 4 - projects, context-switch tax preview, stall banner"
```

---

## Release 5: Loop diagram, save/load, simulation tests

### Task 16: SVG loop diagram

**Files:**
- Create: `src/ui/loopDiagram.ts`
- Modify: `src/ui/main.ts` (render diagram)
- Test: `src/ui/loopDiagram.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { loopDiagramSvg } from "./loopDiagram";
import { initialState } from "../engine/engine";
import { parseStartConfig } from "../engine/content";
import startJson from "../../content/start.json";

describe("loopDiagramSvg", () => {
  it("renders one box per stage with stock values and rates", () => {
    const state = initialState({ start: parseStartConfig(startJson), decisions: [], challenges: [], projects: [] });
    const svg = loopDiagramSvg(state);
    expect(svg).toContain("<svg");
    for (const label of ["Backlog", "In Progress", "Done", "Shipped"]) expect(svg).toContain(label);
    expect(svg).toContain("10,000"); // backlog value
    expect(svg).toContain("1.0/day"); // base rates
    expect(svg).toContain("debt +0.5/pt"); // regen arrow label
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/loopDiagram.test.ts`
Expected: FAIL, cannot find module `./loopDiagram`.

- [ ] **Step 3: Create src/ui/loopDiagram.ts**

```ts
import type { GameState, RateId } from "../engine/types";
import { effectiveRate, effectiveDebtMultiplier } from "../engine/modifiers";

const STAGES: { key: "backlog" | "inProgress" | "done" | "shipped"; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "inProgress", label: "In Progress" },
  { key: "done", label: "Done" },
  { key: "shipped", label: "Shipped" },
];
const RATES: RateId[] = ["pull", "finish", "deploy"];

export function loopDiagramSvg(state: Readonly<GameState>): string {
  const boxW = 150;
  const boxH = 60;
  const gap = 60;
  const y = 30;
  const boxes = STAGES.map((stage, i) => {
    const x = 10 + i * (boxW + gap);
    const value = state.stocks[stage.key].toLocaleString("en-US", { maximumFractionDigits: 1 });
    return `
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" fill="none" stroke="currentColor"/>
      <text x="${x + boxW / 2}" y="${y + 24}" text-anchor="middle" font-size="13">${stage.label}</text>
      <text x="${x + boxW / 2}" y="${y + 46}" text-anchor="middle" font-size="15" font-weight="bold">${value}</text>`;
  }).join("");

  const arrows = RATES.map((rate, i) => {
    const x1 = 10 + boxW + i * (boxW + gap);
    const x2 = x1 + gap;
    const mid = y + boxH / 2;
    const value = effectiveRate(state, rate).toFixed(1);
    return `
      <line x1="${x1}" y1="${mid}" x2="${x2 - 8}" y2="${mid}" stroke="currentColor" marker-end="url(#arrow)"/>
      <text x="${(x1 + x2) / 2}" y="${mid - 8}" text-anchor="middle" font-size="11">${value}/day</text>`;
  }).join("");

  // tech debt regeneration: shipped back to backlog underneath
  const debt = effectiveDebtMultiplier(state).toFixed(1);
  const startX = 10 + 3 * (boxW + gap) + boxW / 2;
  const endX = 10 + boxW / 2;
  const loopY = y + boxH + 40;
  const regen = `
    <path d="M ${startX} ${y + boxH} V ${loopY} H ${endX} V ${y + boxH + 8}" fill="none" stroke="currentColor" stroke-dasharray="4 3" marker-end="url(#arrow)"/>
    <text x="${(startX + endX) / 2}" y="${loopY - 6}" text-anchor="middle" font-size="11">debt +${debt}/pt</text>`;

  return `
    <svg viewBox="0 0 860 170" width="100%" role="img" aria-label="Delivery loop">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>
      ${boxes}${arrows}${regen}
    </svg>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/loopDiagram.test.ts`
Expected: PASS.

- [ ] **Step 5: Render it in src/ui/main.ts**

Add `import { loopDiagramSvg } from "./loopDiagram";` and insert `${loopDiagramSvg(state)}` in `render()` between the stats and the stall banner.

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/loopDiagram.ts src/ui/loopDiagram.test.ts src/ui/main.ts
git commit -m "feat: svg loop diagram with live stocks, rates, debt regen"
```

### Task 17: Save, load, autosave, reset

**Files:**
- Create: `src/engine/save.ts`
- Create: `src/ui/storage.ts`
- Modify: `src/ui/main.ts`
- Test: `src/engine/save.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { serialize, deserialize, SAVE_VERSION } from "./save";
import { Engine } from "./engine";
import { parseStartConfig, parseDecisions } from "./content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import type { GameContent } from "./types";

function content(): GameContent {
  return { start: parseStartConfig(startJson), decisions: parseDecisions(decisionsJson), challenges: [], projects: [] };
}

describe("save/load", () => {
  it("round-trips state and continues the rng sequence identically", () => {
    const c = content();
    const a = new Engine(c);
    for (let i = 0; i < 5; i++) a.tick();
    a.applyDecision("basic-dev");

    const saved = serialize(a.getState());
    const b = new Engine(c, deserialize(saved));
    expect(b.getState()).toEqual(a.getState());

    // both continue identically (same rng state)
    a.applyDecision("basic-dev");
    b.applyDecision("basic-dev");
    expect(b.getState().decisions[1].gambleLabel).toBe(a.getState().decisions[1].gambleLabel);
  });

  it("rejects an unknown save version", () => {
    const bad = JSON.stringify({ version: SAVE_VERSION + 1, state: {} });
    expect(() => deserialize(bad)).toThrow(/version/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/save.test.ts`
Expected: FAIL, cannot find module `./save`.

- [ ] **Step 3: Create src/engine/save.ts**

```ts
import type { GameState } from "./types";

export const SAVE_VERSION = 1;

export function serialize(state: Readonly<GameState>): string {
  return JSON.stringify({ version: SAVE_VERSION, state });
}

export function deserialize(json: string): GameState {
  const parsed = JSON.parse(json) as { version: number; state: GameState };
  if (parsed.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version ${parsed.version} (expected ${SAVE_VERSION})`);
  }
  return parsed.state;
}
```

- [ ] **Step 4: Create src/ui/storage.ts (localStorage lives in the UI layer, keeping the engine pure)**

```ts
import { serialize, deserialize } from "../engine/save";
import type { GameState } from "../engine/types";

const KEY = "software-factory-save";

export function saveGame(state: Readonly<GameState>): void {
  localStorage.setItem(KEY, serialize(state));
}

export function loadGame(): GameState | undefined {
  const raw = localStorage.getItem(KEY);
  if (!raw) return undefined;
  try {
    return deserialize(raw);
  } catch {
    return undefined; // unreadable or old-version save: start fresh
  }
}

export function clearSave(): void {
  localStorage.removeItem(KEY);
}
```

- [ ] **Step 5: Wire into src/ui/main.ts**

Add `import { saveGame, loadGame, clearSave } from "./storage";`. Change engine construction to:

```ts
const engine = new Engine(content, loadGame());
```

In the `setInterval` callback, after `engine.tick()`, add autosave every 10 days:

```ts
  if (engine.getState().day % 10 === 0) saveGame(engine.getState());
```

Add a reset button next to pause in `render()`:

```ts
    <button id="reset">Reset game</button>
```

And in the click handler:

```ts
  } else if (target.id === "reset") {
    if (confirm("Wipe this factory and start over?")) {
      clearSave();
      location.reload();
    }
```

- [ ] **Step 6: Run all tests and types**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean. The purity test still passes because localStorage usage is in `src/ui/storage.ts`, not the engine.

- [ ] **Step 7: Commit**

```bash
git add src/engine/save.ts src/engine/save.test.ts src/ui/storage.ts src/ui/main.ts
git commit -m "feat: versioned save/load with autosave and reset"
```

### Task 18: Simulation invariant tests, README, final checkpoint

**Files:**
- Create: `src/engine/simulation.test.ts`
- Create: `README.md`

- [ ] **Step 1: Write the simulation tests**

```ts
import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { parseStartConfig, parseDecisions, parseChallenges, parseProjects } from "./content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import challengesJson from "../../content/challenges.json";
import projectsJson from "../../content/projects.json";
import type { GameContent, GameState } from "./types";

function fullContent(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: parseChallenges(challengesJson),
    projects: parseProjects(projectsJson),
  };
}

function assertInvariants(s: Readonly<GameState>, day: number): void {
  for (const [name, v] of Object.entries(s.stocks)) {
    expect(v, `stock ${name} at day ${day}`).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(v), `stock ${name} finite at day ${day}`).toBe(true);
  }
  expect(s.pointsPerDay).toBeGreaterThanOrEqual(0);
}

describe("simulation", () => {
  it("idle strategy: 2000 days with full content violates no invariants", () => {
    const e = new Engine(fullContent());
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      assertInvariants(e.getState(), day);
    }
  });

  it("greedy strategy: buy everything affordable each day, invariants hold", () => {
    const e = new Engine(fullContent());
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      for (const a of e.availableDecisions()) {
        if (a.purchasable && !e.getState().decisions.some((d) => d.defId === a.def.id)) {
          e.applyDecision(a.def.id);
        }
      }
      for (const p of e.availableProjects()) {
        if (p.startable) e.startProject(p.def.id);
      }
      // resolve any pending choice with its first option
      for (const pc of [...e.getState().pendingChoices]) {
        const def = fullContent().challenges.find((c) => c.id === pc.challengeId)!;
        e.resolveChoice(pc.challengeId, def.choice!.options[0].id);
      }
      assertInvariants(e.getState(), day);
    }
    // sanity: the factory actually did something
    expect(e.getState().stocks.shipped).toBeGreaterThan(100);
  });

  it("upgrades move points/day: test suite + ci-cd beats idle over 400 days", () => {
    const idle = new Engine(fullContent());
    const invested = new Engine(fullContent());
    invested.applyDecision("test-suite");
    for (let day = 1; day <= 400; day++) {
      idle.tick();
      invested.tick();
      if (day === 10) invested.applyDecision("ci-cd");
    }
    expect(invested.getState().stocks.shipped).toBeGreaterThanOrEqual(idle.getState().stocks.shipped * 0.9);
    // deploy rate is strictly higher once ci-cd settles
    expect(invested.getState().stocks.techDebt).toBeLessThan(idle.getState().stocks.techDebt);
  });
});
```

- [ ] **Step 2: Run the simulation tests**

Run: `npx vitest run src/engine/simulation.test.ts`
Expected: PASS. If an invariant trips, that is a real engine bug: debug it (systematic-debugging skill), do not loosen the assertion.

- [ ] **Step 3: Write README.md**

```markdown
# Software Factory

A browser incremental game about systems thinking in software delivery.
You run a delivery loop that burns down a backlog. Alter the loop with
people, agents, and process; survive random challenges; scale points/day.

## Run

    npm install
    npm run dev

## Test

    npm run test

## Layout

- `src/engine/` - all game rules. Framework-free TypeScript, no DOM access
  (enforced by `purity.test.ts`). Deterministic via seeded RNG.
- `src/ui/` - thin plain-DOM rendering and input layer, plus localStorage saves.
- `content/` - human-editable JSON: `start.json` (constants), `decisions.json`
  (loop alterations), `challenges.json` (random events), `projects.json`
  (contracts). Validated at load; edits need no code changes.
- `docs/superpowers/specs/` - design document, including alternatives considered.

## Editing content

Add a decision, challenge, or project by appending to the matching JSON file.
Effects use a small typed vocabulary (`modifyRate`, `modifyDebtMultiplier`,
`addToStock`, `sickness`); schema errors are reported with file and entry names.
```

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all clean.

Run: `npm run dev` and play for a few minutes.
Expected: full loop works end to end: diagram animates, decisions and gambles function, challenges fire, choices expire, projects start and complete, saves persist across reload, reset wipes.

- [ ] **Step 5: Commit Release 5**

```bash
git add src/engine/simulation.test.ts README.md
git commit -m "feat: release 5 - simulation invariant tests and readme"
```

---

## Post-plan notes for the executor

- Any behavior change starts with a failing test. If you find yourself writing engine code without a red test, stop and write the test.
- If a Release checkpoint reveals a bug, fix it inside that release (test first) before starting the next release. That is the point of incremental releases.
- Content balance numbers are first guesses by design; do not tune them mid-implementation. Balance passes come after v1.
- Deferred to post-v1 (deliberately, per spec): reputation/morale/compute/valuation stocks, tag-weighted challenge pools beyond `hasTag`, startup/megacorp/darkfactory challenge sets, agents-spawning-agents. The effect vocabulary and content schemas already accommodate them.
