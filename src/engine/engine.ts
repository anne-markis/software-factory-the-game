import type { GameContent, GameState } from "./types";
import { createRng, type Rng } from "./rng";
import { tick, type ChallengePhase, log } from "./tick";
import { applyDecision, removeDecision, availability, type Availability } from "./decisions";
import { rollChallenges, resolveChoice } from "./challenges";
import { startProject, projectAvailability, isStalled, type ProjectAvailability } from "./projects";
import { eraCrossingIsSilent, evaluateNextEraEntry, formatEraEntryPredicate } from "./eras";

export type LoadEraContent = (eraId: string) => GameContent;

export function initialState(content: GameContent): GameState {
  const s = content.start;
  return {
    day: 0,
    paused: false,
    // Per-era content: hold the active era id from content.
    // Hand-built fixtures may omit era metadata; fall back to
    // eras.startingEraId, then to a fixture id.
    eraId: content.eraId ?? content.eras?.startingEraId ?? "_fixture",
    stocks: { ...s.stocks },
    baseRates: { ...s.baseRates },
    debtMultiplierBase: s.debtMultiplier,
    baseBurnPerDay: s.baseBurnPerDay,
    contextSwitchFactor: s.contextSwitchFactor,
    debtDragFreeDebt: s.debtDrag.freeDebt,
    debtDragPerPoint: s.debtDrag.dragPerPoint,
    debtDragMaxDrag: s.debtDrag.maxDrag,
    // Copied from content like the debtDrag config, so effectiveRate's
    // stockDragMultiplier stays content-free. Default [] when
    // content ships no drags.
    stockDrags: (s.stockDrags ?? []).map((d) => ({ ...d })),
    archetypesSeen: [],
    milestonesSeen: [],
    modifiers: [],
    decisions: [],
    projects: [
      {
        defId: s.initialProject.id,
        name: s.initialProject.name,
        remaining: s.initialProject.sizePoints,
        payoutPerPoint: s.initialProject.payoutPerPoint,
        completionBonus: s.initialProject.completionBonus,
        reputationReward: s.initialProject.reputationReward,
        // Studio spine: the Launch beta's user grant is carried on the seeded
        // ActiveProject so completion pays it (users 0 -> 30).
        ...(s.initialProject.completionStockGrants
          ? { completionStockGrants: s.initialProject.completionStockGrants.map((g) => ({ ...g })) }
          : {}),
      },
    ],
    completedProjects: 0,
    completedProjectIds: [],
    pendingChoices: [],
    log: [],
    pointsPerDay: 0,
    pullFlow: 0,
    finishFlow: 0,
    userAcquireFlow: 0,
    userChurnFlow: 0,
    userIncomeFlow: 0,
    nextInstanceId: 1,
    nextModifierId: 1,
    rngState: 0,
    gameSeed: s.seed,
    challengeLastFired: {},
  };
}

export class Engine {
  protected state: GameState;
  protected rng: Rng;
  protected challengePhase: ChallengePhase = rollChallenges;

  constructor(
    protected content: GameContent,
    restored?: GameState,
    private readonly loadEra?: LoadEraContent,
  ) {
    if (restored) {
      this.state = restored;
      // Legacy saves predate gameSeed; challenge rolls hash on it, so backfill
      // from content (deserialize has no content access). New games always
      // carry it via initialState.
      if (restored.gameSeed === undefined) restored.gameSeed = content.start.seed;
      // Legacy saves predate the tech-debt drag config (Release 15). Backfill
      // all three from content (deserialize has no content access), mirroring
      // the gameSeed backfill just above. Checking one field is enough: they
      // are always written together by initialState.
      if (restored.debtDragFreeDebt === undefined) {
        restored.debtDragFreeDebt = content.start.debtDrag.freeDebt;
        restored.debtDragPerPoint = content.start.debtDrag.dragPerPoint;
        restored.debtDragMaxDrag = content.start.debtDrag.maxDrag;
      }
      // Legacy saves predate reputation (Release 17); stocks is a plain
      // object round-tripped through JSON with no per-field defaulting, so
      // (like gameSeed/debtDrag) the Engine constructor backfills it from
      // content rather than save.ts's deserialize, which has no content
      // access.
      if (restored.stocks.reputation === undefined) {
        restored.stocks.reputation = content.start.stocks.reputation;
      }
      // Studio spine: users stock and always-on stockDrags config.
      // The SAVE_VERSION bump to 2 means real legacy saves are rejected before
      // reaching here, but these defensive backfills keep a hand-constructed or
      // mid-migration state safe (users defaults to 0, drags from content).
      if (restored.stocks.users === undefined) {
        restored.stocks.users = content.start.stocks.users;
      }
      if (restored.stockDrags === undefined) {
        restored.stockDrags = (content.start.stockDrags ?? []).map((d) => ({ ...d }));
      }
      // Per-era content: legacy saves predate eraId; backfill from
      // the active content bundle (Studio in P0.2).
      if (restored.eraId === undefined) {
        restored.eraId = content.eraId ?? content.eras?.startingEraId ?? "_fixture";
      }
      if (restored.completedProjectIds === undefined) {
        restored.completedProjectIds = [];
      }
      this.rng = createRng(restored.rngState, true);
    } else {
      this.state = initialState(content);
      this.rng = createRng(content.start.seed);
      this.state.rngState = this.rng.getState();
    }
  }

  /**
   * Returns the live state object for cheap per-tick reads. Callers must not
   * mutate it, and must not hold the reference across ticks expecting
   * immutability: Readonly is shallow and compile-time only.
   */
  getState(): Readonly<GameState> {
    return this.state;
  }

  getContent(): GameContent {
    return this.content;
  }

  tick(): void {
    tick(this.state, this.rng, this.content, this.challengePhase);
    this.maybeAdvanceEra();
  }

  /**
   * One-way ladder step, after the day's income and burn. Requires a loader
   * so owned defs stay resolvable after the shop swaps. Fixtures that omit
   * loadEra stay on their bundle even if entry floors are met (unit tests
   * that assemble partial graphs).
   */
  private maybeAdvanceEra(): void {
    const eras = this.content.eras;
    if (!eras || !this.loadEra) return;
    const hit = evaluateNextEraEntry(this.state, eras);
    if (!hit) return;
    this.content = this.loadEra(hit.era.id);
    this.state.eraId = hit.era.id;
    if (!eraCrossingIsSilent(hit.era)) {
      log(
        this.state,
        `Entered ${hit.era.name} (${formatEraEntryPredicate(hit.path)}).`,
      );
    }
  }

  pause(): void {
    this.state.paused = true;
  }

  resume(): void {
    this.state.paused = false;
  }

  applyDecision(defId: string): void {
    applyDecision(this.state, this.content, defId, this.rng);
  }

  removeDecision(instanceId: string): void {
    removeDecision(this.state, this.content, instanceId);
  }

  availableDecisions(): Availability[] {
    return availability(this.state, this.content);
  }

  resolveChoice(challengeId: string, optionId: string): void {
    resolveChoice(this.state, this.content, challengeId, optionId);
  }

  startProject(defId: string): void {
    startProject(this.state, this.content, defId);
  }

  availableProjects(): ProjectAvailability[] {
    return projectAvailability(this.state, this.content);
  }

  isStalled(): boolean {
    return isStalled(this.state, this.content);
  }
}
