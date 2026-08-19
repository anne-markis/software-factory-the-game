import { z } from "zod";
import type {
  StartConfig,
  DecisionDef,
  ChallengeDef,
  ProjectDef,
  GameContent,
  ErasConfig,
  EraDef,
} from "./types";

// Schemas are .strict(): content files are hand-edited, so unknown or
// typo'd keys must fail loudly instead of being silently stripped.
const stocksSchema = z
  .object({
    backlog: z.number().min(0),
    inProgress: z.number().min(0),
    done: z.number().min(0),
    shipped: z.number().min(0),
    // budget: unconstrained here; runtime clamping is the engine's job.
    budget: z.number(),
    techDebt: z.number().min(0),
    reputation: z.number().min(0),
    users: z.number().min(0),
  })
  .strict();

const milestoneSchema = z
  .object({
    id: z.string(),
    reputation: z.number().min(0),
    name: z.string(),
    message: z.string(),
  })
  .strict();

const rateTarget = z.enum(["pull", "finish", "deploy", "all"]);
const stockName = z.enum(["backlog", "inProgress", "done", "shipped", "budget", "techDebt", "reputation", "users"]);

// Stocks granted on project completion (Studio spine, issue #88). Shared by
// ProjectDef and StartConfig.initialProject.
const completionStockGrantsSchema = z
  .array(z.object({ stock: stockName, amount: z.number() }).strict())
  .optional();

const startSchema = z
  .object({
    seed: z.number().int(),
    stocks: stocksSchema,
    baseRates: z
      .object({ pull: z.number().min(0), finish: z.number().min(0), deploy: z.number().min(0) })
      .strict(),
    debtMultiplier: z.number().min(0),
    baseBurnPerDay: z.number().min(0),
    contextSwitchFactor: z.number().gt(0).lte(1),
    // freeDebt >= 0 (grace band), dragPerPoint > 0 (drag must actually bite),
    // maxDrag in (0, 1) (a cap that neither vanishes nor stalls throughput).
    debtDrag: z
      .object({
        freeDebt: z.number().min(0),
        dragPerPoint: z.number().gt(0),
        maxDrag: z.number().gt(0).lt(1),
      })
      .strict(),
    // Always-on stock drags (Studio support drag, issue #88). freeBand >= 0,
    // dragPerPoint > 0 (must bite), maxDrag in (0, 1) (a cap that neither
    // vanishes nor stalls throughput -- same bounds as debtDrag).
    stockDrags: z
      .array(
        z
          .object({
            stock: stockName,
            freeBand: z.number().min(0),
            dragPerPoint: z.number().gt(0),
            maxDrag: z.number().gt(0).lt(1),
            target: rateTarget,
          })
          .strict(),
      )
      .optional(),
    // Always-on stock flows (Studio organic acquisition, issue #88).
    stockFlows: z
      .array(
        z
          .object({
            stock: stockName,
            condition: z.object({ minCompletedProjects: z.number().int().min(0).optional() }).strict().optional(),
            acquirePerDay: z.number().min(0).optional(),
            acquirePerStock: z.object({ stock: stockName, perUnit: z.number() }).strict().optional(),
            churnRatePerDay: z.number().min(0).optional(),
          })
          .strict(),
      )
      .optional(),
    initialProject: z
      .object({
        id: z.string(),
        name: z.string(),
        sizePoints: z.number().positive(),
        payoutPerPoint: z.number().min(0),
        completionBonus: z.number().min(0),
        reputationReward: z.number().min(0),
        completionStockGrants: completionStockGrantsSchema,
      })
      .strict(),
    challengeSpacingDays: z.number().int().min(0),
    milestones: z.array(milestoneSchema),
  })
  .strict();

