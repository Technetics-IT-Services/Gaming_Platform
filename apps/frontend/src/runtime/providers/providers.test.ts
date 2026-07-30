import type { IBetRequest, IGameResult, IGameSession, IWalletProvider } from '@gaming-platform/types';
import { BetMode, BetOutcome, SessionStatus } from '@gaming-platform/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStats } from '@/stores/game-stats';
import { usePlayerProfile } from '@/stores/player-profile';
import { RuntimeError, RuntimeErrorCode } from '../errors';
import { createProviderSet } from './index';
import {
  DemoAnalyticsProvider,
  DemoLeaderboardProvider,
  DemoNotificationProvider,
  RealAnalyticsProvider,
  RealLeaderboardProvider,
  RealNotificationProvider,
} from './observability';
import { DemoHistoryProvider, type DemoHistoryRecord, RealHistoryProvider } from './history';
import { DemoSettlementProvider, RealSettlementProvider } from './settlement';
import { DemoWalletProvider, RealWalletProvider } from './wallet';

/**
 * Provider infrastructure (STEP 6).
 *
 * Verifies every provider satisfies its contract: the demo implementations behave
 * (delegating to the existing stores so UI surfaces stay in sync) and the real
 * implementations remain inactive stubs that throw FEATURE_DISABLED. The provider
 * factory wires the full demo set.
 */

const session: IGameSession = {
  sessionId: 'sess_1',
  gameId: 'crash',
  playerId: 'demo-player',
  currency: 'INR',
  status: SessionStatus.Active,
  createdAt: new Date().toISOString(),
};

const bet: IBetRequest = {
  gameId: 'crash',
  sessionId: 'sess_1',
  stake: { amount: '100', currency: 'INR' },
  mode: BetMode.Single,
  selections: [{ pick: 2 }],
  idempotencyKey: 'idem-1',
};

const result = (over: Partial<IGameResult> = {}): IGameResult => ({
  roundId: 'round_1',
  gameId: 'crash',
  state: { crashPoint: 2 },
  multiplier: 2,
  win: true,
  computedAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  useDemoWallet.getState().reset();
  useDemoWallet.getState().deposit(1000);
});

/** Assert a stub method rejects (async) or throws (sync) with FEATURE_DISABLED. */
async function expectFeatureDisabled(fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    throw new Error('expected FEATURE_DISABLED');
  } catch (err) {
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as RuntimeError).code).toBe(RuntimeErrorCode.FEATURE_DISABLED);
  }
}

describe('provider factory — createProviderSet', () => {
  it('constructs the full demo set', () => {
    const set = createProviderSet();
    expect(set.wallet).toBeInstanceOf(DemoWalletProvider);
    expect(set.settlement).toBeInstanceOf(DemoSettlementProvider);
    expect(set.history).toBeInstanceOf(DemoHistoryProvider);
    expect(set.analytics).toBeInstanceOf(DemoAnalyticsProvider);
    expect(set.notifications).toBeInstanceOf(DemoNotificationProvider);
    expect(set.leaderboard).toBeInstanceOf(DemoLeaderboardProvider);
    expect(set.provablyFair.commit().serverSeed).toMatch(/^[0-9a-f]+$/);
  });

  it('exposes all seven contract slots', () => {
    const set = createProviderSet();
    expect(Object.keys(set).sort()).toEqual(
      ['analytics', 'history', 'leaderboard', 'notifications', 'provablyFair', 'settlement', 'wallet'].sort(),
    );
  });
});

