export interface Stocks {
  backlog: number;
  inProgress: number;
  done: number;
  shipped: number;
  budget: number;
  techDebt: number;
  // Reputation (Release 17): a second reinforcing loop. Earned via
  // ProjectDef.reputationReward on completion, spent by the existing
  // addToStock effect (incident-class challenges), gates contract tiers via
  // ProjectDef.requiresReputation. Not a pipeline stage, so the loop diagram
  // (named stage keys only) is unaffected. Clamped at 0 like every other
  // stock (applyEffects' addToStock/scaleStock already do this generically).
  reputation: number;
  // Users (Studio spine, issue #88): the product-growth stock. Stays 0 until
  // the Launch beta project completes (which grants +30 via
  // completionStockGrants), then grows via start.stockFlows organic
  // acquisition (gated on minCompletedProjects) and drives monetization
  // decisions that read it (incomeFromStock/burstFromStock). Above a free
  // band it also applies a support drag on delivery rates (start.stockDrags).
  // Clamped at 0 like every other stock.
  users: number;
}

export type StockName = keyof Stocks;

// Unshipped delivery stages. `backlog` here is the Ready queue (work waiting
// to be pulled), not the cockpit "Backlog" hero metric — that reads the sum
// of these three (ADR 0009). Shipped is excluded: it already left the factory.
export const PIPELINE_STOCKS = ["backlog", "inProgress", "done"] as const;
export type PipelineStock = (typeof PIPELINE_STOCKS)[number];

export type RateId = "pull" | "finish" | "deploy";
export const RATE_IDS: readonly RateId[] = ["pull", "finish", "deploy"];

export type Effect =
  | { type: "modifyRate"; target: RateId | "all"; op: "add" | "mul"; value: number; durationDays?: number }
  | { type: "modifyDebtMultiplier"; op: "add" | "mul"; value: number; durationDays?: number }
  | { type: "addToStock"; stock: keyof Stocks; value: number }
  | { type: "scaleStock"; stock: keyof Stocks; factor: number }
  | { type: "sickness"; factor: number; durationDays: number }
  | { type: "rampRate"; target: RateId; perDay: number; cap: number }
  // Marker effect: no parameters, creates no modifier (see applyEffects).
  // Activation is derived from ownership -- see continuousDeployActive in
  // continuousDeploy.ts -- so this variant exists purely to be present or
  // absent in a decision def's effects list.
  | { type: "continuousDeploy" }
  // Removes one owned human developer instance (DecisionDef.human === true)
  // and strips its modifiers. Prefer EffectContext.instanceId when that
  // instance is still a living human; otherwise the first human in roster
  // order. For challenge choice options: no Studio challenge uses it today.
  // Requires EffectContext.content; silently no-ops without content or humans.
  | { type: "removeHuman" };

export type ModifierTarget = RateId | "allRates" | "debtMultiplier";

