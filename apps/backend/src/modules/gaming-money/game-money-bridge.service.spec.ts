import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { GameRoundStatus } from '@prisma/client';

import { GameMoneyBridgeService } from './game-money-bridge.service';

/**
 * Phase 2B — Game Money Bridge orchestration. Unit tests with mocked collaborators
 * (Prisma, WalletEngine, DiceEngine) to prove the money flow, idempotency, validation and
 * failure-recovery policy WITHOUT re-implementing wallet/ledger/game math. End-to-end
 * financial invariants are additionally proven live against Postgres.
 */

const CURRENCY = { id: 'cur-inr', code: 'INR', decimals: 2, isActive: true };
const RULESET = { key: 'sic-bo', name: 'Sic Bo', limits: { min: 1, max: 10000 }, bets: [{ key: 'big' }, { key: 'small' }] };

function diceResult(totalBet: string, totalWin: string) {
  return {
    result: { values: [4, 5, 6], total: 15, isTriple: false, winningBets: totalWin !== '0' ? ['big'] : [], settlement: { totalBet, totalWin, net: '0' } },
    fairness: { serverSeed: 'ss', serverSeedHash: 'hash', clientSeed: 'cs', nonce: 1 },
  };
}

function makeBridge(over: {
  user?: unknown; currency?: unknown; existingRound?: unknown;
  reserve?: jest.Mock; commit?: jest.Mock; release?: jest.Mock; play?: jest.Mock; resolve?: jest.Mock;
} = {}) {
  const round: Record<string, unknown> = { id: 'round-1', userId: 'u1', variant: 'sic-bo', betType: 'big', currencyId: 'cur-inr', stake: '10', payout: '0', status: GameRoundStatus.CREATED, betTransactionId: null, reservationId: null, result: null, fairness: null };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(over.user === undefined ? { id: 'u1', status: 'ACTIVE', deletedAt: null } : over.user) },
    currency: { findUnique: jest.fn().mockResolvedValue(over.currency === undefined ? CURRENCY : over.currency) },
    gameRound: {
      findUnique: jest.fn().mockResolvedValue(over.existingRound ?? null),
      create: jest.fn().mockResolvedValue({ ...round }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(round, data); return Promise.resolve({ ...round }); }),
    },
  };
  const wallet = {
    reserve: over.reserve ?? jest.fn().mockResolvedValue({ reservationId: 'res-1', wallet: {} }),
    commitReservation: over.commit ?? jest.fn().mockResolvedValue({ transactionId: 'tx-1', reference: 'round:round-1:bet', wallet: { available: '100', total: '100' } }),
    releaseReservation: over.release ?? jest.fn().mockResolvedValue({ transactionId: 'tx-r', reference: 'r', wallet: { available: '100', total: '100' } }),
    getOrCreateWallet: jest.fn().mockResolvedValue({ available: '100', total: '100' }),
  };
  const dice = { play: over.play ?? jest.fn().mockResolvedValue(diceResult('10', '0')) };
  const variants = { resolve: over.resolve ?? jest.fn().mockResolvedValue(RULESET) };
  // Crash/Roulette collaborators are unused by the dice path but required by the constructor.
  const crash = { play: jest.fn() };
  const crashVariants = { resolve: jest.fn() };
  const roulette = { play: jest.fn() };
  const rouletteVariants = { resolve: jest.fn() };
  const fair = { createCommit: jest.fn(), deriveSeed: jest.fn(), hash: jest.fn(), verify: jest.fn() };
  const card = { play: jest.fn() };
  const cardVariants = { resolve: jest.fn() };
  const bridge = new GameMoneyBridgeService(
    prisma as never, wallet as never, dice as never, variants as never,
    crash as never, crashVariants as never, roulette as never, rouletteVariants as never, fair as never,
    card as never, cardVariants as never,
  );
  return { bridge, prisma, wallet, dice, variants };
}

const base = { userId: 'u1', variant: 'sic-bo', betType: 'big', stake: '10', currencyCode: 'INR', idempotencyKey: 'idem-123' };

