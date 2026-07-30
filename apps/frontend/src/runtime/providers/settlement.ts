'use client';

import type {
  IBetRequest,
  IBetResult,
  IGameResult,
  IGameSession,
  ISettlementProvider,
  ISettlementResult,
  IWalletProvider,
} from '@gaming-platform/types';
import { BetOutcome, SettlementType } from '@gaming-platform/types';

import { RuntimeError, RuntimeErrorCode } from '../errors';

/** Map a settlement type + net result to the canonical bet outcome. */
function outcomeFor(type: SettlementType, net: number): BetOutcome {
  switch (type) {
    case SettlementType.Push:
      return BetOutcome.Push;
    case SettlementType.Refund:
      return BetOutcome.Refund;
    case SettlementType.Loss:
      return BetOutcome.Loss;
    case SettlementType.Win:
    case SettlementType.Bonus:
    case SettlementType.Jackpot:
      return BetOutcome.Win;
    default:
      // Custom — derive from the net credited.
      return net > 0 ? BetOutcome.Win : net < 0 ? BetOutcome.Loss : BetOutcome.Push;
  }
}

/**
 * Settlement providers (Phase 2.2, flexible in 2.3C).
 *
 * Maps a raw engine `IGameResult` → a settled `IBetResult`, crediting winnings
 * through the wallet provider. Payout policy lives HERE (not in the engine or the
 * game), so house-edge / payout rules can evolve without touching game code.
 *
 * Two paths, both game-agnostic:
 *  - Flexible (2.3C): if `result.settlement` is present, credit
 *    `payout + refund + bonus` and record its `type` + `metadata`. Supports full
 *    / partial win, push, refund, bonus, jackpot, and custom payouts.
 *  - Default: otherwise settle the multiplicative `stake × multiplier` (crash /
 *    dice / roulette / plinko are unchanged).
 */
export class DemoSettlementProvider implements ISettlementProvider {
  async settle(input: {
    session: IGameSession;
    result: IGameResult;
    bet: IBetRequest;
    wallet: IWalletProvider;
  }): Promise<IBetResult> {
    const stake = Number(input.bet.stake.amount);

    return input.result.settlement
      ? this.settleFlexible(input.result.settlement, stake, input)
      : this.settleMultiplicative(stake, input);
  }

  /** Flexible settlement (2.3C): absolute payout + refund + bonus, any type. */
  private async settleFlexible(
    s: ISettlementResult,
    stake: number,
    input: { session: IGameSession; result: IGameResult; bet: IBetRequest; wallet: IWalletProvider },
  ): Promise<IBetResult> {
    const { result, bet, wallet, session } = input;
    const credited = Number(s.payout || 0) + Number(s.refund || 0) + Number(s.bonus || 0);
    const netProfit = credited - stake;

    let balanceAfter: string | undefined;
    if (credited > 0) {
      const c = await wallet.credit({
        playerId: session.playerId,
        currency: session.currency,
        amount: String(credited),
        reference: `settle:${result.roundId}`,
        idempotencyKey: `credit:${result.roundId}:${bet.idempotencyKey}`,
      });
      balanceAfter = c.balanceAfter;
    }

    return {
      betId: `bet_${result.roundId}`,
      roundId: result.roundId,
      outcome: outcomeFor(s.type, netProfit),
      stake: String(stake),
      payout: String(credited),
      netProfit: String(netProfit),
      multiplier: s.multiplier ?? (stake > 0 ? credited / stake : 0),
      balanceAfter,
      settledAt: new Date(result.computedAt).toISOString(),
      metadata: s.metadata,
    };
  }

  /** Default multiplicative settlement (unchanged from Phase 2.2). */
  private async settleMultiplicative(
    stake: number,
    input: { session: IGameSession; result: IGameResult; bet: IBetRequest; wallet: IWalletProvider },
  ): Promise<IBetResult> {
    const { result, bet, wallet, session } = input;
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
