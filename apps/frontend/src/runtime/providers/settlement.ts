'use client';

import type {
  IBetRequest,
  IBetResult,
  IGameResult,
  IGameSession,
  ISettlementProvider,
  IWalletProvider,
} from '@gaming-platform/types';
import { BetOutcome } from '@gaming-platform/types';

import { RuntimeError, RuntimeErrorCode } from '../errors';

/**
 * Settlement providers (Phase 2.2).
 *
 * Maps a raw engine `IGameResult` → a settled `IBetResult`, crediting winnings
 * through the wallet provider. Payout policy lives HERE (not in the engine or the
 * game), so house-edge / payout rules can evolve without touching game code.
 *
 * `result.multiplier` is the effective total-return multiplier the engine/round
 * produced (e.g. the cash-out multiplier for crash, 0 on a loss).
 */
export class DemoSettlementProvider implements ISettlementProvider {
  async settle(input: {
    session: IGameSession;
    result: IGameResult;
    bet: IBetRequest;
    wallet: IWalletProvider;
  }): Promise<IBetResult> {
    const { result, bet, wallet, session } = input;
    const stake = Number(bet.stake.amount);
    const win = result.win && result.multiplier > 0;
    const payout = win ? Math.round(stake * result.multiplier) : 0;
    const netProfit = payout - stake;

    let balanceAfter: string | undefined;
    if (payout > 0) {
      const credited = await wallet.credit({
        playerId: session.playerId,
        currency: session.currency,
        amount: String(payout),
        reference: `settle:${result.roundId}`,
        idempotencyKey: `credit:${result.roundId}:${bet.idempotencyKey}`,
      });
      balanceAfter = credited.balanceAfter;
    }

    return {
      betId: `bet_${result.roundId}`,
      roundId: result.roundId,
      outcome: win ? BetOutcome.Win : BetOutcome.Loss,
      stake: String(stake),
      payout: String(payout),
      netProfit: String(netProfit),
      multiplier: win ? result.multiplier : 0,
      balanceAfter,
      settledAt: new Date(result.computedAt).toISOString(),
    };
  }
}

/** Real settlement provider — backend engine payout + ledger credit. Inactive in 2.2. */
export class RealSettlementProvider implements ISettlementProvider {
  async settle(): Promise<IBetResult> {
    throw new RuntimeError(
      RuntimeErrorCode.FEATURE_DISABLED,
      'Real settlement provider is not active in Phase 2.2 (demo mode).',
    );
  }
}