describe('GameMoneyBridge — validation & auth', () => {
  it('rejects a blocked (suspended) account before any money moves', async () => {
    const { bridge, wallet } = makeBridge({ user: { id: 'u1', status: 'SUSPENDED', deletedAt: null } });
    await expect(bridge.playDice(base)).rejects.toBeInstanceOf(ForbiddenException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });
  it('rejects an unsupported currency', async () => {
    const { bridge, wallet } = makeBridge({ currency: null });
    await expect(bridge.playDice(base)).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });
  it('rejects an unknown bet type', async () => {
    const { bridge, wallet } = makeBridge();
    await expect(bridge.playDice({ ...base, betType: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });
  it.each([['0'], ['-5'], ['1.999'], ['99999']])('rejects invalid stake %s with no debit', async (stake) => {
    const { bridge, wallet } = makeBridge();
    await expect(bridge.playDice({ ...base, stake })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });
});

describe('GameMoneyBridge — settlement', () => {
  it('settles a WIN: reserve → play → commit(payout) → SETTLED, invariant balance returned', async () => {
    const { bridge, wallet, dice } = makeBridge({ play: jest.fn().mockResolvedValue(diceResult('10', '20')) });
    const res = await bridge.playDice(base);
    expect(wallet.reserve).toHaveBeenCalledWith('u1', 'cur-inr', '10', 'round:round-1', 'round-1:reserve');
    expect(dice.play).toHaveBeenCalledWith('sic-bo', [{ type: 'big', amount: '10' }], undefined);
    expect(wallet.commitReservation).toHaveBeenCalledWith('res-1', '20', 'round:round-1', 'round-1:commit');
    expect(res.status).toBe(GameRoundStatus.SETTLED);
    expect(res.payout).toBe('20');
    expect(res.result.won).toBe(true);
    expect(res.balance.available).toBe('100');
  });
  it('settles a LOSS: commit(0), payout 0', async () => {
    const { bridge, wallet } = makeBridge({ play: jest.fn().mockResolvedValue(diceResult('10', '0')) });
    const res = await bridge.playDice(base);
    expect(wallet.commitReservation).toHaveBeenCalledWith('res-1', '0', 'round:round-1', 'round-1:commit');
    expect(res.payout).toBe('0');
    expect(res.result.won).toBe(false);
  });
});

describe('GameMoneyBridge — idempotency', () => {
  it('replays a settled round without reserving or committing again', async () => {
    const settled = { id: 'round-1', userId: 'u1', variant: 'sic-bo', betType: 'big', currencyId: 'cur-inr', stake: '10', payout: '20', status: GameRoundStatus.SETTLED, betTransactionId: 'tx-1', reservationId: 'res-1', result: { values: [1, 2, 3], total: 6, winningBets: ['big'] }, fairness: { serverSeed: 'ss' } };
    const { bridge, wallet } = makeBridge({ existingRound: settled });
    const res = await bridge.playDice(base);
    expect(res.replayed).toBe(true);
    expect(res.roundId).toBe('round-1');
    expect(wallet.reserve).not.toHaveBeenCalled();
    expect(wallet.commitReservation).not.toHaveBeenCalled();
  });
});

describe('GameMoneyBridge — failure recovery', () => {
  it('insufficient balance → clean 400, marks FAILED, no settlement', async () => {
    const reserve = jest.fn().mockRejectedValue(new Error('Insufficient available balance to reserve'));
    const { bridge, wallet, prisma } = makeBridge({ reserve });
    await expect(bridge.playDice(base)).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.commitReservation).not.toHaveBeenCalled();
    expect(prisma.gameRound.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: GameRoundStatus.FAILED }) }));
  });
  it('engine failure AFTER reserve → releaseReservation (stake refunded), FAILED', async () => {
    const play = jest.fn().mockRejectedValue(new Error('engine boom'));
    const { bridge, wallet } = makeBridge({ play });
    await expect(bridge.playDice(base)).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.releaseReservation).toHaveBeenCalledWith('res-1', 'round-1:release');
    expect(wallet.commitReservation).not.toHaveBeenCalled();
  });
  it('settlement failure → PENDING_SETTLEMENT (recoverable), no stake lost/doubled', async () => {
    const commit = jest.fn().mockRejectedValue(new Error('db down'));
    const { bridge, wallet, prisma } = makeBridge({ commit });
    await expect(bridge.playDice(base)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(wallet.releaseReservation).not.toHaveBeenCalled(); // reservation kept for recovery
    expect(prisma.gameRound.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: GameRoundStatus.PENDING_SETTLEMENT }) }));
  });
  it('recover() re-commits a PENDING_SETTLEMENT round idempotently → RECOVERED', async () => {
    const pending = { id: 'round-1', userId: 'u1', variant: 'sic-bo', betType: 'big', currencyId: 'cur-inr', stake: '10', payout: '20', status: GameRoundStatus.PENDING_SETTLEMENT, betTransactionId: null, reservationId: 'res-1', result: {}, fairness: {} };
    const { bridge, wallet, prisma } = makeBridge();
    prisma.gameRound.findUnique.mockResolvedValueOnce(pending);
    const res = await bridge.recover('round-1');
    expect(wallet.commitReservation).toHaveBeenCalledWith('res-1', '20', 'round:round-1', 'round-1:commit');
    expect(res.status).toBe(GameRoundStatus.RECOVERED);
  });
});