function fail(file: string, error: z.ZodError): never {
  const detail = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid content in ${file}: ${detail}`);
}

export function parseStartConfig(json: unknown): StartConfig {
  const result = startSchema.safeParse(json);
  if (!result.success) fail("content/start.json", result.error);
  const cfg = result.data;
  // Integrity checks the schema alone cannot express: milestone ids must be
  // unique (detectMilestones' seen-set keys on id) and thresholds must be
  // strictly ascending (milestones.ts relies on no ordering assumption today,
  // but ascending, non-duplicate thresholds are the only sane authoring
  // shape -- catch a mis-ordered or duplicated content edit at load time).
  const seenIds = new Set<string>();
  let prevReputation = -Infinity;
  for (const m of cfg.milestones) {
    if (seenIds.has(m.id)) {
      throw new Error(`Invalid content in content/start.json: duplicate milestone id "${m.id}"`);
    }
    seenIds.add(m.id);
    if (m.reputation <= prevReputation) {
      throw new Error(
        `Invalid content in content/start.json: milestone "${m.id}" reputation ${m.reputation} is not strictly ascending`,
      );
    }
    prevReputation = m.reputation;
  }
  return cfg;
}

const effectSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("modifyRate"),
      target: rateTarget,
      op: z.enum(["add", "mul"]),
      value: z.number(),
      durationDays: z.number().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("modifyDebtMultiplier"),
      op: z.enum(["add", "mul"]),
      value: z.number(),
      durationDays: z.number().positive().optional(),
    })
    .strict(),
  z.object({ type: z.literal("addToStock"), stock: stockName, value: z.number() }).strict(),
  // factor >= 0: 0 wipes the stock entirely; > 1 is allowed for future
  // content (e.g. a challenge doubling backlog), not just reductions.
  z.object({ type: z.literal("scaleStock"), stock: stockName, factor: z.number().min(0) }).strict(),
  z.object({ type: z.literal("sickness"), factor: z.number().gt(0).lt(1), durationDays: z.number().positive() }).strict(),
  // target excludes "all": a ramp grows one rate's own modifier, not a shared one.
  z
    .object({
      type: z.literal("rampRate"),
      target: z.enum(["pull", "finish", "deploy"]),
      perDay: z.number().positive(),
      cap: z.number().positive(),
    })
    .strict(),
  // No parameters: presence in a def's effects list is the whole signal.
  z.object({ type: z.literal("continuousDeploy") }).strict(),
  // No parameters: strips one human developer instance at apply time.
  z.object({ type: z.literal("removeHuman") }).strict(),
]);

const gambleOutcomeSchema = z
  .object({ probability: z.number().gt(0).lte(1), label: z.string(), effects: z.array(effectSchema) })
  .strict();

const decisionCategory = z.enum(["ship-faster", "earn-income", "tame-debt", "prevent-trouble", "change-structure"]);

const decisionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    category: decisionCategory,
    human: z.boolean().optional(),
    cost: z.object({ oneTime: z.number().min(0).optional(), perDay: z.number().min(0).optional() }).strict(),
    incomePerDay: z.number().min(0).optional(),
    // Studio monetization (issue #85): income scaled by a stock's level.
    incomeFromStock: z.object({ stock: stockName, perUnit: z.number().min(0) }).strict().optional(),
    burstFromStock: z
      .object({ stock: stockName, probabilityPerDay: z.number().min(0).max(1), perUnit: z.number().min(0) })
      .strict()
      .optional(),
    // Forward-compat additive stock-flow nudges (ADR 0006). Studio ships none.
    stockFlowMods: z
      .array(
        z
          .object({
            stock: stockName,
            acquirePerDayDelta: z.number().optional(),
            churnRateDelta: z.number().optional(),
          })
          .strict(),
      )
      .optional(),
    effects: z.array(effectSchema),
    gamble: z.array(gambleOutcomeSchema).optional(),
    requires: z.array(z.string()).optional(),
    // count >= 1: a 0-count gate is always satisfied, which is content noise
    // rather than a gate (omit the entry instead).
    requiresCounts: z
      .array(z.object({ id: z.string(), count: z.number().int().min(1) }).strict())
      .optional(),
    removable: z.boolean(),
    unique: z.boolean().optional(),
    synergies: z
      .array(
        z
          .object({ ifOwned: z.string(), effects: z.array(effectSchema).optional(), gamble: z.array(gambleOutcomeSchema).optional() })
          .strict(),
      )
      .optional(),
  })
  .strict();

export function parseDecisions(json: unknown, source = "content/decisions.json"): DecisionDef[] {
  const result = z.array(decisionSchema).safeParse(json);
  if (!result.success) fail(source, result.error);
  // plain annotation (no cast) so schema/type drift fails compilation here
  const defs: DecisionDef[] = result.data;
  const ids = new Set<string>();
  for (const def of defs) {
    if (ids.has(def.id)) {
      throw new Error(`Invalid content in ${source}: duplicate decision id "${def.id}"`);
    }
    ids.add(def.id);
  }
  for (const def of defs) {
    if (def.gamble) {
      const total = def.gamble.reduce((sum, o) => sum + o.probability, 0);
      if (Math.abs(total - 1) > 1e-9) {
        throw new Error(`Invalid content in ${source}: gamble for "${def.id}" sums to ${total}, expected 1`);
      }
    }
    for (const req of def.requires ?? []) {
      if (!ids.has(req)) throw new Error(`Invalid content in ${source}: "${def.id}" requires unknown id "${req}"`);
    }
    for (const req of def.requiresCounts ?? []) {
      if (!ids.has(req.id)) {
        throw new Error(`Invalid content in ${source}: "${def.id}" requiresCounts references unknown id "${req.id}"`);
      }
      // A count gate above 1 on a unique decision can never be satisfied.
      const target = defs.find((d) => d.id === req.id)!;
      if (target.unique && req.count > 1) {
        throw new Error(
          `Invalid content in ${source}: "${def.id}" requiresCounts ${req.count}x "${req.id}", which is unique (at most 1 can be owned)`,
        );
      }
    }
    for (const syn of def.synergies ?? []) {
      if (!ids.has(syn.ifOwned)) throw new Error(`Invalid content in ${source}: "${def.id}" synergy references unknown id "${syn.ifOwned}"`);
    }
  }
  return defs;
}

const choiceOptionSchema = z.object({ id: z.string(), label: z.string(), effects: z.array(effectSchema) }).strict();

const challengeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    probabilityPerDay: z.number().min(0).max(1),
    perHumanDev: z.boolean().optional(),
    condition: z
      .object({
        minHumanDevs: z.number().int().min(0).optional(),
        maxHumanDevs: z.number().int().min(0).optional(),
        minTechDebt: z.number().min(0).optional(),
        minDay: z.number().int().min(0).optional(),
        minCompletedProjects: z.number().int().min(0).optional(),
        requiresAnyDecision: z.array(z.string()).min(1).optional(),
        lacksDecision: z.string().optional(),
      })
      .strict()
      .optional(),
    probScaling: z.object({ stat: z.literal("techDebt"), per: z.number().positive(), add: z.number().min(0) }).strict().optional(),
    effects: z.array(effectSchema),
    choice: z
      .object({ expiresInDays: z.number().int().positive(), defaultOptionId: z.string(), options: z.array(choiceOptionSchema).min(1) })
      .strict()
      .optional(),
    cooldownDays: z.number().int().positive().optional(),
  })
  .strict();

export function parseChallenges(json: unknown, source = "content/challenges.json"): ChallengeDef[] {
  const result = z.array(challengeSchema).safeParse(json);
  if (!result.success) fail(source, result.error);
  const defs: ChallengeDef[] = result.data;
  const ids = new Set<string>();
  for (const def of defs) {
    if (ids.has(def.id)) {
      throw new Error(`Invalid content in ${source}: duplicate challenge id "${def.id}"`);
    }
    ids.add(def.id);
    if (def.choice && !def.choice.options.some((o) => o.id === def.choice!.defaultOptionId)) {
      throw new Error(`Invalid content in ${source}: "${def.id}" default option "${def.choice.defaultOptionId}" not found`);
    }
    // the engine queues the choice and never applies top-level effects, so both set = silent content loss
    if (def.choice && def.effects.length > 0) {
      throw new Error(`Invalid content in ${source}: "${def.id}" has both a choice and top-level effects; effects would be silently ignored`);
    }
    // a sickness effect needs a per-human-dev roll to target an instance; without it the effect no-ops
    if (def.effects.some((e) => e.type === "sickness") && !def.perHumanDev) {
      throw new Error(`Invalid content in ${source}: "${def.id}" has a sickness effect but perHumanDev is not true`);
    }
    // removeHuman on a choice option needs at least one human on staff when the
    // choice can fire; otherwise the effect silently no-ops and "lose them"
    // copy would lie. Top-level (non-choice) removeHuman is allowed without
    // this gate because fire() only runs after conditionMet.
    const choiceHasRemoveHuman = def.choice?.options.some((o) => o.effects.some((e) => e.type === "removeHuman")) ?? false;
    if (choiceHasRemoveHuman && (def.condition?.minHumanDevs ?? 0) < 1) {
      throw new Error(
        `Invalid content in ${source}: "${def.id}" has a removeHuman choice effect but condition.minHumanDevs is missing or < 1`,
      );
    }
  }
  return defs;
}

const projectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    sizePoints: z.number().positive(),
    upfrontCost: z.number().min(0),
    payoutPerPoint: z.number().min(0),
    completionBonus: z.number().min(0),
    requiresCompleted: z.number().int().min(0).optional(),
    reputationReward: z.number().min(0),
    requiresReputation: z.number().min(0).optional(),
    completionStockGrants: completionStockGrantsSchema,
  })
  .strict();

export function parseProjects(json: unknown, source = "content/projects.json"): ProjectDef[] {
  const result = z.array(projectSchema).safeParse(json);
  if (!result.success) fail(source, result.error);
  // plain annotation (no cast) so schema/type drift fails compilation here
  const defs: ProjectDef[] = result.data;
  const ids = new Set<string>();
  for (const def of defs) {
    if (ids.has(def.id)) {
      throw new Error(`Invalid content in ${source}: duplicate project id "${def.id}"`);
    }
    ids.add(def.id);
  }
  return defs;
}

const eraEntryPredicateSchema = z
  .object({
    minBudget: z.number().min(0).optional(),
    minReputation: z.number().min(0).optional(),
    minCompletedProjects: z.number().int().min(0).optional(),
    minUsers: z.number().min(0).optional(),
  })
  .strict()
  .refine(
    (p) =>
      p.minBudget !== undefined ||
      p.minReputation !== undefined ||
      p.minCompletedProjects !== undefined ||
      p.minUsers !== undefined,
    { message: "entry predicate must set at least one threshold" },
  );

const eraDefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    entryAnyOf: z.array(eraEntryPredicateSchema).min(1).optional(),
    silentEntry: z.boolean().optional(),
  })
  .strict();

const erasConfigSchema = z
  .object({
    startingEraId: z.string().min(1),
    eras: z.array(eraDefSchema).min(1),
  })
  .strict();

export function parseErasConfig(json: unknown, source = "content/eras.json"): ErasConfig {
  const result = erasConfigSchema.safeParse(json);
  if (!result.success) fail(source, result.error);
  const cfg: ErasConfig = result.data;
  const ids = new Set<string>();
  for (const era of cfg.eras) {
    if (ids.has(era.id)) {
      throw new Error(`Invalid content in ${source}: duplicate era id "${era.id}"`);
    }
    ids.add(era.id);
  }
  if (!ids.has(cfg.startingEraId)) {
    throw new Error(
      `Invalid content in ${source}: startingEraId "${cfg.startingEraId}" is not listed in eras`,
    );
  }
  // Starting era must not require entry criteria — the player begins there.
  const starting = cfg.eras.find((e) => e.id === cfg.startingEraId)!;
  if (starting.entryAnyOf !== undefined) {
    throw new Error(
      `Invalid content in ${source}: starting era "${starting.id}" must not declare entryAnyOf`,
    );
  }
  return cfg;
}

export type EraBundleJson = {
  decisions: unknown;
  challenges: unknown;
  projects: unknown;
};

// Merge start + one era's decision/challenge/project JSON into GameContent.
// This function never advances eras. Engine.tick evaluates entryAnyOf and
// reloads via a loader; it does not hardcode era names.
export function loadActiveContent(
  startJson: unknown,
  erasJson: unknown,
  bundlesByEraId: Record<string, EraBundleJson>,
  eraId?: string,
): GameContent {
  const eras = parseErasConfig(erasJson);
  const activeId = eraId ?? eras.startingEraId;
  const era: EraDef | undefined = eras.eras.find((e) => e.id === activeId);
  if (!era) {
    throw new Error(`Unknown era id "${activeId}" (not listed in content/eras.json)`);
  }
  const bundle = bundlesByEraId[activeId];
  if (!bundle) {
    throw new Error(`No content bundle registered for era "${activeId}"`);
  }
  const base = `content/eras/${activeId}`;
  const content: GameContent = {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(bundle.decisions, `${base}/decisions.json`),
    challenges: parseChallenges(bundle.challenges, `${base}/challenges.json`),
    projects: parseProjects(bundle.projects, `${base}/projects.json`),
    eraId: activeId,
    eras,
  };
  validateContentGraph(content);
  return content;
}

// Cross-file integrity check that parseChallenges cannot perform on its own
// (it has no access to content.decisions): every decision id referenced by a
// challenge condition must exist. Called once at content load time by the UI
// (src/ui/main.ts) after loadActiveContent / parse* assembly, and directly by
// tests against both the shipped content and fixtures.
export function validateContentGraph(content: GameContent): void {
  const challengesSource = content.eraId
    ? `content/eras/${content.eraId}/challenges.json`
    : "content/challenges.json";
  const decisionIds = new Set(content.decisions.map((d) => d.id));
  for (const def of content.challenges) {
    for (const requiredDecision of def.condition?.requiresAnyDecision ?? []) {
      if (!decisionIds.has(requiredDecision)) {
        throw new Error(
          `Invalid content in ${challengesSource}: "${def.id}" condition.requiresAnyDecision references unknown decision id "${requiredDecision}"`,
        );
      }
    }
    const lacksDecision = def.condition?.lacksDecision;
    if (lacksDecision !== undefined && !decisionIds.has(lacksDecision)) {
      throw new Error(
        `Invalid content in ${challengesSource}: "${def.id}" condition.lacksDecision references unknown decision id "${lacksDecision}"`,
      );
    }
  }
}
