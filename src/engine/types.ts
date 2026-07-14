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
