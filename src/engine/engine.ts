import type { GameContent, GameState } from "./types";
import { createRng, type Rng } from "./rng";
import { tick, type ChallengePhase } from "./tick";
import { applyDecision, removeDecision, availability, type Availability } from "./decisions";
import { rollChallenges, resolveChoice } from "./challenges";
import { startProject, projectAvailability, isStalled, type ProjectAvailability } from "./projects";

export function initialState(content: GameContent): GameState {
  const s = content.start;
  return {
    day: 0,
    paused: false,
    stocks: { ...s.stocks },
    baseRates: { ...s.baseRates },
    debtMultiplierBase: s.debtMultiplier,
    baseBurnPerDay: s.baseBurnPerDay,
    contextSwitchFactor: s.contextSwitchFactor,
    debtDragFreeDebt: s.debtDrag.freeDebt,
    debtDragPerPoint: s.debtDrag.dragPerPoint,
    debtDragMaxDrag: s.debtDrag.maxDrag,
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
      },
    ],
    completedProjects: 0,
    pendingChoices: [],
    log: [],
    pointsPerDay: 0,
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

  constructor(protected content: GameContent, restored?: GameState) {
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

  tick(): void {
    tick(this.state, this.rng, this.content, this.challengePhase);
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
