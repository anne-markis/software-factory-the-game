import { z } from "zod";
import type { StartConfig, DecisionDef } from "./types";

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
