'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';

/**
 * A runtime game engine (Phase 2.2). It is the platform `IGameEngine` with one
 * addition: the runtime supplies the round's `fairness` so outcomes are
 * reproducible for replay/verification (the runtime — not the engine — owns the
 * seeds). Engines remain PURE: input + RNG + fairness → result. No wallet, no IO.
 */
export interface RuntimeGameEngine<TConfig = unknown, TPick = unknown, TState = unknown> {
  readonly engineKey: string;
  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<TPick>;
    config: TConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<TState>;
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
