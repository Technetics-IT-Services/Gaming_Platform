import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { GameMoneyHistoryService } from './game-money-history.service';

/**
 * Phase 2C.4 — read-only history/traceability. Unit tests with a mocked Prisma prove: netResult =
 * payout − stake (Decimal, no float), ownership isolation, missing-round handling, provably-fair
 * secret redaction while a round is in flight, and that NO financial write occurs. Full join
 * assembly + RBAC are proven live against Postgres.
 */

const D = (v: string) => new Prisma.Decimal(v);

function round(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', userId: 'u1', gameKey: 'dice', variant: 'sic-bo', betType: 'big', currencyId: 'c1',
    stake: D('10'), payout: D('20'), status: 'SETTLED', idempotencyKey: 'k1', reservationId: 'res1', betTransactionId: 'tx1',
    result: { values: [4, 5, 6], serverSeed: 'SECRET', seed: 'SEEDSECRET' }, fairness: { serverSeedHash: 'h', serverSeed: 'SECRET' },
    recoveryAttempts: 0, lastRecoveryAt: null, nextRecoveryAt: null, error: null, createdAt: new Date('2026-08-20T00:00:00Z'), settledAt: new Date('2026-08-20T00:00:01Z'),
    ...over,
  };
}

function makeService(over: { round?: unknown; txns?: unknown[]; reservation?: unknown; ledgers?: unknown[] } = {}) {
  const prisma = {
    gameRound: {
      findUnique: jest.fn().mockResolvedValue(over.round === undefined ? round() : over.round),
      findMany: jest.fn().mockResolvedValue([round()]),
      count: jest.fn().mockResolvedValue(1),
    },
    walletTransaction: { findMany: jest.fn().mockResolvedValue(over.txns ?? []) },
    lockedFunds: { findUnique: jest.fn().mockResolvedValue(over.reservation ?? null) },
    ledger: { findMany: jest.fn().mockResolvedValue(over.ledgers ?? []) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', email: 'p@t.local', username: 'p', status: 'ACTIVE', createdAt: new Date() }) },
    wallet: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  return { service: new GameMoneyHistoryService(prisma as never), prisma };
}

describe('listRounds', () => {
  it('returns netResult = payout − stake (Decimal string) and the paginated shape', async () => {
    const { service, prisma } = makeService();
    const res = await service.listRounds('u1', { page: 1, limit: 20, gameKey: 'dice' });
    expect(res.items[0]!.netResult).toBe('10'); // 20 − 10
    expect(res.items[0]!.roundId).toBe('r1');
    expect(res).toMatchObject({ total: 1, page: 1, limit: 20, pages: 1 });
    // ownership + filters applied in the where clause
    expect(prisma.gameRound.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'u1', gameKey: 'dice' });
  });

  it('computes a negative netResult for a loss', async () => {
    const loss = makeService();
    loss.prisma.gameRound.findMany.mockResolvedValueOnce([round({ payout: D('0') })]);
    const res = await loss.service.listRounds('u1', {});
    expect(res.items[0]!.netResult).toBe('-10');
  });
});

describe('roundDetails — ownership & redaction', () => {
  it("rejects another user's round", async () => {
    const { service } = makeService({ round: round({ userId: 'someone-else' }) });
    await expect(service.roundDetails('u1', 'r1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFound for a missing round', async () => {
    const { service } = makeService({ round: null });
    await expect(service.roundDetails('u1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reveals the server seed for a SETTLED (terminal) round', async () => {
    const { service } = makeService({ round: round({ status: 'SETTLED' }) });
    const res = await service.roundDetails('u1', 'r1');
    expect((res.round.result as Record<string, unknown>).serverSeed).toBe('SECRET');
    expect((res.round.fairness as Record<string, unknown>).serverSeed).toBe('SECRET');
  });

  it('REDACTS the server seed / seed while a round is still active (RESERVED)', async () => {
    const { service } = makeService({ round: round({ status: 'RESERVED' }) });
    const res = await service.roundDetails('u1', 'r1');
    expect((res.round.result as Record<string, unknown>).serverSeed).toBeUndefined();
    expect((res.round.result as Record<string, unknown>).seed).toBeUndefined();
    expect((res.round.result as Record<string, unknown>).values).toEqual([4, 5, 6]); // non-secret kept
    expect((res.round.fairness as Record<string, unknown>).serverSeed).toBeUndefined();
    expect((res.round.fairness as Record<string, unknown>).serverSeedHash).toBe('h'); // commitment kept
  });

  it('assembles reservation + transactions + ledger from the persisted links', async () => {
    const txns = [
      { id: 'tx1', reference: 'round:r1:bet', amount: D('10'), fee: D('0'), balanceBefore: D('100'), balanceAfter: D('90'), description: null, createdAt: new Date(), type: { code: 'BET' }, status: { code: 'COMPLETED' }, currency: { code: 'INR' } },
    ];
    const reservation = { id: 'res1', amount: D('10'), status: 'CONSUMED', reason: 'round:r1', createdAt: new Date(), releasedAt: null };
    const ledgers = [{ id: 'l1', reference: 'round:r1', status: 'POSTED', postedAt: new Date(), entries: [{ id: 'e1', direction: 'DEBIT', amount: D('10'), balanceAfter: D('90'), walletId: 'w1', status: 'POSTED' }] }];
    const { service } = makeService({ round: round(), txns, reservation, ledgers });
    const res = await service.roundDetails('u1', 'r1');
    expect(res.reservation!.id).toBe('res1');
    expect(res.walletTransactions).toHaveLength(1);
    expect(res.settlement!.id).toBe('tx1');
    expect(res.ledger[0]!.entries[0]!.direction).toBe('DEBIT');
    // player view must NOT leak the internal walletId on ledger entries
    expect(res.ledger[0]!.entries[0]!.walletId).toBeUndefined();
  });
});

describe('adminRoundDetails', () => {
  it('adds player + recovery state and exposes walletId on ledger entries', async () => {
    const ledgers = [{ id: 'l1', reference: 'round:r1', status: 'POSTED', postedAt: new Date(), entries: [{ id: 'e1', direction: 'CREDIT', amount: D('20'), balanceAfter: D('110'), walletId: 'w1', status: 'POSTED' }] }];
    const { service } = makeService({ round: round({ recoveryAttempts: 2, error: 'boom' }), ledgers });
    const res = await service.adminRoundDetails('r1');
    expect(res.player!.id).toBe('u1');
    expect(res.recovery.recoveryAttempts).toBe(2);
    expect(res.recovery.error).toBe('boom');
    expect(res.ledger[0]!.entries[0]!.walletId).toBe('w1'); // admin sees the wallet id
  });
});
