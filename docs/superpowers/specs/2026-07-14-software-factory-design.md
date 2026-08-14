# Software Factory: Design Document

Date: 2026-07-14
Status: Historical v1 snapshot (not an authoring guide)

> **Historical (pre-P0.2).** Parallel “tracks” and decision `tags` /
> challenge `hasTag` are retired. Scale **eras** (Studio → Company →
> Megacorp) and stock / ownership predicates replaced that curriculum.
> Author new content from `docs/CONTENT-AUTHORING.md`, `docs/CONTEXT.md`,
> and ADRs 0001–0006. Leave this spec as the v1 design snapshot; do not
> teach authors the track sections below.

## 1. Overview

Software Factory is a browser-based incremental game in the spirit of Universal Paperclips, with random challenge events in the spirit of AdVenture Capitalist / After Inc. The player runs a software delivery loop that burns down a backlog of story points. The goal is scale: maximize points/day by altering the loop with people, agents, and process. Some alterations are deterministic, some are gambles. Budget constrains choices, so the player cannot buy everything and must commit to a direction.

The game is a systems-thinking sandbox. The delivery pipeline is modeled as stocks and flows, and the central lesson emerges from play: speeding up one stage moves the bottleneck to another, debt compounds, and work-in-progress has a cost.

## 2. Core loop and tick mechanics

- One iteration (tick) is 1 second of real time and represents 1 day in game.
- The player can pause and resume the iteration loop at any time.
- Budget, backlog, and points/day are always visible.
- Every decision shows its cost and direct side effects before purchase. The game does not model or display second-order interactions; those emerge from the simulation.

### Points/day

Points/day is the flow rate at the final pipeline stage: story points shipped per day. It is the primary score.

## 3. Stocks and flows

### Pipeline stages as stocks

The delivery loop is a chain of stocks connected by flow rates:

```
Backlog --(dev rate)--> In Progress --(dev rate)--> Done --(deploy rate)--> Shipped
   ^                                                                  |
   +------------- tech debt regeneration (0.5 per shipped point) ----+
```

Each stage holds story points. Each arrow has its own rate, and rates are what decisions modify. This gives Theory of Constraints behavior for free: buying capacity at one stage piles work up at the next until the player addresses the new bottleneck. The loop diagram in the UI renders these stocks and rates so the player can watch the shape of their factory change.

Start state rates are 1 point/day on every arrow.

### Primary stocks

- Backlog (story points): drained by dev rate, filled by tech debt regeneration, scope creep challenges, and starting new projects.
- Budget (dollars): drained by base burn and per-day upkeep of purchases, filled by revenue from shipped points and project completion payouts.
- Tech debt (points, cumulative): each shipped point adds debt-multiplier points (base 0.5) to both the tech debt stock and the backlog. The stock itself drives risk: incident-class challenge probabilities scale with the tech debt level. Refactoring-class purchases reduce the stock and/or the multiplier.

### Later stocks (introduced by content, not engine changes)

These are defined in content files and activated when relevant decisions or tracks unlock them:

- Reputation: earned by shipping and completing projects, lost to incidents. Gates which projects are offered.
- Bugs in production: created as a fraction of shipped points when tech debt is high; each drains budget per day until fixed.
- Morale (human tracks): multiplies human output, decays under crunch, feeds quit gambles.
- Compute (automation track): consumed by agents, purchased with budget, targeted by price-shock challenges.
- Valuation (startup track): set by growth metrics, priced by acquisition and funding events.

### Revenue

Each shipped point pays out immediately (initial project: 3 dollars/point). Completing a project pays a completion bonus. This creates the core reinforcing loop: ship faster, earn more, reinvest in the loop. All payout numbers live in content files.

## 4. Projects

- The game starts with one project: 10,000 points, no upfront cost (already signed).
- At any time the player may start a new project from the offered list. A project has an upfront cost, a point size, a per-point payout, and a completion bonus. Larger and better-paying projects are gated by reputation or prior completions in the content graph.
- All project points merge into the single shared backlog and flow through the one loop.
- Shipped points are attributed FIFO to the oldest incomplete project. When a project's point total is fully shipped, it completes, pays its bonus, and leaves the in-flight count.
- Context-switch tax: with n projects in flight, all pipeline flow rates are multiplied by 0.85^(n-1). Two concurrent projects run at 85% efficiency, three at about 72%. The tax is shown to the player before they confirm a new project.
- Stall state: if the backlog is empty and the player cannot afford any project or loop alteration, the game does not proceed. The factory is dead unless remaining per-day income eventually affords a move. This is the soft-fail state and it is intentional.

## 5. Decisions (loop alterations)

Decisions are the purchasable changes to the loop. All decisions are data, defined in content files, and interpreted by a small set of engine effect handlers.

