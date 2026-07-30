'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';

import type { RuntimeGameEngine } from '@/runtime/engine-registry';

import { shuffleFair } from './rng';

/**
 * Keno engine (Phase 4 — instant, single-shot).
 *
 * Rules: pick up to 10 numbers from a pool of 40; the round draws 10; the payout
 * follows the pick-count × matches paytable. Draws are a provably-fair permutation
 * of the pool. PURE: no wallet/history.
 */
export interface KenoConfig {
  pool: number;
  draws: number;
  /** paytable[picks][matches] → multiplier. */
  paytable: Record<number, number[]>;
}
export const KENO_CONFIG: KenoConfig = {
  pool: 40,
  draws: 10,
  paytable: {
    1: [0, 3.8],
    2: [0, 1, 9],
    3: [0, 0, 2.8, 42],
    4: [0, 0, 1.6, 10, 90],
    5: [0, 0, 1.4, 4, 14, 300],
    6: [0, 0, 0, 3, 8, 70, 700],
    7: [0, 0, 0, 2, 6, 22, 100, 1500],
    8: [0, 0, 0, 0, 2.5, 12, 55, 350, 3000],
    9: [0, 0, 0, 0, 2, 5, 25, 120, 700, 5000],
    10: [0, 0, 0, 0, 1.5, 4, 12, 45, 300, 1500, 8000],
  },
};

export interface KenoState {
  selected: number[];
  drawn: number[];
  matches: number;
  multiplier: number;
}

export class KenoEngine implements RuntimeGameEngine<KenoConfig, number[], KenoState> {
  readonly engineKey = 'keno';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<number[]>;
    config: KenoConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<KenoState> {
    const { session, bet, config, rng, fairness } = input;
    const selected = [...new Set(bet.selections[0]!.pick)].filter((n) => n >= 1 && n <= config.pool).slice(0, 10);
    const drawn = shuffleFair(config.pool, rng, fairness)
      .slice(0, config.draws)
      .map((i) => i + 1);
    const drawnSet = new Set(drawn);
    const matches = selected.filter((n) => drawnSet.has(n)).length;
    const multiplier = config.paytable[selected.length]?.[matches] ?? 0;

    const win = multiplier >= 1;
    return {
      roundId: '',
      gameId: session.gameId,
      state: { selected, drawn, matches, multiplier },
      multiplier: win ? multiplier : 0,
      win,
      fairness,
      computedAt: new Date().toISOString(),
      display: { label: `${matches}/${selected.length} · ${multiplier}×`, value: win ? multiplier : 0 },
    };
  }
}
