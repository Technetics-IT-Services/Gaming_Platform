'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
  IStepResult,
  PlayerAction,
} from '@gaming-platform/types';

/**
 * A runtime game engine. It is the platform `IGameEngine` with one addition: the
 * runtime supplies the round's `fairness` so outcomes are reproducible for
 * replay/verification (the runtime — not the engine — owns the seeds). Engines
 * remain PURE: input + RNG + fairness → result. No wallet, no IO.
 *
 * Two shapes, both optional (an engine implements exactly one):
 *  - Single-shot (Phase 2.2): `createRound` returns the outcome in one call.
 *  - Interactive (Phase 2.3C): `start` opens a round and `step` applies a generic
 *    `PlayerAction`, each returning an `IStepResult`. The engine validates
 *    transitions; the runtime owns the state machine and knows no game rules.
 */
export interface RuntimeGameEngine<TConfig = unknown, TPick = unknown, TState = unknown, TGameState = unknown> {
  readonly engineKey: string;
  createRound?(input: {
    session: IGameSession;
    bet: IBetRequest<TPick>;
    config: TConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<TState>;
  /** Open an interactive round → initial machine state. */
  start?(input: {
    session: IGameSession;
    bet: IBetRequest<TPick>;
    config: TConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IStepResult<TGameState>;
  /** Apply a player/system action → next machine state. */
  step?(input: {
    session: IGameSession;
    bet: IBetRequest<TPick>;
    config: TConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
    gameState: TGameState;
    action: PlayerAction;
  }): IStepResult<TGameState>;
}

/** Registry of engines keyed by `engineKey`. New games register an engine here. */
export class EngineRegistry {
  private readonly engines = new Map<string, RuntimeGameEngine>();

  register(engine: RuntimeGameEngine): void {
    this.engines.set(engine.engineKey, engine as RuntimeGameEngine);
  }

  get(engineKey: string): RuntimeGameEngine | undefined {
    return this.engines.get(engineKey);
  }

  has(engineKey: string): boolean {
    return this.engines.has(engineKey);
  }
}
