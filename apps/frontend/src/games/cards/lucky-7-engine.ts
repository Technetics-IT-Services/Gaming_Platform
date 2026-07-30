'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';

import { createDeck, rankOf, shuffle, type Card } from '@/lib/deck';
import type { RuntimeGameEngine } from '@/runtime/engine-registry';

/**
 * Lucky 7 engine (Phase 3 migration).
 *
 * PURE rules only. A single card is drawn and compared to 7 (Under 2×, Lucky 7
 * 11×, Over 2×) — byte-for-byte the previous logic; only the RNG seed moves to
 * the provably-fair provider.
 */
export type Lucky7Pick = 'under' | 'seven' | 'over';
export const LUCKY7: Record<Lucky7Pick, { mult: number; label: string }> = {
  under: { mult: 2, label: 'Under 7' },
  seven: { mult: 11, label: 'Lucky 7' },
  over: { mult: 2, label: 'Over 7' },
};

/** Pip number 1..13 (A=1, J=11, Q=12, K=13) — the value compared to 7. */
export function pipValue(card: Card): number {
  const r = rankOf(card);
  if (r === 'A') return 1;
  if (r === 'K') return 13;
  if (r === 'Q') return 12;
  if (r === 'J') return 11;
  if (r === 'T') return 10;
  return Number(r);
}

export function outcomeFor(pip: number): Lucky7Pick {
  if (pip < 7) return 'under';
  if (pip === 7) return 'seven';
  return 'over';
}

export interface Lucky7State {
  card: Card;
  pip: number;
  outcome: Lucky7Pick;
}

export class Lucky7Engine implements RuntimeGameEngine<unknown, Lucky7Pick, Lucky7State> {
  readonly engineKey = 'lucky-7';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<Lucky7Pick>;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<Lucky7State> {
    const { session, bet, rng, fairness } = input;
    const pick = bet.selections[0]!.pick;
    const r = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce });
    const deck = shuffle(createDeck(), Math.floor(r * 2 ** 31));
    const card = deck[0] ?? 'AS';
    const pip = pipValue(card);
    const outcome = outcomeFor(pip);

    const win = outcome === pick;
    const multiplier = win ? LUCKY7[pick].mult : 0;
    const label = win ? `${pip} · ${LUCKY7[pick].label}` : `${pip} · miss`;

    return {
      roundId: '',
      gameId: session.gameId,
      state: { card, pip, outcome },
      multiplier,
      win,
      fairness,
      computedAt: new Date().toISOString(),
      display: { label, value: pip },
    };
  }
}
