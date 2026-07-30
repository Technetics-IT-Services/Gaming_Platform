'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';

import { createDeck, rankValue, shuffle, type Card } from '@/lib/deck';
import type { RuntimeGameEngine } from '@/runtime/engine-registry';

/**
 * Dragon Tiger engine (Phase 3 migration).
 *
 * PURE rules only — the runtime owns bet/RNG/settlement/history. The 6-deck
 * shuffle, high-card comparison and payout table are byte-for-byte the previous
 * in-component logic; only the RNG seed moves to the provably-fair provider. In
 * this game a tie is a full loss for a dragon/tiger bet (preserved), so the
 * standard multiplicative settlement applies.
 */
export type DTSide = 'dragon' | 'tiger' | 'tie';
export const DT_PAYOUT: Record<DTSide, number> = { dragon: 2, tiger: 2, tie: 9 };

export interface DTState {
  dragon: Card;
  tiger: Card;
  winner: DTSide;
}

export class DragonTigerEngine implements RuntimeGameEngine<unknown, DTSide, DTState> {
  readonly engineKey = 'dragon-tiger';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<DTSide>;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<DTState> {
    const { session, bet, rng, fairness } = input;
    const side = bet.selections[0]!.pick;
    const r = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce });
    const shoe = shuffle(createDeck(6), Math.floor(r * 2 ** 31));
    const dragon = shoe[0] ?? 'AS';
    const tiger = shoe[1] ?? 'KH';
    const dv = rankValue(dragon);
    const tv = rankValue(tiger);
    const winner: DTSide = dv > tv ? 'dragon' : tv > dv ? 'tiger' : 'tie';

    const win = winner === side;
    const multiplier = win ? DT_PAYOUT[side] : 0;
    const label = winner === 'tie' ? 'Tie' : `${winner[0]!.toUpperCase()}${winner.slice(1)}`;

    return {
      roundId: '',
      gameId: session.gameId,
      state: { dragon, tiger, winner },
      multiplier,
      win,
      fairness,
      computedAt: new Date().toISOString(),
      display: { label, value: win ? multiplier : 0 },
    };
  }
}
