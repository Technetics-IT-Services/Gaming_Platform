'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';

import { baccaratValue, createDeck, shuffle, type Card } from '@/lib/deck';
import type { RuntimeGameEngine } from '@/runtime/engine-registry';

/**
 * Baccarat engine (Phase 3 migration).
 *
 * PURE rules only. The 6-deck shoe, natural + third-card drawing rules and payout
 * table are byte-for-byte the previous logic; only the RNG seed moves to the
 * provably-fair provider. As before, a tie is a full loss for a player/banker bet
 * (not a push), so the standard multiplicative settlement applies.
 */
export type BaccaratSide = 'player' | 'banker' | 'tie';
export const BACCARAT_PAYOUT: Record<BaccaratSide, number> = { player: 2, banker: 1.95, tie: 9 };

export interface BaccaratState {
  playerCards: Card[];
  bankerCards: Card[];
  playerTotal: number;
  bankerTotal: number;
  winner: BaccaratSide;
}

function resolve(seed: number): BaccaratState {
  const shoe = shuffle(createDeck(6), seed);
  let i = 0;
  const draw = (): Card => {
    const c = shoe[i] ?? 'AS';
    i += 1;
    return c;
  };

  const playerCards: Card[] = [draw(), draw()];
  const bankerCards: Card[] = [draw(), draw()];
  const pv = () => baccaratValue(playerCards);
  const bv = () => baccaratValue(bankerCards);

  const natural = pv() >= 8 || bv() >= 8;
  if (!natural) {
    let playerThird: number | null = null;
    if (pv() <= 5) {
      const c = draw();
      playerThird = baccaratValue([c]);
      playerCards.push(c);
    }

    const b = bv();
    let bankerDraws = false;
    if (playerThird === null) {
      bankerDraws = b <= 5;
    } else {
      if (b <= 2) bankerDraws = true;
      else if (b === 3) bankerDraws = playerThird !== 8;
      else if (b === 4) bankerDraws = playerThird >= 2 && playerThird <= 7;
      else if (b === 5) bankerDraws = playerThird >= 4 && playerThird <= 7;
      else if (b === 6) bankerDraws = playerThird === 6 || playerThird === 7;
      else bankerDraws = false;
    }
    if (bankerDraws) bankerCards.push(draw());
  }

  const playerTotal = pv();
  const bankerTotal = bv();
  const winner: BaccaratSide =
    playerTotal > bankerTotal ? 'player' : bankerTotal > playerTotal ? 'banker' : 'tie';

  return { playerCards, bankerCards, playerTotal, bankerTotal, winner };
}

export class BaccaratEngine implements RuntimeGameEngine<unknown, BaccaratSide, BaccaratState> {
  readonly engineKey = 'baccarat';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<BaccaratSide>;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<BaccaratState> {
    const { session, bet, rng, fairness } = input;
    const side = bet.selections[0]!.pick;
    const r = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce });
    const state = resolve(Math.floor(r * 2 ** 31));

    const win = state.winner === side;
    const multiplier = win ? BACCARAT_PAYOUT[side] : 0;
    const label =
      state.winner === 'tie'
        ? `Tie ${state.playerTotal}`
        : `${state.winner === 'player' ? 'Player' : 'Banker'} ${state.winner === 'player' ? state.playerTotal : state.bankerTotal}`;

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
