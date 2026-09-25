export interface Stocks {
  backlog: number;
  inProgress: number;
  inReview: number;
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
  // Users (Studio spine): the product-growth stock. Stays 0 until
  // the Launch beta project completes (which grants +30 via
  // completionStockGrants), then grows via start.stockFlows organic
  // acquisition (gated on minCompletedProjects) and drives monetization
  // decisions that read it (incomeFromStock/burstFromStock). Above a free
  // band it also applies a support drag on delivery rates (start.stockDrags).
  // Clamped at 0 like every other stock.
  users: number;
  // Ideas: the idea-to-value pile. Seeded at 100 and filled by the
  // discover rate from day 0. Not a pipeline stage (tech-debt regen still
  // refills Ready). Clamped at 0 like every other stock.
  ideas: number;
  // Plan: sum of named Plan-item progress. Not a pipeline stage (tech-debt
  // regen still refills Ready). Seeded at 0; filled at the plan rate while
  // named items sit in GameState.plan. Clamped at 0 like every other stock.
  plan: number;
  // Morale: company-wide employee-loop quality stock. One number for every
  // hired human type. Recovers slowly, reputation only helps (never a
  // day-one drain for being unknown), low Oversight drains, hire quality
  // and incidents add/spend via addToStock. Low morale rolls quit on
  // active humans. Optional stockMax (Studio: 100) caps it. Clamped at 0.
  morale: number;
  // Oversight: company-wide agent-loop quality stock. Humans fill the
  // coverage ratio (founder counts); each agent leaks it. Harness and
  // orchestration scale those weights. Low Oversight bends agent finish
  // into tech debt and drains morale. Agents do not quit. Studio caps at 100.
  oversight: number;
}

export type StockName = keyof Stocks;

// Unshipped delivery stages. `backlog` here is the Ready queue (work waiting
// for a seat), not the cockpit "Backlog" hero metric — that reads the sum
// of these four (ADR 0009). `inProgress` is capacity (seats filled from
// Ready), not an unbounded queue. `inReview` is a Done-shaped waiting pile
// (review rate outflow); it stays on the line when continuous deploy drops
// Done. Shipped is excluded: it already left.
export const PIPELINE_STOCKS = ["backlog", "inProgress", "inReview", "done"] as const;
export type PipelineStock = (typeof PIPELINE_STOCKS)[number];

// Delivery-loop rates. RATE_IDS is the factory line; discover
// is a separate Ideas faucet and plan is a separate Plan-fill rate (neither
// is a pipeline stage). The Delivery diagram paints Ideas and Plan as
// count+capacity boxes left of Ready; pull/finish/review/deploy arrows stay
// realized flow. "all" / allRates modifiers and stock/debt drags apply to
// delivery rates only. Discover cards do not raise plan.
export type DeliveryRateId = "pull" | "finish" | "review" | "deploy";
export const RATE_IDS: readonly DeliveryRateId[] = ["pull", "finish", "review", "deploy"];
// ktlo is overhead reserved before contract finish. Like discover and plan,
// it is not on the delivery line: "all" modifiers and debt/users drags
// do not scale it. Cards change it by targeting "ktlo" exactly.
export type RateId = DeliveryRateId | "discover" | "plan" | "ktlo";

