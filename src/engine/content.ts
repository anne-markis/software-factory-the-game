import { z } from "zod";
import type { StartConfig, DecisionDef, ChallengeDef, ProjectDef } from "./types";

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
  })
  .strict();

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
    initialProject: z
      .object({
        id: z.string(),
        name: z.string(),
        sizePoints: z.number().positive(),
        payoutPerPoint: z.number().min(0),
        completionBonus: z.number().min(0),
      })
      .strict(),
  })
  .strict();

function fail(file: string, error: z.ZodError): never {
  const detail = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid content in ${file}: ${detail}`);
}

export function parseStartConfig(json: unknown): StartConfig {
  const result = startSchema.safeParse(json);
  if (!result.success) fail("content/start.json", result.error);
  return result.data;
}

const rateTarget = z.enum(["pull", "finish", "deploy", "all"]);
const stockName = z.enum(["backlog", "inProgress", "done", "shipped", "budget", "techDebt"]);

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
  z.object({ type: z.literal("sickness"), factor: z.number().gt(0).lt(1), durationDays: z.number().positive() }).strict(),
]);

const gambleOutcomeSchema = z
  .object({ probability: z.number().gt(0).lte(1), label: z.string(), effects: z.array(effectSchema) })
  .strict();

const decisionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    human: z.boolean().optional(),
    cost: z.object({ oneTime: z.number().min(0).optional(), perDay: z.number().min(0).optional() }).strict(),
    incomePerDay: z.number().min(0).optional(),
    effects: z.array(effectSchema),
    gamble: z.array(gambleOutcomeSchema).optional(),
    requires: z.array(z.string()).optional(),
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

export function parseDecisions(json: unknown): DecisionDef[] {
  const result = z.array(decisionSchema).safeParse(json);
  if (!result.success) fail("content/decisions.json", result.error);
  // plain annotation (no cast) so schema/type drift fails compilation here
  const defs: DecisionDef[] = result.data;
  const ids = new Set<string>();
  for (const def of defs) {
    if (ids.has(def.id)) {
      throw new Error(`Invalid content in content/decisions.json: duplicate decision id "${def.id}"`);
    }
    ids.add(def.id);
  }
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
        hasTag: z.string().optional(),
        minTechDebt: z.number().min(0).optional(),
      })
      .strict()
      .optional(),
    probScaling: z.object({ stat: z.literal("techDebt"), per: z.number().positive(), add: z.number().min(0) }).strict().optional(),
    effects: z.array(effectSchema),
    choice: z
      .object({ expiresInDays: z.number().int().positive(), defaultOptionId: z.string(), options: z.array(choiceOptionSchema).min(1) })
      .strict()
      .optional(),
  })
  .strict();

export function parseChallenges(json: unknown): ChallengeDef[] {
  const result = z.array(challengeSchema).safeParse(json);
  if (!result.success) fail("content/challenges.json", result.error);
  const defs: ChallengeDef[] = result.data;
  const ids = new Set<string>();
  for (const def of defs) {
    if (ids.has(def.id)) {
      throw new Error(`Invalid content in content/challenges.json: duplicate challenge id "${def.id}"`);
    }
    ids.add(def.id);
    if (def.choice && !def.choice.options.some((o) => o.id === def.choice!.defaultOptionId)) {
      throw new Error(`Invalid content in content/challenges.json: "${def.id}" default option "${def.choice.defaultOptionId}" not found`);
    }
    // the engine queues the choice and never applies top-level effects, so both set = silent content loss
    if (def.choice && def.effects.length > 0) {
      throw new Error(`Invalid content in content/challenges.json: "${def.id}" has both a choice and top-level effects; effects would be silently ignored`);
    }
    // a sickness effect needs a per-human-dev roll to target an instance; without it the effect no-ops
    if (def.effects.some((e) => e.type === "sickness") && !def.perHumanDev) {
      throw new Error(`Invalid content in content/challenges.json: "${def.id}" has a sickness effect but perHumanDev is not true`);
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
  })
  .strict();

export function parseProjects(json: unknown): ProjectDef[] {
  const result = z.array(projectSchema).safeParse(json);
  if (!result.success) fail("content/projects.json", result.error);
  // plain annotation (no cast) so schema/type drift fails compilation here
  const defs: ProjectDef[] = result.data;
  const ids = new Set<string>();
  for (const def of defs) {
    if (ids.has(def.id)) {
      throw new Error(`Invalid content in content/projects.json: duplicate project id "${def.id}"`);
    }
    ids.add(def.id);
  }
  return defs;
}
