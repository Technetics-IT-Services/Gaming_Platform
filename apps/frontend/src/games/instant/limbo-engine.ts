'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';

import type { RuntimeGameEngine } from '@/runtime/engine-registry';

/**
 * Limbo engine (Phase 4 — instant, single-shot).
 *
 * Rules: the player picks a target multiplier; the round generates a random
 * multiplier (crash-style curve); the bet wins if generated ≥ target and pays the
 * target. Probability of winning at target T is ≈ edge/T, so EV = (edge/T)·T = edge
 * → a constant house edge independent of T. PURE: provably-fair float → outcome.
 */
export interface LimboConfig {
  houseEdgePct: number;
  maxMultiplier: number;
}
export const LIMBO_CONFIG: LimboConfig = { houseEdgePct: 1, maxMultiplier: 1_000_000 };

export interface LimboPick {
  /** The multiplier the player is betting the round will reach (≥ 1.01). */
  target: number;
}
export interface LimboState {
  generated: number;
  target: number;
}

/** The generated multiplier for a fairness float (shared so tests + UI agree). */
export function limboMultiplier(r: number, config: LimboConfig = LIMBO_CONFIG): number {
  const edge = 1 - config.houseEdgePct / 100;
  const raw = Math.floor((edge / Math.max(1e-9, 1 - r)) * 100) / 100;
  return Math.min(config.maxMultiplier, Math.max(1, raw));
}

export class LimboEngine implements RuntimeGameEngine<LimboConfig, LimboPick, LimboState> {
  readonly engineKey = 'limbo';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<LimboPick>;
    config: LimboConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<LimboState> {
    const { session, bet, config, rng, fairness } = input;
    const target = Math.max(1.01, bet.selections[0]!.pick.target);
    const r = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce });
    const generated = limboMultiplier(r, config);

    const win = generated >= target;
    return {
      roundId: '',
      gameId: session.gameId,
      state: { generated, target },
      multiplier: win ? target : 0,
      win,
      fairness,
      computedAt: new Date().toISOString(),
      display: { label: `${generated.toFixed(2)}×`, value: generated },
    };
  }
}
