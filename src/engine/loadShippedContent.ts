// Static imports of the shipped per-era JSON layout (ADR 0001).
// Later era files are deltas; loadActiveContent inherits prior rungs (ADR 0008).
// Vite and Vitest need eager module paths; the map is validated against
// eras.json so a missing shell fails at load rather than silently falling
// back. Tick never imports this file — only UI / tests assemble GameContent.

import startJson from "../../content/start.json";
import erasJson from "../../content/eras.json";

import studioDecisions from "../../content/eras/studio/decisions.json";
import studioChallenges from "../../content/eras/studio/challenges.json";
import studioProjects from "../../content/eras/studio/projects.json";

import companyDecisions from "../../content/eras/company/decisions.json";
import companyChallenges from "../../content/eras/company/challenges.json";
import companyProjects from "../../content/eras/company/projects.json";

import megacorpDecisions from "../../content/eras/megacorp/decisions.json";
import megacorpChallenges from "../../content/eras/megacorp/challenges.json";
import megacorpProjects from "../../content/eras/megacorp/projects.json";

import { loadActiveContent, parseErasConfig, type EraBundleJson } from "./content";
import type { ErasConfig, GameContent } from "./types";

const ERA_BUNDLES: Record<string, EraBundleJson> = {
  studio: {
    decisions: studioDecisions,
    challenges: studioChallenges,
    projects: studioProjects,
  },
  company: {
    decisions: companyDecisions,
    challenges: companyChallenges,
    projects: companyProjects,
  },
  megacorp: {
    decisions: megacorpDecisions,
    challenges: megacorpChallenges,
    projects: megacorpProjects,
  },
};

/** Active content = start.json + resolved catalog for the requested era (inherited prior rungs). */
export function loadShippedContent(eraId?: string): GameContent {
  return loadActiveContent(startJson, erasJson, ERA_BUNDLES, eraId);
}

/** Parsed eras.json — for test fixtures that assemble GameContent by hand. */
export function shippedEras(): ErasConfig {
  return parseErasConfig(erasJson);
}

/** Attach shipped era catalog + active id onto a hand-built GameContent. */
export function withShippedEra(
  partial: Omit<GameContent, "eraId" | "eras">,
  eraId?: string,
): GameContent {
  const eras = shippedEras();
  return { ...partial, eraId: eraId ?? eras.startingEraId, eras };
}

export {
  startJson,
  erasJson,
  studioDecisions as decisionsJson,
  studioChallenges as challengesJson,
  studioProjects as projectsJson,
};
