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
 * Andar Bahar engine (Phase 3 migration).
 *
 * PURE rules only. The single-deck shuffle, alternating deal until the joker rank
 * matches, and the payout table are byte-for-byte the previous in-component logic;
 * only the RNG seed moves to the provably-fair provider.
 */
export type ABSide = 'andar' | 'bahar';
// Slight house edge: Andar (first-dealt side) pays a touch less.
export const AB_PAYOUT: Record<ABSide, number> = { andar: 1.9, bahar: 2.0 };

export interface ABState {
  joker: Card;
  andar: Card[];
  bahar: Card[];
  /** Full deal order: alternating starting with Andar. */
  sequence: { side: ABSide; card: Card }[];
  winner: ABSide;
}

function resolve(seed: number): ABState {
  const deck = shuffle(createDeck(1), seed);
  let i = 0;
  const joker = deck[i] ?? 'AS';
  i += 1;
  const jokerRank = rankOf(joker);

  const andar: Card[] = [];
  const bahar: Card[] = [];
  const sequence: { side: ABSide; card: Card }[] = [];
  let winner: ABSide = 'andar';
  let side: ABSide = 'andar';

  while (i < deck.length) {
    const card = deck[i]!;
    i += 1;
    if (side === 'andar') andar.push(card);
    else bahar.push(card);
    sequence.push({ side, card });
    if (rankOf(card) === jokerRank) {
      winner = side;
      break;
    }
    side = side === 'andar' ? 'bahar' : 'andar';
  }

  return { joker, andar, bahar, sequence, winner };
}

export class AndarBaharEngine implements RuntimeGameEngine<unknown, ABSide, ABState> {
  readonly engineKey = 'andar-bahar';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<ABSide>;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<ABState> {
    const { session, bet, rng, fairness } = input;
    const side = bet.selections[0]!.pick;
    const r = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce });
    const state = resolve(Math.floor(r * 2 ** 31));

    const win = state.winner === side;
    const multiplier = win ? AB_PAYOUT[side] : 0;
    const label = `${state.winner === 'andar' ? 'Andar' : 'Bahar'} ${state.sequence.length}`;

    return {
      roundId: '',
      gameId: session.gameId,
      state,
      multiplier,
      win,
      fairness,
      computedAt: new Date().toISOString(),
      display: { label, value: win ? multiplier : 0 },
    };
  }
}
