import type {
  IAutoBetConfig,
  IBetRequest,
  IBetResult,
  ICashOutRequest,
  ICashOutResult,
  IFairnessProof,
  IGameDescriptor,
  IGameResult,
  IGameSession,
  IStake,
  Money,
} from '@gaming-platform/types';
import {
  BetMode,
  BetOutcome,
  GameLifecyclePhase,
  RiskLevel,
  RoundStatus,
  SessionStatus,
} from '@gaming-platform/types';
import { describe, expect, expectTypeOf, it } from 'vitest';

/**
 * Platform contracts (STEP 9).
 *
 * These are type-only definitions shared across UI, runtime and backend, so a
 * "test" here pins two things: (1) the runtime ENUM values never drift (the wire
 * format), and (2) representative objects remain assignable to each contract shape
 * (compile-time, via expectTypeOf). If a contract changes incompatibly, this file
 * fails to type-check or asserts.
 */

describe('contracts — enum wire values', () => {
  it('BetMode values are stable', () => {
    expect(BetMode.Single).toBe('single');
    expect(BetMode.Multiple).toBe('multiple');
    expect(BetMode.Auto).toBe('auto');
  });

  it('RiskLevel values are stable', () => {
    expect([RiskLevel.Low, RiskLevel.Medium, RiskLevel.High]).toEqual(['low', 'medium', 'high']);
  });

  it('BetOutcome values are stable', () => {
    expect(BetOutcome.Win).toBe('win');
    expect(BetOutcome.Loss).toBe('loss');
    expect(BetOutcome.Push).toBe('push');
    expect(BetOutcome.Void).toBe('void');
    expect(BetOutcome.Refund).toBe('refund');
    expect(BetOutcome.InProgress).toBe('in_progress');
  });

  it('SessionStatus and RoundStatus values are stable', () => {
    expect([SessionStatus.Active, SessionStatus.Idle, SessionStatus.Closed, SessionStatus.Expired]).toEqual([
      'active',
      'idle',
      'closed',
      'expired',
    ]);
    expect([RoundStatus.Pending, RoundStatus.InProgress, RoundStatus.Settled, RoundStatus.Voided, RoundStatus.Refunded]).toEqual([
      'pending',
      'in_progress',
      'settled',
      'voided',
      'refunded',
    ]);
  });

  it('GameLifecyclePhase covers the full canonical pipeline in order', () => {
    expect(Object.values(GameLifecyclePhase)).toEqual([
      'create_session',
      'validate_bet',
      'debit_wallet',
      'execute_engine',
      'calculate_result',
      'settlement',
      'credit_wallet',
      'save_history',
      'update_statistics',
      'notify',
      'analytics',
    ]);
  });
});

describe('contracts — money type', () => {
  it('Money is a decimal string (never a float)', () => {
    const amount: Money = '1234.56';
    expectTypeOf(amount).toEqualTypeOf<string>();
    // A round-trippable, precision-safe representation.
    expect(typeof amount).toBe('string');
  });
});

describe('contracts — shape assignability', () => {
  it('a valid bet request satisfies IBetRequest', () => {
    const stake: IStake = { amount: '10', currency: 'INR' };
    const auto: IAutoBetConfig = { rounds: 10, onWin: { resetStake: true }, stopOnProfit: '500' };
    const req: IBetRequest<number> = {
      gameId: 'crash',
      sessionId: 'sess_1',
      stake,
      mode: BetMode.Auto,
      selections: [{ pick: 2.5, odds: 2 }],
      risk: RiskLevel.Medium,
      autoBet: auto,
      clientSeed: 'seed',
      idempotencyKey: 'idem-1',
      metadata: { foo: 'bar' },
    };
    expectTypeOf(req).toMatchTypeOf<IBetRequest<number>>();
    expect(req.selections[0].pick).toBe(2.5);
  });

  it('a settled result satisfies IBetResult', () => {
    const res: IBetResult = {
      betId: 'bet_1',
      roundId: 'round_1',
      outcome: BetOutcome.Win,
      stake: '100',
      payout: '200',
      netProfit: '100',
      multiplier: 2,
      balanceAfter: '1200',
      settledAt: new Date().toISOString(),
    };
    expectTypeOf(res).toMatchTypeOf<IBetResult>();
    expect(res.outcome).toBe(BetOutcome.Win);
  });

  it('a game session and descriptor satisfy their contracts', () => {
    const session: IGameSession = {
      sessionId: 'sess_1',
      gameId: 'crash',
      playerId: 'demo-player',
      currency: 'INR',
      status: SessionStatus.Active,
      createdAt: new Date().toISOString(),
    };
    const descriptor: IGameDescriptor = {
      gameId: 'crash',
      name: 'Crash',
      engineKey: 'crash',
      category: 'crash',
      capabilities: {
        cashOut: true,
        autoBet: true,
        multiBet: false,
        provablyFair: true,
        realtime: true,
        multiplayer: false,
        liveDealer: false,
        tournament: false,
      },
      config: { minBet: 1, maxBet: 1000 },
    };
    expectTypeOf(session).toMatchTypeOf<IGameSession>();
    expectTypeOf(descriptor).toMatchTypeOf<IGameDescriptor>();
    expect(descriptor.capabilities.cashOut).toBe(true);
  });

  it('a fairness proof and game result satisfy their contracts', () => {
    const fairness: IFairnessProof = { serverSeed: 's', serverSeedHash: 'h', clientSeed: 'c', nonce: 1 };
    const result: IGameResult<{ crashPoint: number }> = {
      roundId: 'round_1',
      gameId: 'crash',
      state: { crashPoint: 2.5 },
      multiplier: 0,
      win: false,
      fairness,
      computedAt: new Date().toISOString(),
    };
    expectTypeOf(result).toMatchTypeOf<IGameResult<{ crashPoint: number }>>();
    expect(result.state.crashPoint).toBe(2.5);
  });

  it('cash-out request/result satisfy their contracts', () => {
    const req: ICashOutRequest = { sessionId: 's', roundId: 'r', atMultiplier: 2.3, idempotencyKey: 'k' };
    const res: ICashOutResult = { roundId: 'r', multiplier: 2.3, payout: '230', settledAt: new Date().toISOString() };
    expectTypeOf(req).toMatchTypeOf<ICashOutRequest>();
    expectTypeOf(res).toMatchTypeOf<ICashOutResult>();
    expect(res.multiplier).toBe(2.3);
  });
});

describe('contracts — backwards compatibility', () => {
  it('optional fields may be omitted (forward/backward compatible)', () => {
    // Minimal bet — no risk, autoBet, clientSeed, metadata.
    const minimal: IBetRequest = {
      gameId: 'dice',
      sessionId: 's',
      stake: { amount: '1', currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: 50 }],
      idempotencyKey: 'k',
    };
    expect(minimal.risk).toBeUndefined();
    // Minimal result — no balanceAfter.
    const minimalResult: IBetResult = {
      betId: 'b',
      roundId: 'r',
      outcome: BetOutcome.Loss,
      stake: '1',
      payout: '0',
      netProfit: '-1',
      multiplier: 0,
      settledAt: new Date().toISOString(),
    };
    expect(minimalResult.balanceAfter).toBeUndefined();
  });
});
