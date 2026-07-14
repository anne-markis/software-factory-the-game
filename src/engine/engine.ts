import type { GameContent, GameState } from "./types";
import { createRng, type Rng } from "./rng";
import { tick, type ChallengePhase } from "./tick";

const noChallenges: ChallengePhase = () => {};

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
    modifiers: [],
    decisions: [],
    projects: [
      {
        defId: s.initialProject.id,
        name: s.initialProject.name,
        remaining: s.initialProject.sizePoints,
        payoutPerPoint: s.initialProject.payoutPerPoint,
        completionBonus: s.initialProject.completionBonus,
      },
    ],
    completedProjects: 0,
    pendingChoices: [],
    log: [],
    pointsPerDay: 0,
    nextInstanceId: 1,
    rngState: 0,
  };
}

export class Engine {
  protected state: GameState;
  protected rng: Rng;
  protected challengePhase: ChallengePhase = noChallenges;

  constructor(protected content: GameContent, restored?: GameState) {
    if (restored) {
      this.state = restored;
      this.rng = createRng(restored.rngState, true);
    } else {
      this.state = initialState(content);
      this.rng = createRng(content.start.seed);
      this.state.rngState = this.rng.getState();
    }
  }

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
}