export type Effect =
  | {
      type: "modifyRate";
      target: RateId | "all";
      op: "add" | "mul";
      value: number;
      durationDays?: number;
      // Live multiplier on this add-op: contribution *= 1 + per * human headcount
      // (`DecisionInstance.human`). Ignored on mul. Studio agents use 0.1.
      scaleFromHumansPer?: number;
    }
  | { type: "modifyDebtMultiplier"; op: "add" | "mul"; value: number; durationDays?: number }
  | { type: "addToStock"; stock: keyof Stocks; value: number }
  | { type: "scaleStock"; stock: keyof Stocks; factor: number }
  | { type: "sickness"; factor: number; durationDays: number }
  | { type: "rampRate"; target: DeliveryRateId; perDay: number; cap: number }
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
  | { type: "removeHuman" }
  // In Progress capacity (seats). Same add-then-mul shape as rates. Not
  // scaled by sickness: a sick hire still occupies a seat.
  | { type: "modifyCapacity"; op: "add" | "mul"; value: number; durationDays?: number }
  // While the owning instance is active, addToStock grants of `stock` on
  // purchases of `targetDecision` use this factor instead of 1. Several
  // active owners: the purchase uses the highest factor. A factor below 1
  // shrinks the grant. Recorded on the instance when its effects land
  // (after delayDays), not while the hire is still joining.
  | { type: "scaleDecisionGrant"; targetDecision: string; stock: keyof Stocks; factor: number }
  // Marker on a decision's base effects. While an instance of that def is
  // active, the named contract is started whenever it is not already in
  // flight or in plan. applyEffects does nothing; the tick reads the def.
  | { type: "keepProject"; project: string }
  // While the owning instance is active, it may pursue one listed project
  // with no click. projectIds is preference order: the first offerable id
  // is the one they wait on. One instance, one slot (Plan or in flight).
  | {
      type: "autoSchedule";
      projectIds: string[];
      ideaCostFactor: number;
      cashReserve: number;
      skipWhenBurnExceedsIncome: boolean;
    }
  // Temporary KTLO cash. perDay may be negative (a credit). durationDays is
  // required so this stays a spike or a dip, not a second copy of ktloPerDay.
  | { type: "modifyKtloCash"; perDay: number; durationDays: number }
  // Ends this company. The engine replaces the run with a new one whose
  // budget is the treasury plus budgetGrant, in the highest era that
  // treasury already qualifies for. Not applied as a stock effect.
  | { type: "sellCompany"; budgetGrant: number };

export interface AutoSchedulePolicy {
  projectIds: string[];
  ideaCostFactor: number;
  cashReserve: number;
  skipWhenBurnExceedsIncome: boolean;
}

export interface StockGrantScale {
  targetDecision: string;
  stock: keyof Stocks;
  factor: number;
}

export type ModifierTarget = RateId | "allRates" | "debtMultiplier" | "capacity" | "ktloCash";

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
  // Copied from modifyRate.scaleFromHumansPer. Live: not locked at purchase.
  scaleFromHumansPer?: number;
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

// Closed enum on every decision (schema). The shop no longer paints a
// player-facing category tag; keep the field for authoring.
// The shop is a flat list and does not group by this field.
export type DecisionCategory = "ship-faster" | "earn-income" | "tame-debt" | "prevent-trouble" | "change-structure";