### Decision anatomy

- Cost: one-time and/or per-day upkeep.
- Effects: a list of typed effects, for example modify a flow rate, change the debt multiplier, add to a stock, unlock a stock.
- Gamble (optional): a probability table of effect outcomes rolled once at purchase. Example: add basic developer resolves to one of four burndown outcomes.
- Duration (optional): effects can be temporary (test suite slows the loop for 5 days) or permanent.
- Upkeep dependency: a decision with per-day cost is removed permanently if the budget cannot pay it (the developer who quits when payroll fails).
- Removable: most decisions can be voluntarily removed after purchase; removal drops their effects and upkeep.
- Requires / unlocks: edges in the decision graph (test suite unlocks CI/CD).
- Synergies: conditional modifiers keyed on other owned decisions. Example: an agent purchased while a harness is owned uses a tighter gamble table and half the debt multiplier. The same mechanism covers managers tightening hire gambles and CI/CD raising deploy rate.
- Tags: track-affinity labels (solo, startup, megacorp, darkfactory) used to weight which challenges and project offers appear.

### Engine effect handlers (initial set)

modifyRate, modifyDebtMultiplier, addToStock, unlockStock, addIncomePerDay, addCostPerDay, rollGambleTable, applyConditionalModifier. Adding a future mechanic (for example agents that spawn agents) means adding a content entry and, at most, one new handler.

## 6. Challenges

Challenges are random events rolled per tick from the content file. Each challenge defines:

- probabilityPerDay: chance of firing on any given tick.
- condition: predicate on game state (at least one human dev, agents present, tech debt above a threshold, tags owned). Conditions both gate and scale: incident-class challenges scale probability with the tech debt stock.
- duration: how long effects last, if temporary.
- effects: same typed effect list as decisions.
- choice (optional): timed offers. Instead of applying effects immediately, the challenge presents options with a countdown (expiresInDays). Term sheets and acquisition bids use this. Expiry applies the default option.

Challenge pools are weighted by the player's decision tags, so the build a player assembles determines which problems find them.

### Initial challenge set

Active from the start:

- Sickness: 10%/day, per human developer, that developer's contribution drops 30% for 5 days.
- DDoS: 5%/day, budget minus 100 dollars.
- Scope creep: 10%/day, backlog plus 200 points.
- Production incident: probability scales with tech debt (base 1%/day plus 1% per 500 debt), budget hit and temporary rate loss.
- Laptop dies: 3%/day while no human hires (solo only), budget minus 1,500 dollars.
- Viral blog post: 2%/day, reputation up, a better project appears in offers.

Unlocked by human-track tags:

- Key dev poached: choice challenge, match a salary raise or lose the developer.
- Brooks onboarding drag: fires after any hire, all human rates minus 15% for 10 days.
- Meeting creep: permanent 10% rate loss until a process-class purchase clears it.
- Morale spiral: fires when morale is low, compounding rate loss.

Unlocked by startup tags:

- Term sheet: choice challenge with expiry, large budget injection but imposes a rising points/day quota; missing quota triggers a down round.
- Competitor launches: backlog plus 20%.
- Acquihire offer: choice challenge, end-game option priced off valuation.

Unlocked by megacorp tags:

- Reorg: all rates minus 25% for 15 days.
- Compliance audit: choice, pay or deploy rate is zero until paid.
- Security breach: severity scales with tech debt, budget and reputation hit.

Unlocked by darkfactory tags:

- Model deprecation: agents at half effect until a migration fee is paid.
- API price hike: agent per-day upkeep plus 40%.
- Agent runaway loop: overnight budget drain.
- Hallucinated dependency: tech debt spike.
- GPU shortage: compute costs triple for 30 days.

## 7. Tracks and progression

> **Historical.** Tracks are not modes and are not how content is authored
> now. See ADR 0002. The four “attractors” below were a v1 sketch; P0.2
> uses one-way scale eras instead.

Tracks are not modes the player selects. They emerge from decision tags: the challenges offered, projects offered, and later decisions unlocked all key off what the player has bought. Four intended attractors:

- Solo craftsman: no hires, upgrades to the one dev (tooling, learning, copilot). Low burn, immune to team challenges, throughput hard-capped, brutal bus-factor risk. End state: a lean lifestyle factory.
- Startup: VC funding gambles, fast cheap churny hiring, pivots. Stocks: valuation, quota. End state: acquisition or IPO.
- Mega corp: headcount scaling under Brooks's Law communication tax, process purchases (standups, managers) that reduce gamble variance but add per-head overhead. End state: process is the product.
- Dark factory: agent, then harness, then swarm (needs orchestrator), then self-learning agents, then agents that spawn agents. Humans become optional, then a liability, then gone. End state: the factory ships with zero humans, including the player.