export interface Modifier {
  id: string;
  source: string; // decision instanceId or challenge occurrence id
  target: ModifierTarget;
  op: "add" | "mul";
  value: number;
  expiresDay?: number;
  // Present together for ramp modifiers created by the rampRate effect: each
  // tick grows value toward rampCap by rampPerDay (see tick.ts). Absent for
  // every other modifier.
  rampPerDay?: number;
  rampCap?: number;
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

// Player-facing category tag on a shop card (see CATEGORY_LABELS in
// src/ui/render.ts). Required on every decision; the shop is a flat list
// and does not group by this field.
export type DecisionCategory = "ship-faster" | "earn-income" | "tame-debt" | "prevent-trouble" | "change-structure";

// Additive stock-flow modifier owned by a decision (ADR 0006 / issue #85).
// Nudges an existing start.stockFlows entry for the named stock: deltas are
// summed across all owned decisions and added to that flow's own
// acquirePerDay / churnRatePerDay each tick. Studio ships none (types/schema
// exist for forward-compat; content may omit the field entirely).
export interface StockFlowMod {
  stock: StockName;
  acquirePerDayDelta?: number;
  churnRateDelta?: number;
}

export interface DecisionDef {
  id: string;
  name: string;
  description: string;
  category: DecisionCategory;
  human?: boolean;
  cost: { oneTime?: number; perDay?: number };
  incomePerDay?: number;
  // Per-day income scaled by a stock's current level (Studio monetization,
  // issue #85). Stacks additively on top of the flat incomePerDay in
  // chargeUpkeep: totalIncome += stocks[stock] * perUnit. The subscription
  // card reads users at $0.75/user/day; useless at 0 users.
  incomeFromStock?: { stock: StockName; perUnit: number };
  // Probabilistic income burst scaled by a stock's level (Studio
  // monetization). Each day rolls probabilityPerDay; on a hit it credits
  // stocks[stock] * perUnit to budget. The one-time-product card reads users.
  burstFromStock?: { stock: StockName; probabilityPerDay: number; perUnit: number };
  // Forward-compat additive nudges to start.stockFlows (ADR 0006). Studio
  // ships none; the engine sums deltas from owned decisions when present.
  stockFlowMods?: StockFlowMod[];
  effects: Effect[];
  gamble?: GambleOutcome[];
  requires?: string[];
  // Ownership gates that count instances rather than just presence (issue
  // #89): each entry demands at least `count` owned instances of `id`. Used by
  // agent-orchestration, which only makes sense once there are >= 2 agents to
  // coordinate. Composes with `requires` (both must hold); ids are
  // cross-checked by parseDecisions like `requires` ids are.
  requiresCounts?: { id: string; count: number }[];
  removable: boolean;
  unique?: boolean; // at most one owned instance at a time
  synergies?: Synergy[];
}

export interface DecisionInstance {
  instanceId: string;
  defId: string;
  gambleLabel?: string;
  // The Synergy.ifOwned provider whose variant effects were applied when this
  // instance was purchased, or absent when the base effects were used.
  // Synergies are selected at purchase time only (see applyDecision), so this
  // is the sole record of which variant an owned instance actually got --
  // ownership of the provider today says nothing about instances bought before
  // it. Legacy saves predate the field; undefined means "base effects".
  appliedSynergyIfOwned?: string;
  // Sickness is deliberately tracked per decision instance rather than as a
  // Modifier: it scales this one instance's contribution instead of a whole
  // rate. The engine's effectiveRate computation consults these fields.
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
  condition?: {
    minHumanDevs?: number;
    maxHumanDevs?: number;
    minTechDebt?: number;
    minDay?: number;
    // Completed-project floor (issue #89): the challenge only fires once the
    // player has finished at least this many projects. Studio uses it to hold
    // scope-creep back until the Launch beta has shipped, keeping the opening
    // tutorial stretch quiet without pinning a calendar day.
    minCompletedProjects?: number;
    // Decision def ids: the challenge only fires while at least one owned
    // instance has any listed defId. Cross-checked against content.decisions
    // by validateContentGraph.
    requiresAnyDecision?: string[];
    // A decision def id: the challenge only fires while NO owned instance has
    // this defId. Cross-checked against content.decisions by
    // validateContentGraph (parseChallenges alone has no access to decisions).
    lacksDecision?: string;
  };
  probScaling?: { stat: "techDebt"; per: number; add: number };
  effects: Effect[];
  choice?: { expiresInDays: number; defaultOptionId: string; options: ChoiceOption[] };
  cooldownDays?: number;
}

export interface ProjectDef {
  id: string;
  name: string;
  sizePoints: number;
  upfrontCost: number;
  payoutPerPoint: number;
  completionBonus: number;
  requiresCompleted?: number;
  // Reputation earned on completion (Release 17), paid in tick.ts's
  // attributeShipped alongside the completion bonus.
  reputationReward: number;
  // Optional reputation floor gating this project's availability, ON TOP OF
  // requiresCompleted (both must hold when both are set). Checked by
  // projectAvailability after requiresCompleted, before affordability.
  // Live-recomputed each call, so a reputation drop re-locks a tier with no
  // extra mechanism needed.
  requiresReputation?: number;
  // Must have completed this specific project id (the start project's id, or
  // another catalog id). Studio versions use this so gigs cannot skip the
  // ladder: v1 requires launch-beta, v2 requires ship-v1, and so on. Checked
  // against state.completedProjectIds after the completed-count floor.
  requiresCompletedId?: string;
  // When true, the project cannot be started again after it has completed
  // (or while it is already in flight). Studio's v1–v5 ladder is unique;
  // tiny client gigs omit this and stay repeatable. Default false.
  unique?: boolean;
  // Stocks granted on completion (Studio spine, issue #88). Applied in
  // attributeShipped's completion branch alongside the budget/reputation
  // rewards. The Launch beta grants +30 users this way, which is what starts
  // the users economy (users stay 0 until then). Clamped at 0 like every
  // other stock write.
  completionStockGrants?: { stock: StockName; amount: number }[];
}

export interface ActiveProject {
  defId: string;
  name: string;
  // Unshipped points still owed on this contract (ADR 0009). Extra pipeline
  // inflow (debt refill, scope creep, addToStock/scaleStock on a pipeline
  // stock) attaches here while the project is in flight, so remaining tracks
  // the work, not a parallel ship-countdown. Completes at ~0 in attributeShipped.
  remaining: number;
  payoutPerPoint: number;
  completionBonus: number;
  reputationReward: number;
  // Copied from ProjectDef.completionStockGrants (or StartConfig.
  // initialProject.completionStockGrants for the starting project) when the
  // project is started/seeded, so completion pays the grants recorded at
  // start time even if content changes mid-game. Absent = no stock grants.
  completionStockGrants?: { stock: StockName; amount: number }[];
}

export interface PendingChoice {
  challengeId: string;
  expiresDay: number;
  // Optional human-dev instance targeted when the choice was queued (e.g. for
  // removeHuman on let-them-go). Absent on legacy saves and on choices that
  // never needed a person target; applyEffects then falls back at resolve time.
  targetInstanceId?: string;
}

export interface LogEntry {
  day: number;
  message: string;
}

// Always-on stock drag (Studio spine, issue #88 / ADR 0006). Mirrors the
// tech-debt debtDrag shape but keyed on an arbitrary stock and pointed at a
// specific rate (or "all", like modifyRate). Above freeBand, every excess
// point slows the target rate(s) by dragPerPoint, capped at maxDrag. The
// support drag on `users` uses this: growth costs delivery capacity.
export interface StockDrag {
  stock: StockName;
  freeBand: number;
  dragPerPoint: number;
  maxDrag: number;
  target: RateId | "all";
}

// Always-on per-tick stock flow (Studio spine, issue #88 / ADR 0006). Runs in
// tick.ts after shipping. When its condition holds, the stock gains
// acquirePerDay (flat) plus acquirePerStock.perUnit per point of another
// stock (the organic users flow reads reputation), then loses
// stocks[stock] * churnRatePerDay to churn. Net is clamped at 0. Base churn
// only -- no debt/incident churn DSL in this issue.
export interface StockFlow {
  stock: StockName;
  // Studio organic acquisition only turns on after the Launch beta completes.
  condition?: { minCompletedProjects?: number };
  acquirePerDay?: number;
  acquirePerStock?: { stock: StockName; perUnit: number };
  churnRatePerDay?: number;
}

export interface StartConfig {
  seed: number;
  stocks: Stocks;
  baseRates: Record<RateId, number>;
  debtMultiplier: number;
  baseBurnPerDay: number;
  contextSwitchFactor: number;
  // Always-on stock drags (Studio support drag). Copied into GameState at
  // init like debtDrag, so effectiveRate can apply them without content.
  // Optional: content may omit; treated as [] when absent.
  stockDrags?: StockDrag[];
  // Always-on stock flows (Studio organic user acquisition). Read from content
  // at tick time (tick has content). Optional; treated as [] when absent.
  stockFlows?: StockFlow[];
  // Tech-debt drag (Release 15, Limits to Growth): the debt stock pushes back
  // on throughput. freeDebt is the grace band (no drag at or below it),
  // dragPerPoint is the per-excess-point slowdown, maxDrag caps how much
  // capacity the drag can ever cancel. See debtDragMultiplier in modifiers.ts.
  debtDrag: { freeDebt: number; dragPerPoint: number; maxDrag: number };
  initialProject: {
    id: string;
    name: string;
    sizePoints: number;
    payoutPerPoint: number;
    completionBonus: number;
    reputationReward: number;
    // Stocks granted when the starting project (Launch beta) completes. Copied
    // onto the seeded ActiveProject in initialState. This is how users go from
    // 0 to 30 the moment the beta ships.
    completionStockGrants?: { stock: StockName; amount: number }[];
  };
  // Global minimum gap, in days, between any two challenges firing (effects
  // applied OR a choice queued -- either counts as "firing"). 0 disables
  // spacing entirely. See GameState.lastChallengeDay and rollChallenges.
  challengeSpacingDays: number;
  // Named reputation thresholds (Release 17), sorted ascending by
  // parseStartConfig's integrity check. See milestones.ts for detection.
  milestones: { id: string; reputation: number; name: string; message: string }[];
}

// One scale era in content/eras.json (ADR 0001). Entry predicates are an OR
// of AND-floors. Engine.tick evaluates the next era only (one-way ladder)
// and never hardcodes era names.
export interface EraEntryPredicate {
  minBudget?: number;
  minReputation?: number;
  minCompletedProjects?: number;
  minUsers?: number;
}

export interface EraDef {
  id: string;
  name: string;
  entryAnyOf?: EraEntryPredicate[];
  // Omit or true: crossing writes no Events line and is not a next-goal.
  // false: announce the crossing. Parsed JSON omits the key for the default.
  silentEntry?: boolean;
}

export interface ErasConfig {
  startingEraId: string;
  eras: EraDef[];
}

export interface GameContent {
  start: StartConfig;
  decisions: DecisionDef[];
  challenges: ChallengeDef[];
  projects: ProjectDef[];
  // Active era id + catalog from content/eras.json (issue #90). Resolved
  // decisions/challenges/projects include every prior rung (ADR 0008).
  // Always set by loadShippedContent / loadActiveContent. Optional on
  // hand-built test fixtures so unit tests can keep assembling partial graphs.
  eraId?: string;
  eras?: ErasConfig;
}

export interface GameState {
  day: number;
  paused: boolean;
  // Active content era id (issue #90). Copied from GameContent.eraId at init.
  // Advances one-way when the next era's entryAnyOf fires (see eras.ts).
  // Legacy saves predate the field; Engine backfills from content.eraId.
  eraId: string;
  stocks: Stocks;
  baseRates: Record<RateId, number>;
  debtMultiplierBase: number;
  baseBurnPerDay: number;
  contextSwitchFactor: number;
  // Tech-debt drag config, copied from content.start.debtDrag at init (the
  // contextSwitchFactor pattern). Legacy saves predate these three fields; the
  // Engine constructor backfills them from content. See debtDragMultiplier.
  debtDragFreeDebt: number;
  debtDragPerPoint: number;
  debtDragMaxDrag: number;
  // Always-on stock drags (Studio support drag, issue #88), copied from
  // content.start.stockDrags at init like the debtDrag config above so
  // effectiveRate stays content-free. Legacy saves predate it; the Engine
  // constructor backfills from content (and the SAVE_VERSION bump means old
  // saves are wiped anyway). Empty when content ships none.
  stockDrags: StockDrag[];
  modifiers: Modifier[];
  decisions: DecisionInstance[];
  projects: ActiveProject[];
  completedProjects: number;
  // Ids of projects that have ever completed this game (the start project
  // plus catalog defs). Used by requiresCompletedId and unique. Counted
  // once per id even if a repeatable gig finishes twice. initialState seeds
  // []; deserialize backfills [] on current-version hand-built states.
  completedProjectIds: string[];
  pendingChoices: PendingChoice[];
  log: LogEntry[];
  pointsPerDay: number;
  // Realized flow for the pull and finish stages, mirroring pointsPerDay
  // (which is the realized deploy-stage flow: shippedFlow, capped by
  // whatever was actually sitting in Done that tick -- see tick.ts). Each is
  // capped by the stock actually available that tick (backlog for pull,
  // inProgress for finish), NOT the stage's uncapped rate. Added for issue
  // #9: the Delivery loop diagram's arrows and the Progress loop panel's
  // exit box used to print raw stage capacity (effectiveRate) and claim it
  // equaled throughput, which is only true when the relevant stock fully
  // saturates that stage every tick -- these fields let the UI show what
  // actually moved instead.
  pullFlow: number;
  finishFlow: number;
  // Realized users-loop flows this tick (mirrors pullFlow for the product
  // economy). userAcquireFlow is gross organic gain; userChurnFlow is the
  // amount leaving; userIncomeFlow is budget credited from decisions that
  // read the users stock (incomeFromStock + burstFromStock). 0 when the
  // users flow is gated off (pre-launch) or no monetization fired.
  userAcquireFlow: number;
  userChurnFlow: number;
  userIncomeFlow: number;
  nextInstanceId: number;
  nextModifierId: number;
  rngState: number;
  // The game's content seed, copied from content.start.seed at init. Challenge
  // rolls hash on (gameSeed, day, challengeId) rather than drawing from the
  // rngState stream, so they stay stable when content is added or reordered.
  // Legacy saves predate this field; the Engine constructor backfills it.
  gameSeed: number;
  // Keyed by ChallengeDef.id; set when a cooldownDays challenge's effects
  // actually land (fire() for non-choice, resolveChoice, or expiry-default
  // application for choice challenges). Absent entries mean never fired.
  challengeLastFired: Record<string, number>;
  // Systems-thinking archetypes the engine has already narrated this game
  // (Release 15). Each id (e.g. "limits-to-growth", "shifting-the-burden")
  // is appended once, the first tick its condition holds, so the log entry
  // fires exactly once per game. initialState seeds this to []; legacy saves
  // predate it and are backfilled to [] on load. See archetypes.ts.
  archetypesSeen: string[];
  // Named reputation thresholds (Release 17) the engine has already narrated
  // this game, mirroring archetypesSeen's once-only sticky pattern: each
  // milestone id is appended the first tick reputation reaches its
  // threshold and never un-fires on a later downward recross. initialState
  // seeds this to []; legacy saves predate it and are backfilled to [] in
  // save.ts's deserialize (content-free, like archetypesSeen). See
  // milestones.ts.
  milestonesSeen: string[];
  // Day the most recent challenge fired or queued a choice (either counts).
  // Absent until the first challenge event of the game. Drives the global
  // challengeSpacingDays gap in rollChallenges; expiry-default application
  // deliberately does NOT update this (it resolves existing business, not a
  // new event). Legacy saves predate this field; it stays undefined on load,
  // which is the correct "no gap active yet" state -- no defensive default
  // needed in save.ts.
  lastChallengeDay?: number;
}
