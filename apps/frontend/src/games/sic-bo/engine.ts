/**
 * Sic Bo engine (Sprint 3, STEP 1).
 *
 * A PURE single-shot `RuntimeGameEngine`. `createRound` rolls three provably-fair dice,
 * evaluates EVERY placed bet strictly from the outcome, sums the total return, and
 * settles through the frozen flexible settlement (`payout = Σ winning-bet returns`). It
 * never touches the wallet/ledger; losing bets simply return nothing.
 */
import type { IBetRequest, IFairnessProof, IGameResult, IGameSession, IProvablyFairProvider } from '@gaming-platform/types';
import { SettlementType } from '@gaming-platform/types';

import type { RuntimeGameEngine } from '@/runtime/engine-registry';

import { betReturn, oddsFor } from './paytable';
import { rollDice } from './provably-fair';
import { isTriple, total } from './probability';
import { type BetResult, type PlacedBet, type SicBoState } from './types';

export const SIC_BO_ENGINE_KEY = 'sic-bo';

export interface SicBoConfig {
  minBet?: number;
  maxBet?: number;
  rewards?: { winXp: number; lossXp: number };
}

export class SicBoEngine implements RuntimeGameEngine<SicBoConfig, PlacedBet, SicBoState> {
  readonly engineKey = SIC_BO_ENGINE_KEY;

  createRound(input: { session: IGameSession; bet: IBetRequest<PlacedBet>; config: SicBoConfig; rng: IProvablyFairProvider; fairness: IFairnessProof }): IGameResult<SicBoState> {
    const { session, bet, rng, fairness } = input;
    const dice = rollDice(rng, fairness);

    // Each selection is a placed bet { type, value?, amount }.
    const placed: PlacedBet[] = (bet.selections ?? []).map((s) => s.pick).filter((p): p is PlacedBet => !!p && typeof (p as PlacedBet).amount === 'number');

    const results: BetResult[] = placed.map((p) => {
      const ret = betReturn(p, dice);
      const won = ret > 0;
      const odds = oddsFor(p);
      return { ...p, won, payout: won ? Math.round(p.amount * ret) : 0, odds: Array.isArray(odds) ? odds[0] : odds };
    });

    const totalStake = placed.reduce((s, p) => s + p.amount, 0) || Number(bet.stake.amount);
    const totalPayout = results.reduce((s, r) => s + r.payout, 0);
    const multiplier = totalStake > 0 ? totalPayout / totalStake : 0;
    const label = totalPayout > 0 ? `${multiplier.toFixed(2)}×` : 'No win';

    const state: SicBoState = { dice, total: total(dice), isTriple: isTriple(dice), results, totalStake, totalPayout };

    return {
      roundId: '',
      gameId: session.gameId,
      state,
      multiplier,
      win: totalPayout > totalStake,
      settlement: { type: SettlementType.Custom, payout: String(totalPayout), multiplier, metadata: { dice, total: state.total, winners: results.filter((r) => r.won).length }, display: { label, value: multiplier } },
      fairness,
      computedAt: new Date().toISOString(),
      display: { label, value: multiplier },
    };
  }
}
