'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';

import type { RuntimeGameEngine } from '@/runtime/engine-registry';

import { floatAt } from './rng';

/**
 * Lucky Pick engine (Phase 4 — instant, single-shot).
 *
 * Rules: pick one of N boxes; each box hides a multiplier drawn from a weighted
 * table (provably fair); you win the picked box's multiplier. The table's mean is
 * ≈ 0.96 → a ~4% house edge. PURE: no wallet/history.
 */
export interface LuckyTier {
  mult: number;
  weight: number;
}
export interface LuckyPickConfig {
  boxes: number;
  /** Multiplier tiers + weights. Mean ≈ 0.96 → ~4% house edge. */
  tiers: LuckyTier[];
}
export const LUCKY_PICK_CONFIG: LuckyPickConfig = {
  boxes: 5,
  tiers: [
    { mult: 0, weight: 0.63 },
    { mult: 1.5, weight: 0.24 },
    { mult: 3, weight: 0.1 },
    { mult: 10, weight: 0.03 },
  ],
};

/** Map a float to a tier multiplier by cumulative weight. */
export function luckyMultiplier(r: number, tiers: LuckyTier[]): number {
  let acc = 0;
  for (const t of tiers) {
    acc += t.weight;
    if (r < acc) return t.mult;
  }
  return tiers[tiers.length - 1]!.mult;
}

export interface LuckyPickState {
  box: number;
  multiplier: number;
  /** Every box's hidden multiplier (for the reveal). */
  boxes: number[];
}

export class LuckyPickEngine implements RuntimeGameEngine<LuckyPickConfig, number, LuckyPickState> {
  readonly engineKey = 'lucky-pick';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<number>;
    config: LuckyPickConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<LuckyPickState> {
    const { session, bet, config, rng, fairness } = input;
    const box = Math.max(0, Math.min(config.boxes - 1, Math.floor(bet.selections[0]!.pick)));
    const boxes = Array.from({ length: config.boxes }, (_, i) => luckyMultiplier(floatAt(rng, fairness, i), config.tiers));
    const multiplier = boxes[box]!;

    const win = multiplier >= 1;
    return {
      roundId: '',
      gameId: session.gameId,
      state: { box, multiplier, boxes },
      multiplier: win ? multiplier : 0,
      win,
      fairness,
      computedAt: new Date().toISOString(),
      display: { label: win ? `${multiplier}×` : 'Empty', value: win ? multiplier : 0 },
    };
  }
}
