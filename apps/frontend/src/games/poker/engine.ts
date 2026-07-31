/**
 * Texas Hold'em runtime adapter (Sprint 5, STEP 12).
 *
 * A PURE single-shot `RuntimeGameEngine` that settles ONE seat's participation in a
 * hand through the FROZEN runtime: the caller debits `stake = chips contributed` and
 * this engine returns a flexible settlement crediting `payout = chips won`. Net wallet
 * change per seat = won − contributed. The Poker Table Engine (table-engine.ts) plays
 * the multiplayer hand and produces the per-seat contributed/won; money only ever moves
 * here, through the frozen settlement → ledger. No runtime/wallet/ledger change.
 */
import type { IBetRequest, IFairnessProof, IGameResult, IGameSession, IProvablyFairProvider } from '@gaming-platform/types';
import { SettlementType } from '@gaming-platform/types';

import type { RuntimeGameEngine } from '@/runtime/engine-registry';

import { POKER_DEFAULT } from './table-engine';
import type { PokerConfig, SeatSettlement } from './types';

export const POKER_ENGINE_KEY = 'texas-holdem';
export { POKER_DEFAULT };

export class PokerHandEngine implements RuntimeGameEngine<PokerConfig, SeatSettlement, SeatSettlement> {
  readonly engineKey = POKER_ENGINE_KEY;

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<SeatSettlement>;
    config: PokerConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<SeatSettlement> {
    const { session, bet, fairness } = input;
    const pick = bet.selections?.[0]?.pick;
    if (!pick) throw new Error('poker: missing seat settlement');

    const contributed = Math.max(0, Math.round(pick.contributed));
    const won = Math.max(0, Math.round(pick.won));
    const net = won - contributed;

    const type = won > contributed ? SettlementType.Win : won === contributed ? SettlementType.Push : won > 0 ? SettlementType.Custom : SettlementType.Loss;
    const multiplier = contributed > 0 ? won / contributed : 0;
    const label = net > 0 ? `Won +${net}${pick.handName ? ` · ${pick.handName}` : ''}` : net === 0 ? 'Push' : `Lost ${-net}`;

    return {
      roundId: '',
      gameId: session.gameId,
      state: pick,
      multiplier,
      win: net > 0,
      fairness,
      computedAt: new Date().toISOString(),
      display: { label, value: net },
      settlement: {
        type,
        payout: String(won),
        multiplier,
        reason: pick.handName ?? 'poker hand',
        metadata: { handId: pick.handId, seat: pick.seat, contributed, won, net, hole: pick.hole, board: pick.board },
        display: { label, value: net },
      },
    };
  }
}
