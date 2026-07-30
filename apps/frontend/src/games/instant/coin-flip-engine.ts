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
 * Coin Flip engine (Phase 4 — instant, single-shot).
 *
 * Rules: pick heads or tails; a fair coin is flipped from the provably-fair float
 * (r < 0.5 → heads). A correct call pays 1.98× (a 1% house edge on the fair 2×).
 * PURE: float → outcome.
 */
export type CoinSide = 'heads' | 'tails';
export interface CoinFlipConfig {
  /** Winning multiplier (fair 2× minus house edge). */
  payout: number;
}
export const COIN_FLIP_CONFIG: CoinFlipConfig = { payout: 1.98 };

export interface CoinFlipState {
  outcome: CoinSide;
}

export class CoinFlipEngine implements RuntimeGameEngine<CoinFlipConfig, CoinSide, CoinFlipState> {
  readonly engineKey = 'coin-flip';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<CoinSide>;
    config: CoinFlipConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<CoinFlipState> {
    const { session, bet, config, rng, fairness } = input;
    const pick = bet.selections[0]!.pick;
    const r = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce });
    const outcome: CoinSide = r < 0.5 ? 'heads' : 'tails';

    const win = outcome === pick;
    const multiplier = win ? config.payout : 0;
    return {
      roundId: '',
      gameId: session.gameId,
      state: { outcome },
      multiplier,
      win,
      fairness,
      computedAt: new Date().toISOString(),
      display: { label: outcome === 'heads' ? 'Heads' : 'Tails', value: win ? multiplier : 0 },
    };
  }
}
