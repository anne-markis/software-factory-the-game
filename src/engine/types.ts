export interface Stocks {
  backlog: number;
  inProgress: number;
  done: number;
  shipped: number;
  budget: number;
  techDebt: number;
}

export type RateId = "pull" | "finish" | "deploy";
export const RATE_IDS: readonly RateId[] = ["pull", "finish", "deploy"];

export type Effect =
  | { type: "modifyRate"; target: RateId | "all"; op: "add" | "mul"; value: number; durationDays?: number }
  | { type: "modifyDebtMultiplier"; op: "add" | "mul"; value: number; durationDays?: number }
  | { type: "addToStock"; stock: keyof Stocks; value: number }
  | { type: "sickness"; factor: number; durationDays: number }
  | { type: "rampRate"; target: RateId; perDay: number; cap: number }
  // Marker effect: no parameters, creates no modifier (see applyEffects).
  // Activation is derived from ownership -- see continuousDeployActive in
  // continuousDeploy.ts -- so this variant exists purely to be present or
  // absent in a decision def's effects list.
  | { type: "continuousDeploy" };

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
  // Global minimum gap, in days, between any two challenges firing (effects
  // applied OR a choice queued -- either counts as "firing"). 0 disables
  // spacing entirely. See GameState.lastChallengeDay and rollChallenges.
  challengeSpacingDays: number;
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
  // Day the most recent challenge fired or queued a choice (either counts).
  // Absent until the first challenge event of the game. Drives the global
  // challengeSpacingDays gap in rollChallenges; expiry-default application
  // deliberately does NOT update this (it resolves existing business, not a
  // new event). Legacy saves predate this field; it stays undefined on load,
  // which is the correct "no gap active yet" state -- no defensive default
  // needed in save.ts.
  lastChallengeDay?: number;
}