describe('wallet provider (demo)', () => {
  it('reads the balance from the demo store as a Money string', async () => {
    const wallet: IWalletProvider = new DemoWalletProvider();
    expect(await wallet.getBalance('demo-player', 'INR')).toBe('1000');
  });

  it('debits, reducing balance and recording a bet transaction', async () => {
    const wallet: IWalletProvider = new DemoWalletProvider();
    const { balanceAfter } = await wallet.debit({
      playerId: 'demo-player',
      currency: 'INR',
      amount: '250',
      reference: 'stake:crash',
      idempotencyKey: 'debit:1',
    });
    expect(balanceAfter).toBe('750');
    expect(useDemoWallet.getState().balance).toBe(750);
    expect(useDemoWallet.getState().transactions[0].type).toBe('bet');
  });

  it('rejects a debit larger than the balance with INSUFFICIENT_BALANCE', async () => {
    const wallet: IWalletProvider = new DemoWalletProvider();
    await expect(
      wallet.debit({ playerId: 'demo-player', currency: 'INR', amount: '5000', reference: 'x', idempotencyKey: 'y' }),
    ).rejects.toMatchObject({ code: RuntimeErrorCode.INSUFFICIENT_BALANCE });
  });

  it('credits, increasing balance and recording a win transaction', async () => {
    const wallet: IWalletProvider = new DemoWalletProvider();
    const { balanceAfter } = await wallet.credit({
      playerId: 'demo-player',
      currency: 'INR',
      amount: '300',
      reference: 'settle:1',
      idempotencyKey: 'credit:1',
    });
    expect(balanceAfter).toBe('1300');
    expect(useDemoWallet.getState().transactions[0].type).toBe('win');
  });

  it('rejects a non-numeric money value with WALLET_FAILURE', async () => {
    const wallet: IWalletProvider = new DemoWalletProvider();
    await expect(
      wallet.debit({ playerId: 'p', currency: 'INR', amount: 'NaN', reference: 'x', idempotencyKey: 'y' }),
    ).rejects.toMatchObject({ code: RuntimeErrorCode.WALLET_FAILURE });
  });
});

describe('wallet provider (real) — inactive stub', () => {
  it('throws FEATURE_DISABLED for every method', async () => {
    const real = new RealWalletProvider();
    await expectFeatureDisabled(() => real.getBalance());
    await expectFeatureDisabled(() => real.debit());
    await expectFeatureDisabled(() => real.credit());
  });
});

describe('settlement provider (demo)', () => {
  it('settles a win: payout = round(stake × multiplier), credits the wallet', async () => {
    const wallet: IWalletProvider = new DemoWalletProvider();
    const settlement = new DemoSettlementProvider();
    const out = await settlement.settle({ session, result: result({ multiplier: 2, win: true }), bet, wallet });
    expect(out.outcome).toBe(BetOutcome.Win);
    expect(out.payout).toBe('200');
    expect(out.netProfit).toBe('100');
    expect(out.multiplier).toBe(2);
    expect(out.balanceAfter).toBe('1200'); // 1000 + 200 credited
    expect(out.betId).toBe('bet_round_1');
  });

  it('settles a loss: zero payout, no wallet credit', async () => {
    const wallet: IWalletProvider = new DemoWalletProvider();
    const settlement = new DemoSettlementProvider();
    const out = await settlement.settle({ session, result: result({ multiplier: 0, win: false }), bet, wallet });
    expect(out.outcome).toBe(BetOutcome.Loss);
    expect(out.payout).toBe('0');
    expect(out.netProfit).toBe('-100');
    expect(out.balanceAfter).toBeUndefined();
    expect(useDemoWallet.getState().balance).toBe(1000); // untouched
  });

  it('treats win=true with a zero multiplier as a loss (no free payout)', async () => {
    const wallet: IWalletProvider = new DemoWalletProvider();
    const settlement = new DemoSettlementProvider();
    const out = await settlement.settle({ session, result: result({ multiplier: 0, win: true }), bet, wallet });
    expect(out.outcome).toBe(BetOutcome.Loss);
    expect(out.payout).toBe('0');
  });
});

describe('settlement provider (real) — inactive stub', () => {
  it('throws FEATURE_DISABLED', async () => {
    await expectFeatureDisabled(() => new RealSettlementProvider().settle());
  });
});

