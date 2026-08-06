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
}

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
  // order. Used by challenge choice options (key-dev-poached let-them-go).
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

// Which shop section a decision renders under (see renderDecisions in
// src/ui/render.ts). Required on every decision so the shop can always
// group visible entries -- there is no "uncategorized" fallback.
export type DecisionCategory = "ship-faster" | "earn-income" | "tame-debt" | "prevent-trouble" | "change-structure";

export interface DecisionDef {
  id: string;
  name: string;
  description: string;
  tags: string[];
  category: DecisionCategory;
  human?: boolean;
  cost: { oneTime?: number; perDay?: number };
  incomePerDay?: number;
  effects: Effect[];
  gamble?: GambleOutcome[];
  requires?: string[];
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
    hasTag?: string;
    minTechDebt?: number;
    minDay?: number;
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
}

export interface ActiveProject {
  defId: string;
  name: string;
  remaining: number;
  payoutPerPoint: number;
  completionBonus: number;
  reputationReward: number;
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

export interface StartConfig {
  seed: number;
  stocks: Stocks;
  baseRates: Record<RateId, number>;
  debtMultiplier: number;
  baseBurnPerDay: number;
  contextSwitchFactor: number;
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
  };
  // Global minimum gap, in days, between any two challenges firing (effects
  // applied OR a choice queued -- either counts as "firing"). 0 disables
  // spacing entirely. See GameState.lastChallengeDay and rollChallenges.
  challengeSpacingDays: number;
  // Named reputation thresholds (Release 17), sorted ascending by
  // parseStartConfig's integrity check. See milestones.ts for detection.
  milestones: { id: string; reputation: number; name: string; message: string }[];
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
  // Tech-debt drag config, copied from content.start.debtDrag at init (the
  // contextSwitchFactor pattern). Legacy saves predate these three fields; the
  // Engine constructor backfills them from content. See debtDragMultiplier.
  debtDragFreeDebt: number;
  debtDragPerPoint: number;
  debtDragMaxDrag: number;
  modifiers: Modifier[];
  decisions: DecisionInstance[];
  projects: ActiveProject[];
  completedProjects: number;
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
