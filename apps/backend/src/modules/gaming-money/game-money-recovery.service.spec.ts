import { GameRoundStatus } from '@prisma/client';

import { GameMoneyRecoveryService } from './game-money-recovery.service';

/**
 * Phase 2C.1 — recovery orchestration (unit, mocked). Proves discovery, the authoritative
 * DB claim (concurrency guard), retry/backoff, max-attempt → RECOVERY_FAILED, and that the
 * existing bridge.recover() is the only settlement path. Live end-to-end (real reservation →
 * ledger, concurrency, restart) is proven separately against Postgres.
 */

function make(over: { claimCount?: number; recover?: jest.Mock; attempt?: number } = {}) {
  const prisma = {
    gameRound: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: over.claimCount ?? 1 }),
      findUnique: jest.fn().mockResolvedValue({ id: 'r1', userId: 'u1', recoveryAttempts: over.attempt ?? 1 }),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const bridge = { recover: over.recover ?? jest.fn().mockResolvedValue({ status: GameRoundStatus.RECOVERED }) };
  const redis = { raw: { set: jest.fn().mockResolvedValue('OK') }, get: jest.fn().mockResolvedValue('tok'), del: jest.fn() };
  const svc = new GameMoneyRecoveryService(prisma as never, bridge as never, redis as never);
  return { svc, prisma, bridge };
}

describe('GameMoneyRecoveryService', () => {
  it('discovers only due PENDING_SETTLEMENT rounds under the attempt cap', async () => {
    const { svc, prisma } = make();
    await svc.findDue();
    const where = prisma.gameRound.findMany.mock.calls[0][0].where;
    expect(where.status).toBe(GameRoundStatus.PENDING_SETTLEMENT);
    expect(where.recoveryAttempts).toEqual({ lt: 5 });
    expect(where.OR).toBeDefined();
  });

  it('claims via a guarded DB transition and recovers via the bridge', async () => {
    const { svc, prisma, bridge } = make({ claimCount: 1 });
    const outcome = await svc.recoverOne('r1');
    expect(prisma.gameRound.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1', status: GameRoundStatus.PENDING_SETTLEMENT },
      data: expect.objectContaining({ status: GameRoundStatus.RECOVERING, recoveryAttempts: { increment: 1 } }),
    }));
    expect(bridge.recover).toHaveBeenCalledWith('r1');
    expect(outcome).toBe('recovered');
  });

  it('skips when another worker already claimed the round (no double settlement)', async () => {
    const { svc, bridge } = make({ claimCount: 0 });
    const outcome = await svc.recoverOne('r1');
    expect(outcome).toBe('skipped');
    expect(bridge.recover).not.toHaveBeenCalled(); // authoritative DB claim prevented it
  });

  it('retries with backoff on a transient failure below the cap', async () => {
    const { svc, prisma } = make({ attempt: 2, recover: jest.fn().mockRejectedValue(new Error('db down')) });
    const outcome = await svc.recoverOne('r1');
    expect(outcome).toBe('retry');
    const data = prisma.gameRound.update.mock.calls.at(-1)![0].data;
    expect(data.status).toBe(GameRoundStatus.PENDING_SETTLEMENT);
    expect(data.nextRecoveryAt).toBeInstanceOf(Date);
  });

  it('marks RECOVERY_FAILED at the max attempt (never silently dropped)', async () => {
    const { svc, prisma } = make({ attempt: 5, recover: jest.fn().mockRejectedValue(new Error('reservation not found')) });
    const outcome = await svc.recoverOne('r1');
    expect(outcome).toBe('failed');
    const data = prisma.gameRound.update.mock.calls.at(-1)![0].data;
    expect(data.status).toBe(GameRoundStatus.RECOVERY_FAILED);
  });

  it('sweep aggregates outcomes', async () => {
    const { svc, prisma } = make();
    prisma.gameRound.findMany.mockResolvedValueOnce([{ id: 'r1', recoveryAttempts: 0 }]);
    const summary = await svc.sweep();
    expect(summary.scanned).toBe(1);
    expect(summary.recovered).toBe(1);
  });

  it('reports recovery health counts', async () => {
    const { svc, prisma } = make();
    prisma.gameRound.count.mockResolvedValue(3);
    const h = await svc.health();
    expect(h.pending).toBe(3);
    expect(h).toHaveProperty('oldestPendingAgeMs');
  });
});
