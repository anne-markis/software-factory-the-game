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