describe('history provider (demo)', () => {
  const record = (over: Partial<DemoHistoryRecord> = {}): DemoHistoryRecord => ({
    betId: 'bet_round_1',
    roundId: 'round_1',
    outcome: BetOutcome.Win,
    stake: '100',
    payout: '200',
    netProfit: '100',
    multiplier: 2,
    settledAt: new Date().toISOString(),
    playerId: 'demo-player',
    gameId: 'crash',
    gameName: 'Crash',
    displayLabel: '2.00×',
    displayValue: 2,
    ...over,
  });

  it('records a win into the wallet bet ledger and per-game stats', async () => {
    const history = new DemoHistoryProvider();
    const roundsBefore = useGameStats.getState().games.crash.rounds;
    await history.record(record());
    const bets = useDemoWallet.getState().bets;
    expect(bets[0].game).toBe('Crash');
    expect(bets[0].win).toBe(true);
    expect(bets[0].multiplier).toBe(2);
    expect(useGameStats.getState().games.crash.rounds).toBe(roundsBefore + 1);
  });

  it('records a loss with a zero multiplier in the ledger', async () => {
    const history = new DemoHistoryProvider();
    await history.record(record({ outcome: BetOutcome.Loss, netProfit: '-100', multiplier: 0 }));
    expect(useDemoWallet.getState().bets[0].win).toBe(false);
    expect(useDemoWallet.getState().bets[0].multiplier).toBe(0);
  });

  it('lists recorded bets back as IBetResult items', async () => {
    const history = new DemoHistoryProvider();
    await history.record(record());
    const { items } = await history.list({ playerId: 'demo-player', gameId: 'crash', limit: 10 });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].stake).toBe('100');
    expect(items[0].outcome).toBe(BetOutcome.Win);
  });

  it('honours the list limit', async () => {
    const history = new DemoHistoryProvider();
    for (let i = 0; i < 5; i += 1) await history.record(record({ roundId: `round_${i}` }));
    const { items } = await history.list({ playerId: 'demo-player', limit: 3 });
    expect(items).toHaveLength(3);
  });

  it('lists a loss with a zero payout', async () => {
    const history = new DemoHistoryProvider();
    await history.record(record({ outcome: BetOutcome.Loss, netProfit: '-100', multiplier: 0 }));
    const { items } = await history.list({ playerId: 'demo-player' });
    expect(items[0].outcome).toBe(BetOutcome.Loss);
    expect(items[0].payout).toBe('0');
  });

  it('falls back to gameId and a derived label when presentation fields are absent', async () => {
    const history = new DemoHistoryProvider();
    await history.record(record({ gameName: undefined, displayLabel: undefined, displayValue: undefined }));
    // gameName falls back to the gameId in the wallet ledger.
    expect(useDemoWallet.getState().bets[0].game).toBe('crash');
  });

  it('forwards a game-supplied non-multiplier label/value to the stats strip', async () => {
    const history = new DemoHistoryProvider();
    // A dice-style record: label is the roll, value is the roll (not a multiplier).
    await history.record(record({ gameId: 'dice', displayLabel: '73.40', displayValue: 73.4 }));
    const dice = useGameStats.getState().games.dice;
    expect(dice.history[0].label).toBe('73.40');
    expect(dice.history[0].value).toBe(73.4);
  });

  it('awards XP when the record carries a reward, and none when it does not', async () => {
    const history = new DemoHistoryProvider();
    const spy = vi.spyOn(usePlayerProfile.getState(), 'addXp');
    await history.record(record({ xp: 40 }));
    expect(spy).toHaveBeenCalledWith(40);
    spy.mockClear();
    await history.record(record({ xp: undefined }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('history provider (real) — inactive stub', () => {
  it('throws FEATURE_DISABLED for record and list', async () => {
    const real = new RealHistoryProvider();
    await expectFeatureDisabled(() => real.record());
    await expectFeatureDisabled(() => real.list());
  });
});

describe('observability providers', () => {
  it('demo analytics/notifications/leaderboard are safe no-ops', async () => {
    expect(() => new DemoAnalyticsProvider().track()).not.toThrow();
    await expect(new DemoNotificationProvider().notify()).resolves.toBeUndefined();
    await expect(new DemoLeaderboardProvider().submit()).resolves.toBeUndefined();
    await expect(new DemoLeaderboardProvider().top()).resolves.toEqual([]);
  });

  it('real observability stubs throw FEATURE_DISABLED', async () => {
    expect(() => new RealAnalyticsProvider().track()).toThrow(RuntimeError);
    await expectFeatureDisabled(() => new RealNotificationProvider().notify());
    await expectFeatureDisabled(() => new RealLeaderboardProvider().submit());
    await expectFeatureDisabled(() => new RealLeaderboardProvider().top());
  });
});
