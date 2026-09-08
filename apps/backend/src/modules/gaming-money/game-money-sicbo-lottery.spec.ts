import { BadRequestException } from '@nestjs/common';
import { GameRoundStatus } from '@prisma/client';

import { GameMoneyBridgeService } from './game-money-bridge.service';

/**
 * Phase 2C.3 — Sic Bo + Number-Lottery money orchestration. Unit tests with mocked collaborators
 * prove the reservation/settlement flow, multi-bet single reservation, validation, idempotency,
 * that a lottery ticket purchase does NOT settle immediately, and that ticket settlement uses the
 * engine's match evaluation — WITHOUT re-implementing wallet/ledger/game math. Live financial
 * invariants (shared draw, execute-once, recovery) are proven separately against Postgres.
 */

const CURRENCY = { id: 'cur-inr', code: 'INR', decimals: 2, isActive: true };
const SICBO_RULESET = {
  key: 'sic-bo', name: 'Sic Bo', diceCount: 3, faces: 6,
  bets: [
    { key: 'big', label: 'Big', category: 'range', payout: 2 },
    { key: 'small', label: 'Small', category: 'range', payout: 2 },
    { key: 'triple-3', label: 'Triple 3', category: 'triple', payout: 181 },
    { key: 'total-10', label: 'Total 10', category: 'total', payout: 7 },
  ],
  limits: { min: 1, max: 10000, tableMax: 50000 },
};

function rollResult(totalBet: string, totalWin: string, winningBets: string[]) {
  return {
    result: { roundId: 'r', variant: 'sic-bo', mode: 'dice', values: [3, 3, 4], total: 10, isTriple: false, winningBets, settlement: { bets: [], totalBet, totalWin, net: '0' }, verification: { seed: 's' } },
    fairness: { serverSeed: 'ss', serverSeedHash: 'hash', clientSeed: 'cs', nonce: 1 },
  };
}

function makeBridge(over: {
  user?: unknown; currency?: unknown; existingRound?: unknown;
  reserve?: jest.Mock; commit?: jest.Mock; dicePlay?: jest.Mock; diceResolve?: jest.Mock;
  ticketRound?: Record<string, unknown>;
} = {}) {
  const round: Record<string, unknown> = { id: 'round-1', userId: 'u1', variant: 'sic-bo', betType: 'big', currencyId: 'cur-inr', stake: '60.00', payout: '0', status: GameRoundStatus.CREATED, betTransactionId: null, reservationId: null, drawId: null, result: null, fairness: null };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(over.user === undefined ? { id: 'u1', status: 'ACTIVE', deletedAt: null } : over.user) },
    currency: { findUnique: jest.fn().mockResolvedValue(over.currency === undefined ? CURRENCY : over.currency) },
    gameRound: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string } }) => {
        if (where.id && over.ticketRound && where.id === over.ticketRound.id) return Promise.resolve(over.ticketRound);
        return Promise.resolve(over.existingRound ?? (where.id ? round : null));
      }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(round, data); return Promise.resolve({ ...round }); }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(round, data); return Promise.resolve({ ...round }); }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const wallet = {
    reserve: over.reserve ?? jest.fn().mockResolvedValue({ reservationId: 'res-1', wallet: {} }),
    commitReservation: over.commit ?? jest.fn().mockResolvedValue({ transactionId: 'tx-1', wallet: { available: '100', total: '100' } }),
    releaseReservation: jest.fn().mockResolvedValue({ transactionId: 'tx-r', wallet: { available: '100', total: '100' } }),
    getOrCreateWallet: jest.fn().mockResolvedValue({ available: '100', total: '100' }),
  };
  const dice = { play: over.dicePlay ?? jest.fn().mockResolvedValue(rollResult('60', '120', ['big', 'total-10'])) };
  const variants = { resolve: over.diceResolve ?? jest.fn().mockResolvedValue(SICBO_RULESET) };
  const noop = { play: jest.fn(), resolve: jest.fn() };
  const fair = { createCommit: jest.fn(), deriveSeed: jest.fn(), hash: jest.fn(), verify: jest.fn() };
  const bridge = new GameMoneyBridgeService(
    prisma as never, wallet as never, dice as never, variants as never,
    noop as never, noop as never, noop as never, noop as never, fair as never,
    noop as never, noop as never,
  );
  return { bridge, prisma, wallet, dice };
}

const DRAW = { id: 'draw-1', drawNumber: 1, status: 'OPEN', poolSize: 49, pick: 6, ticketPrice: { toString: () => '10' } as never, currencyId: 'cur-inr', serverSeed: 's', serverSeedHash: 'h', clientSeed: 'c', nonce: 0, winningNumbers: [], drawAt: new Date(Date.now() + 60000) };