// Additive stock-flow modifier (ADR 0006). Nudges an existing
// start.stockFlows entry for the named stock: deltas are summed each tick
// and added to that flow's acquirePerDay / churnRatePerDay. Sources:
// owned decisions, and completed projects (one application per
// completedProjectIds entry). Studio decisions ship none; Ship v1 and
// each Ship next feature use this so shipping a product raises
// acquire instead of landing on the churn cap.
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
  // Headcount flag for agent:human ratio drains (start.headcountRatioDrags).
  // Copied onto the instance like `human`. Coding-agent copies set this;
  // harness / orchestration do not — they are not extra agents.
  agent?: boolean;
  // Calendar days after purchase before this instance is active: no
  // effects, capacity, payroll, or headcount until `day + delayDays`.
  // Gamble still resolves at purchase. Omit for immediate cards.
  delayDays?: number;
  // In Progress seats this instance adds while owned. Omitted is 0. Not
  // keyed off `human`: a later card may grant capacity from other owned
  // ids (see capacityFromOwned) without those ids being people.
  capacity?: number;
  // While this card is owned, add `per` capacity for each owned instance of
  // `id`. Evaluated once per owning def, not per copy. Studio ships none;
  // kept so a later card can make agents add seats without renaming `agent`.
  capacityFromOwned?: { id: string; per: number }[];
  cost: { oneTime?: number; perDay?: number };
  // Extra Keep-the-lights-on cash per active instance. Charged with the
  // permanent project's perDay, not as this card's payroll. Pending hires
  // (delayDays) do not pay it until they start. Omit for no surcharge.
  ktloPerDay?: number;
  incomePerDay?: number;
  // Per-day income scaled by a stock's current level (Studio monetization). Stacks additively on top of the flat incomePerDay in
  // chargeUpkeep: totalIncome += stocks[stock] * perUnit. The subscription
  // card reads users at $0.75/user/day; useless at 0 users.
  incomeFromStock?: { stock: StockName; perUnit: number };
  // Per-unit probabilistic sales (Studio monetization). Each point of
  // stock independently rolls probabilityPerDay; each success credits
  // perUnit (one sale). Expected income is still stocks[stock] *
  // probabilityPerDay * perUnit. The one-time-product card reads users.
  burstFromStock?: { stock: StockName; probabilityPerDay: number; perUnit: number };
  // Additive nudges to start.stockFlows (ADR 0006). Studio decisions ship
  // none; the engine sums deltas from owned decisions when present.
  stockFlowMods?: StockFlowMod[];
  // Multipliers on the Oversight coverage weights. Watch scales how much
  // each human covers; leak scales how hard each agent pulls the stock down.
  // Studio: harness slows the leak, orchestration raises the watch.
  oversightMods?: { watchMul?: number; leakMul?: number };
  effects: Effect[];
  gamble?: GambleOutcome[];
  requires?: string[];
  // Ownership gates that count instances rather than just presence: each entry demands at least `count` owned instances of `id`. Used by
  // agent-orchestration, which only makes sense once there are >= 2 agents to
  // coordinate. Composes with `requires` (both must hold); ids are
  // cross-checked by parseDecisions like `requires` ids are.
  requiresCounts?: { id: string; count: number }[];
  removable: boolean;
  unique?: boolean; // at most one owned instance at a time
  synergies?: Synergy[];
  // While an active instance of this def is owned, purchasing `id` uses this
  // gamble table instead of that card's own (full replace, same as Synergy.gamble).
  // The buyer's own synergies win when one of those providers is owned.
  // Pending (not yet started) copies do not count.
  replacesGamble?: { id: string; gamble: GambleOutcome[] }[];
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
  // Headcount flag copied from DecisionDef.human. effectiveRate counts these
  // for scaleFromHumansPer so modifiers stay content-free. The founder seat
  // is not an instance, so it does not count. Pending (not yet active)
  // humans still carry the flag; roster helpers skip them until arrival.
  human?: boolean;
  // Copied from DecisionDef.agent. Ratio drains count these, not id prefixes.
  agent?: boolean;
  // First day this instance is active. Absent means active from purchase
  // (legacy saves and cards without delayDays). Pending while day < this.
  activeOnDay?: number;
  // Effects rolled at purchase (base + gamble) to apply on the activation
  // tick. Deleted after they land. Absent on immediate purchases.
  pendingEffects?: Effect[];
  // scaleDecisionGrant outcomes from the effects that already landed.
  // Absent until activation, so a hire who has not started does not scale
  // anyone else's grants.
  grantScales?: StockGrantScale[];
  // autoSchedule outcome from the effects that already landed. Absent until
  // activation, so a hire who has not started does not queue work.
  autoSchedule?: AutoSchedulePolicy;
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
    // Completed-project floor: the challenge only fires once the
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

// Always-on overhead (Keep the lights on). Not a contract: no remaining,
// no payout, no offer row. Present from Studio, inherited after that.
// Cards scale basePerDay via modifyRate target "ktlo". perDay is the flat
// cash drain. hostingTiers add one flat hosting bill for the highest band
// the current user count qualifies for, and drop back when users do.
export interface HostingTier {
  minUsers: number;
  perDay: number;
}

export interface PermanentProjectDef {
  id: string;
  name: string;
  permanent: true;
  basePerDay: number;
  perDay: number;
  hostingTiers?: HostingTier[];
}

export interface ContractProjectDef {
  id: string;
  name: string;
  permanent?: false;
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
  // another catalog id). Studio's critical path uses this so gigs cannot
  // skip the product: Ship v1 requires launch-beta, Ship next feature
  // requires ship-v1. Checked against state.completedProjectIds after the
  // completed-count floor.
  requiresCompletedId?: string;
  // When true, the project cannot be started again after it has completed
  // (or while it is already in flight). Ship v1 is unique; Ship next
  // feature and tiny client gigs omit this and stay repeatable. Default false.
  unique?: boolean;
  // When true, plan + in-flight copies may reach the active era's
  // parallelCopies (default 1). The offer stays one row. Omit means one copy.
  parallel?: boolean;
  // When true, the offer is Pursue (spend Ideas, enter Plan). Omit or false
  // is Start (no Ideas spend, write Ready immediately). Default must stay
  // Start so inherited gigs do not silently Pursue.
  pursue?: boolean;
  // Ideas spent on Pursue. Independent of sizePoints (effort / Plan size).
  // Omit on a Pursue offer to spend sizePoints, matching older catalog cards
  // written before the two numbers were split.
  ideaCost?: number;
  // Stocks granted on completion (Studio spine). Applied in
  // attributeShipped's completion branch alongside the budget/reputation
  // rewards. The Launch beta grants +30 users this way, which is what starts
  // the users economy (users stay 0 until then). Clamped at 0 like every
  // other stock write.
  completionStockGrants?: { stock: StockName; amount: number }[];
  // Acquire/churn nudges applied once per completedProjectIds entry for
  // this id (same shape as DecisionDef.stockFlowMods). Not applied while
  // in-flight. Ship v1 records one entry; each Ship next feature
  // completion records another, so organic user acquire stacks per ship
  // instead of filling the reputation-driven cap in one lump.
  stockFlowMods?: StockFlowMod[];
}

