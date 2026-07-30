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
 * Wheel engine (Phase 4 — instant, single-shot).
 *
 * Rules: pick a risk level; the wheel lands on one of its segments; you win that
 * segment's multiplier (0 = lose). Each risk's segment set has the same ~4% house
 * edge (mean multiplier ≈ 0.96) but a different variance — low risk hits small
 * wins often, high risk hits big wins rarely. PURE: float → segment.
 */
export type WheelRisk = 'low' | 'medium' | 'high';

/** Segment multiplier arrays. Each array's mean is ≈ 0.96 (a ~4% house edge). */
export const WHEEL_SEGMENTS: Record<WheelRisk, number[]> = {
  // 16 × 1.2 + 4 × 0  → mean 0.96
  low: [1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2],
  // 4 × 3 + 4 × 1.8 + 12 × 0  → mean 0.96
  medium: [3, 0, 1.8, 0, 3, 0, 1.8, 0, 3, 0, 1.8, 0, 3, 0, 1.8, 0, 0, 0, 0, 0],
  // 10 + 5 + 4.2 + 17 × 0  → mean 0.96
  high: [10, 0, 0, 0, 0, 5, 0, 0, 0, 0, 4.2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export interface WheelState {
  index: number;
  multiplier: number;
  risk: WheelRisk;
}

export class WheelEngine implements RuntimeGameEngine<unknown, WheelRisk, WheelState> {
  readonly engineKey = 'wheel';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<WheelRisk>;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<WheelState> {
    const { session, bet, rng, fairness } = input;
    const risk = bet.selections[0]!.pick;
    const segments = WHEEL_SEGMENTS[risk] ?? WHEEL_SEGMENTS.low;
    const r = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce });
    const index = Math.min(segments.length - 1, Math.floor(r * segments.length));
    const multiplier = segments[index]!;

    const win = multiplier >= 1;
    return {
      roundId: '',
      gameId: session.gameId,
      state: { index, multiplier, risk },
      multiplier: win ? multiplier : 0,
      win,
      fairness,
      computedAt: new Date().toISOString(),
      display: { label: `${multiplier}×`, value: win ? multiplier : 0 },
    };
  }
}