The engine does not need to know which track (or which loop archetype: balancing, reinforcing, co-evolutionary) the player has built. It only executes stocks, flows, modifiers, and events; the loop character is emergent.

### Initial decision set (start state)

- Add test suite: burndown rate minus 50% for 5 days; debt multiplier halved permanently. Unlocks CI/CD.
- CI/CD (requires test suite): burndown rate minus 50% for 1 day; then deploy rate plus 10% permanently.
- Add basic developer: 275 dollars/day upkeep. Gamble: 50% plus 1.0 point/day, 25% plus 0.5, 20% minus 0.5, 5% minus 1.0. Removed permanently if payroll fails.
- Add agent: 10 dollars one-time, 30 dollars/day upkeep. In Progress rate plus 20%, debt accumulation plus 20%.

## 8. Content file format

> **Historical paths.** Live layout is per-era (`content/eras/<eraId>/`,
> ADR 0001). `tags` on decisions are retired (ADR 0002).

All game content lives in human-readable JSON files in a `content/` directory, editable without a coding assistant:

- `content/decisions.json`: the decision graph (costs, effects, gambles, requires/unlocks, synergies, tags).
- `content/challenges.json`: challenge definitions.
- `content/projects.json`: project offers and their gates.
- `content/start.json`: starting stocks, rates, and constants (base burn 5 dollars/day, debt multiplier 0.5, context-switch factor 0.85, payout rates).

Each file is validated against a schema at load; a content error produces a clear message naming the file and entry. A graph database may replace this later; the schema is the stable contract.

## 9. Architecture

Chosen approach: pure client-side static app with a hard internal engine/UI boundary.

- `src/engine/`: framework-free TypeScript. Owns the tick loop, stocks, flows, effect handlers, gamble resolution (seeded RNG), challenge rolls, and save/load. No DOM imports, enforced by lint rule. Exposes: `tick()`, `getState()`, `applyDecision(id)`, `removeDecision(id)`, `startProject(id)`, `resolveChoice(challengeId, optionId)`, `pause()/resume()`.
- `src/ui/`: thin rendering layer (Preact or plain DOM, Vite build). Renders engine state, dispatches player intents, draws the loop diagram as hand-rolled SVG showing stages, stock levels, and flow rates.
- Saves: versioned JSON in localStorage. The save schema and content schemas are defined from day one so they can move server-side unchanged.
- Randomness: single seeded RNG owned by the engine, so simulations are reproducible in tests.

### Alternatives considered (not chosen, reasonable future refactors)

- Engine in a Web Worker: same boundary made physically unbreakable via message passing, and the tick loop cannot be blocked by rendering. Rejected for v1 because message-passing ceremony slows iteration and a 1 tick/second game does not need it. This is the natural first refactor if the engine/UI discipline slips or tick work grows heavy.
- Thin client plus Node server: simulation runs server-side, browser is purely a view. Cheat-proof and literally minimal client logic, but inherits hosting, sessions, and persistence for a single-player v1. Revisit when leaderboards, cross-device saves, or server-authoritative state matter. The engine module and schemas are designed to lift into a server unchanged.

## 10. Error handling

- Content validation errors fail loudly at load with file and entry names.
- Save-version mismatches migrate when possible, otherwise offer a fresh start rather than corrupting state.
- Engine guards: stocks clamp at zero, rates clamp at a small positive floor, upkeep failure follows the defined removal rule rather than driving budget negative.

## 11. Testing

- Engine unit tests: tick math, effect handlers, FIFO project attribution, context-switch tax, upkeep-failure removal, challenge gating and scaling. Seeded RNG makes gamble and challenge tests deterministic.
- Content tests: schema validation of shipped JSON; a referential-integrity check that every requires/unlocks/synergy id exists.
- Simulation tests: run N thousand ticks of scripted strategies and assert invariants (no negative stocks, stall state is reachable and stable, points/day responds to rate changes).
- UI is kept thin enough that engine tests carry most of the confidence; a few smoke tests cover render and intent dispatch.

## 12. Risks

- Balance risk: the numbers above are first guesses; the game may stall too easily or snowball too fast. Mitigation: all constants in content files, simulation tests double as balance probes.
- Boundary erosion: UI logic creeping into the engine makes future refactors (worker, server) expensive. Mitigation: lint-enforced no-DOM rule in `src/engine/`, message-shaped engine API from day one.
- Content sprawl: as JSON grows, hand-editing gets error-prone. Mitigation: schema validation with precise errors; graph DB remains the escape hatch.

## 13. Out of scope for v1

- Modeling or displaying second-order systemic interactions (they emerge; the game does not explain them).
- Server features: accounts, leaderboards, cross-device sync.
- Multiple visualized loops or per-project backlogs.
- Sound, art beyond basic text-and-SVG presentation.