export type ProjectDef = ContractProjectDef | PermanentProjectDef;

export function isPermanentProject(def: ProjectDef): def is PermanentProjectDef {
  return def.permanent === true;
}

export function isContractProject(def: ProjectDef): def is ContractProjectDef {
  return def.permanent !== true;
}

export function requireContract(def: ProjectDef | undefined): ContractProjectDef {
  if (!def || !isContractProject(def)) {
    throw new Error(`${def?.id ?? "project"} is not a contract`);
  }
  return def;
}

// Named work sitting in Plan after Pursue, before auto-Ready. progress
// counts toward size at the plan rate split evenly across items.
export interface PlanItem {
  defId: string;
  // Distinguishes copies of the same def. Cancel targets this, not defId.
  // Omitted on hand-built fixtures; Engine assigns one before play.
  instanceId?: string;
  name: string;
  progress: number;
  size: number;
  // Decision instance that queued this item. Absent on player pursues.
  // Kept until the item leaves Plan so that manager's slot stays taken.
  scheduledBy?: string;
}

export interface ActiveProject {
  defId: string;
  // Distinguishes copies of the same def. Abandon targets this, not defId.
  // Omitted on hand-built fixtures; Engine assigns one before play.
  instanceId?: string;
  name: string;
  // Unshipped points still owed on this contract (ADR 0009). Extra pipeline
  // inflow (debt refill, scope creep, addToStock/scaleStock on a pipeline
  // stock) attaches to one in-flight remaining (this one if it is the only
  // contract; otherwise engine-picked) so remaining tracks the work, not a
  // parallel ship-countdown. Completes at ~0 in attributeShipped, or when
  // remaining falls below PROJECT_DISPLAY_GRAIN (the 1-decimal UI already
  // paints that as "0 left").
  remaining: number;
  payoutPerPoint: number;
  completionBonus: number;
  reputationReward: number;
  // Copied from ProjectDef.completionStockGrants (or StartConfig.
  // initialProject.completionStockGrants for the starting project) when the
  // project is started/seeded, so completion pays the grants recorded at
  // start time even if content changes mid-game. Absent = no stock grants.
  completionStockGrants?: { stock: StockName; amount: number }[];
  // Copied from Plan when auto-Ready. Holds the scheduling manager's slot
  // until this contract completes or is abandoned.
  scheduledBy?: string;
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

// One tick of decision income, split by how it was credited. Recurring is
// flat incomePerDay plus incomeFromStock; burst is burstFromStock hits.
// The Events log does not record these receipts (purchasing the card still
// does). Capped on GameState.incomeByDay.
export interface DailyIncome {
  day: number;
  recurring: number;
  burst: number;
}

// One tick of cash drain, split for the Expenses sparkline. human is
// owned `human` payroll; agents is the agent stack (copies plus harness /
// orchestration / agent-CI-review); ktlo is Keep the lights on plus any
// other non-human, non-agent perDay. Capped on GameState.expensesByDay.
export interface DailyExpenses {
  day: number;
  human: number;
  agents: number;
  ktlo: number;
}

// Always-on stock drag (Studio spine / ADR 0006). Mirrors the
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

// Always-on per-tick stock flow (Studio spine / ADR 0006). Runs in
// tick.ts after shipping. When its condition holds, the stock gains
// acquirePerDay (flat) plus acquirePerStock.perUnit per point of another
// stock (the organic users flow reads reputation), then loses
// stocks[stock] * churnRatePerDay to churn. Net is clamped at 0. Base churn
// only -- no debt/incident churn DSL in this schema.
export interface StockFlow {
  stock: StockName;
  // Studio organic acquisition only turns on after the Launch beta completes.
  condition?: { minCompletedProjects?: number };
  acquirePerDay?: number;
  acquirePerStock?: { stock: StockName; perUnit: number };
  churnRatePerDay?: number;
}

export type HeadcountFlag = "human" | "agent";

// Coverage ratio for the agent loop, read from content at tick time.
// Target = 100 * watch / (watch + leak), where watch is humans (founder
// counts) times perHuman and leak is agents times perAgent. Owned
// oversightMods multiply those weights. approachPerDay is how much of the
// gap to that target closes each tick (1 snaps). Below offPolicyBelow, a
// share of agent finish is added as tech debt. Below moraleLeakBelow, morale
// loses (band - oversight) / moraleLeakScale per day.
export interface OversightConfig {
  perHuman: number;
  perAgent: number;
  offPolicyBelow: number;
  moraleLeakBelow: number;
  moraleLeakScale: number;
  approachPerDay: number;
}

// Always-on drain: when flagged-instance ratio exceeds freeBand, subtract
// drainPerExcess * (ratio - freeBand) from `stock` each tick. Studio uses
// this for agent:human overload on morale. FounderCounts adds 1 to the
// denominator (the founder is a human, not a DecisionInstance). Pending
// instances do not count. Numbers live in start.json.
export interface HeadcountRatioDrag {
  stock: StockName;
  numerator: HeadcountFlag;
  denominator: HeadcountFlag;
  founderCounts: boolean;
  freeBand: number;
  drainPerExcess: number;
}

// Per-tick independent quit roll on each active instance with `flag`.
// p = 0 at stock >= safeBand; p = maxRatePerDay at stock 0; linear between.
// Studio: morale, human, safeBand 40, max 2%/day. Not a stock drain.
export interface InstanceChurn {
  stock: StockName;
  flag: HeadcountFlag;
  safeBand: number;
  maxRatePerDay: number;
}

export interface StartConfig {
  seed: number;
  stocks: Stocks;
  baseRates: Record<RateId, number>;
  // Founder In Progress seats. Hires add more via DecisionDef.capacity;
  // agents do not (they only change finish speed). See effectiveCapacity.
  baseCapacity: number;
  debtMultiplier: number;
  contextSwitchFactor: number;
  // Always-on stock drags (Studio support drag). Copied into GameState at
  // init like debtDrag, so effectiveRate can apply them without content.
  // Optional: content may omit; treated as [] when absent.
  stockDrags?: StockDrag[];
  // Always-on stock flows (Studio organic user acquisition). Read from content
  // at tick time (tick has content). Optional; treated as [] when absent.
  stockFlows?: StockFlow[];
  // Optional per-stock ceilings. applyEffects / flows / grants clamp to
  // these after the 0-floor. Studio caps morale at 100. Copied onto
  // GameState at init so applyEffects stays content-free.
  stockMax?: Partial<Record<StockName, number>>;
  // Always-on headcount-ratio drains. Read from content at tick time.
  // Optional; treated as [] when absent. Studio morale no longer uses this;
  // low Oversight is the morale drain.
  headcountRatioDrags?: HeadcountRatioDrag[];
  // Agent-loop coverage. Optional; when omitted the stock stays put.
  oversight?: OversightConfig;
  // Always-on per-instance quit rolls (Studio morale → human quit).
  // Read from content at tick time. Optional; treated as [] when absent.
  instanceChurn?: InstanceChurn[];
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
  // Decision ids owned at the start of a new game, without paying oneTime.
  // Missing ids are skipped so a fixture catalog can omit them.
  grantedDecisionIds?: string[];
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
  // How many copies of a parallel project may sit in plan and in flight
  // together. Omit means 1. Ship next feature is the shipped parallel offer.
  parallelCopies?: number;
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
  // Offer ids dropped at this rung and inherited after it. The def stays in
  // `projects` so an in-flight contract can still finish. Absent on fixtures.
  retiredProjectIds?: readonly string[];
  // Active era id + catalog from content/eras.json. Resolved
  // decisions/challenges/projects include every prior rung (ADR 0008).
  // Always set by loadShippedContent / loadActiveContent. Optional on
  // hand-built test fixtures so unit tests can keep assembling partial graphs.
  eraId?: string;
  eras?: ErasConfig;
}

export interface GameState {
  day: number;
  paused: boolean;
  // Active content era id. Copied from GameContent.eraId at init.
  // Advances one-way when the next era's entryAnyOf fires (see eras.ts).
  // Legacy saves predate the field; Engine backfills from content.eraId.
  eraId: string;
  stocks: Stocks;
  baseRates: Record<RateId, number>;
  baseCapacity: number;
  debtMultiplierBase: number;
  contextSwitchFactor: number;
  // Tech-debt drag config, copied from content.start.debtDrag at init (the
  // contextSwitchFactor pattern). Legacy saves predate these three fields; the
  // Engine constructor backfills them from content. See debtDragMultiplier.
  debtDragFreeDebt: number;
  debtDragPerPoint: number;
  debtDragMaxDrag: number;
  // Always-on stock drags (Studio support drag), copied from
  // content.start.stockDrags at init like the debtDrag config above so
  // effectiveRate stays content-free. Legacy saves predate it; the Engine
  // constructor backfills from content (and the SAVE_VERSION bump means old
  // saves are wiped anyway). Empty when content ships none.
  stockDrags: StockDrag[];
  modifiers: Modifier[];
  decisions: DecisionInstance[];
  projects: ActiveProject[];
  // Named Plan items (Pursue → Plan → auto-Ready). Empty means the 1/day
  // plan capacity is unused. Legacy saves predate the field; Engine
  // backfills [] (and stocks.plan / baseRates.plan from content).
  plan: PlanItem[];
  completedProjects: number;
  // One entry per project completion (the start project plus catalog
  // defs). requiresCompletedId and unique only test presence. Repeatable
  // ships append again so stockFlowMods stack per completion. initialState
  // seeds []; deserialize backfills [] on current-version hand-built states.
  completedProjectIds: string[];
  pendingChoices: PendingChoice[];
  log: LogEntry[];
  // last N days of decision income by type (see INCOME_HISTORY_DAYS in
  // tick.ts). Feeds the collapsible Income chart; not an Events stream.
  // initialState seeds []; deserialize backfills [] on current-version
  // hand-built states. Quiet days are stored as zeros so the sparkline
  // keeps a stable span.
  incomeByDay: DailyIncome[];
  // last N days of burn by type (same cap as incomeByDay). Feeds the
  // collapsible Expenses chart under Income. initialState seeds [];
  // deserialize backfills [] on current-version hand-built states.
  expensesByDay: DailyExpenses[];
  pointsPerDay: number;
  // Realized flow this tick. pointsPerDay is shippedFlow (Done → Shipped).
  // finishFlow is how much left the Ready+In Progress pool into In Review.
  // reviewFlow is how much left In Review into Done.
  // pullFlow is how much left Ready (seats filling plus work that finished
  // from Ready the same day). In Progress itself is capacity, not a queue.
  pullFlow: number;
  finishFlow: number;
  reviewFlow: number;
  // Realized users-loop flows this tick (mirrors pullFlow for the product
  // economy). userAcquireFlow is gross organic gain; userChurnFlow is the
  // amount leaving; userIncomeFlow is budget credited from decisions that
  // read the users stock (incomeFromStock + burstFromStock). 0 when the
  // users flow is gated off (pre-launch) or no monetization fired.
  userAcquireFlow: number;
  userChurnFlow: number;
  userIncomeFlow: number;
  // Realized employee-loop flows this tick. moraleRecoverFlow is the flat
  // acquirePerDay on the morale stockFlow; moralePrideFlow is the
  // acquirePerStock (reputation) term — help only, never negative.
  // moraleOverloadFlow is the Oversight → morale drain (0 while Oversight
  // stays above the leak band). employeeQuitRate is the per-human quit
  // probability used this tick.
  moraleRecoverFlow: number;
  moralePrideFlow: number;
  moraleOverloadFlow: number;
  employeeQuitRate: number;
  // Agent-loop weights this tick (diagram labels, not the net stock delta).
  // oversightOffPolicy is the share of agent finish added as tech debt.
  oversightWatch: number;
  oversightLeak: number;
  oversightOffPolicy: number;
  // Optional per-stock ceilings, copied from start.stockMax at init.
  // applyEffects clamps writes through clampStock. {} when content omits.
  stockMax: Partial<Record<StockName, number>>;
  nextInstanceId: number;
  // Next suffix for project instance ids (`proj-N`). Engine backfills when
  // a hand-built state omits it.
  nextProjectInstanceId: number;
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