describe('Sic Bo money — multi-bet single reservation, engine-authoritative payout', () => {
  it('reserves the TOTAL stake ONCE and settles ONCE with the engine payout', async () => {
    const { bridge, wallet } = makeBridge();
    const res = await bridge.playSicBo({ userId: 'u1', variant: 'sic-bo', currencyCode: 'INR', idempotencyKey: 'idem-sicbo-1', bets: [{ type: 'big', amount: '20' }, { type: 'small', amount: '20' }, { type: 'total-10', amount: '20' }] });
    expect(wallet.reserve).toHaveBeenCalledTimes(1);
    expect(wallet.reserve.mock.calls[0][2]).toBe('60.00'); // one reservation of the total
    expect(wallet.commitReservation).toHaveBeenCalledTimes(1);
    expect(wallet.commitReservation.mock.calls[0][1]).toBe('120'); // payout from engine
    expect(res.payout).toBe('120');
    expect(res.dice).toEqual([3, 3, 4]);
    expect(res.status).toBe(GameRoundStatus.SETTLED);
  });

  it('rejects an unknown bet type BEFORE reserving any money', async () => {
    const { bridge, wallet } = makeBridge();
    await expect(bridge.playSicBo({ userId: 'u1', variant: 'sic-bo', currencyCode: 'INR', idempotencyKey: 'k', bets: [{ type: 'nonsense', amount: '10' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });

  it('maps an overdraft on reserve to a clean insufficient-balance error', async () => {
    const reserve = jest.fn().mockRejectedValue(new Error('Insufficient available balance to reserve'));
    const { bridge, wallet } = makeBridge({ reserve });
    await expect(bridge.playSicBo({ userId: 'u1', variant: 'sic-bo', currencyCode: 'INR', idempotencyKey: 'k', bets: [{ type: 'big', amount: '10' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.commitReservation).not.toHaveBeenCalled();
  });
});

describe('Number Lottery money — purchase reserves but does NOT settle', () => {
  it('reserves the ticket price and creates a pending ticket (no settlement at purchase)', async () => {
    const { bridge, wallet } = makeBridge();
    const res = await bridge.buyLotteryTicket({ userId: 'u1', picks: [1, 2, 3, 4, 5, 6], currencyCode: 'INR', idempotencyKey: 'idem-lot-1' }, DRAW as never);
    expect(wallet.reserve).toHaveBeenCalledTimes(1);
    expect(wallet.reserve.mock.calls[0][2]).toBe('10'); // ticket price reserved
    expect(wallet.commitReservation).not.toHaveBeenCalled(); // NOT settled at purchase
    expect(res.status).toBe(GameRoundStatus.RESERVED);
    expect(res.settled).toBe(false);
    expect(res.picks).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects the wrong number of picks / out-of-range / duplicates before reserving', async () => {
    const { bridge, wallet } = makeBridge();
    await expect(bridge.buyLotteryTicket({ userId: 'u1', picks: [1, 2, 3], currencyCode: 'INR', idempotencyKey: 'k' }, DRAW as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(bridge.buyLotteryTicket({ userId: 'u1', picks: [1, 2, 3, 4, 5, 99], currencyCode: 'INR', idempotencyKey: 'k' }, DRAW as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(bridge.buyLotteryTicket({ userId: 'u1', picks: [1, 2, 3, 4, 5, 5], currencyCode: 'INR', idempotencyKey: 'k' }, DRAW as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });

  it('settles a ticket using the engine match count + prize tiers (3 matches → ×5)', async () => {
    const ticket = { id: 'tkt-1', userId: 'u1', stake: { toString: () => '10' }, reservationId: 'res-1', result: { picks: [1, 2, 3, 4, 5, 6] }, status: GameRoundStatus.RESERVED };
    const { bridge, wallet, prisma } = makeBridge({ ticketRound: ticket });
    const out = await bridge.settleLotteryTicket('tkt-1', [1, 2, 3, 40, 41, 42], { '3': 5, '4': 50, '5': 500, '6': 50000 });
    expect(out).toBe('settled');
    expect(prisma.gameRound.updateMany).toHaveBeenCalled(); // guarded RESERVED->RESOLVED claim
    expect(wallet.commitReservation).toHaveBeenCalledTimes(1);
    expect(wallet.commitReservation.mock.calls[0][1]).toBe('50.00000000'); // stake 10 × tier 5 (3 matches)
  });

  it('settles a losing ticket as payout 0 (fewer than the lowest tier)', async () => {
    const ticket = { id: 'tkt-2', userId: 'u1', stake: { toString: () => '10' }, reservationId: 'res-1', result: { picks: [1, 2, 3, 4, 5, 6] }, status: GameRoundStatus.RESERVED };
    const { bridge, wallet } = makeBridge({ ticketRound: ticket });
    const out = await bridge.settleLotteryTicket('tkt-2', [40, 41, 42, 43, 44, 45], { '3': 5, '4': 50, '5': 500, '6': 50000 });
    expect(out).toBe('settled');
    expect(wallet.commitReservation.mock.calls[0][1]).toBe('0.00000000'); // 0 matches → prize 0
  });

  it('a duplicate settlement claim is a no-op (idempotent)', async () => {
    const b = makeBridge();
    b.prisma.gameRound.updateMany.mockResolvedValueOnce({ count: 0 }); // already settling/settled
    const out = await b.bridge.settleLotteryTicket('tkt-x', [1, 2, 3, 4, 5, 6], { '6': 50000 });
    expect(out).toBe('skipped');
    expect(b.wallet.commitReservation).not.toHaveBeenCalled();
  });
});
