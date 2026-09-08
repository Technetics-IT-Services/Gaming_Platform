import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { GameMoneyRecoveryService } from './game-money-recovery.service';

/**
 * Phase 2C.1 — recovery INTEGRATION against a real Postgres + Redis (gated on `RUN_DB_IT=1`;
 * skipped otherwise so the default unit suite needs no DB). Uses only real services — real
 * reservations (WalletEngine) and the real bridge recovery — no faked money, no direct
 * balance/ledger mutation. Proves: settlement recovery, the invariant, reconcile balanced,
 * no duplicate ledger entries, concurrent single-settlement, and max-retry → RECOVERY_FAILED.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

async function ledgerBalanced(prisma: PrismaService): Promise<{ balanced: boolean; difference: string }> {
  const rows = await prisma.ledgerEntry.groupBy({ by: ['direction'], _sum: { amount: true } });
  let debit = 0;
  let credit = 0;
  for (const r of rows) {
    const v = Number(r._sum.amount ?? 0);
    if (r.direction === 'DEBIT') debit = v;
    else credit = v;
  }
  return { balanced: Math.abs(debit - credit) < 1e-9, difference: String(debit - credit) };
}

d('GameMoneyRecovery (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wallet: WalletEngineService;
  let recovery: GameMoneyRecoveryService;
  let inrId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    wallet = app.get(WalletEngineService);
    recovery = app.get(GameMoneyRecoveryService);
    inrId = (await prisma.currency.findUnique({ where: { code: 'INR' } }))!.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  async function pendingRound(fund: string, stake: string, payout: string) {
    const u = await prisma.user.create({ data: { email: `it_${randomUUID()}@t.local`, username: `it${randomUUID().slice(0, 12)}`, status: 'ACTIVE', authProvider: 'LOCAL' } });
    await wallet.credit(u.id, inrId, { amount: fund, typeCode: 'DEPOSIT', description: 'it fund' });
    const round = await prisma.gameRound.create({ data: { userId: u.id, gameKey: 'dice', variant: 'sic-bo', betType: 'big', currencyId: inrId, stake, payout, status: 'PENDING_SETTLEMENT', idempotencyKey: randomUUID(), result: { values: [4, 5, 6], total: 15, winningBets: Number(payout) > 0 ? ['big'] : [] }, fairness: { serverSeed: 's', serverSeedHash: 'h', clientSeed: 'c', nonce: 1 } } });
    const reserved = await wallet.reserve(u.id, inrId, stake, `round:${round.id}`, `${round.id}:reserve`);
    await prisma.gameRound.update({ where: { id: round.id }, data: { reservationId: reserved.reservationId } });
    return { userId: u.id, roundId: round.id };
  }

  it('recovers a pending WIN: invariant holds, reconcile balanced, no duplicate ledger', async () => {
    const { userId, roundId } = await pendingRound('100', '10', '20');
    const out = await recovery.recoverOne(roundId);
    expect(out).toBe('recovered');

    const w = await wallet.getOrCreateWallet(userId, inrId);
    expect(Number(w.available)).toBe(100 - 10 + 20); // balanceAfter = before - stake + payout
    expect(Number(w.available)).toBeGreaterThanOrEqual(0);
    expect((await prisma.gameRound.findUnique({ where: { id: roundId } }))!.status).toBe('RECOVERED');

    const rec1 = await ledgerBalanced(prisma);
    expect(rec1.balanced).toBe(true);
    expect(rec1.difference).toBe('0');

    const ledgerCountBefore = await prisma.ledgerEntry.count();
    const again = await recovery.recoverOne(roundId); // idempotent
    expect(again).toBe('skipped');
    expect(await prisma.ledgerEntry.count()).toBe(ledgerCountBefore); // no duplicate ledger rows
  }, 30_000);

  it('recovers a pending LOSS (payout 0): stake consumed, reconcile balanced', async () => {
    const { userId, roundId } = await pendingRound('50', '10', '0');
    expect(await recovery.recoverOne(roundId)).toBe('recovered');
    const w = await wallet.getOrCreateWallet(userId, inrId);
    expect(Number(w.available)).toBe(50 - 10 + 0);
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 30_000);

  it('concurrent recovery settles exactly once (no double-settle, no dup ledger)', async () => {
    const { roundId } = await pendingRound('100', '10', '20');
    const before = await prisma.ledgerEntry.count();
    const [a, b] = await Promise.all([recovery.recoverOne(roundId), recovery.recoverOne(roundId)]);
    expect([a, b].filter((x) => x === 'recovered').length).toBe(1);
    expect([a, b].filter((x) => x === 'skipped').length).toBe(1);
    expect((await prisma.gameRound.findUnique({ where: { id: roundId } }))!.status).toBe('RECOVERED');
    // exactly one bet(2) + one win(2) journal = 4 new ledger entries
    expect(await prisma.ledgerEntry.count()).toBe(before + 4);
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 30_000);

  it('retries a broken reservation to RECOVERY_FAILED (never silently dropped)', async () => {
    const u = await prisma.user.create({ data: { email: `it_${randomUUID()}@t.local`, username: `it${randomUUID().slice(0, 12)}`, status: 'ACTIVE', authProvider: 'LOCAL' } });
    const round = await prisma.gameRound.create({ data: { userId: u.id, gameKey: 'dice', variant: 'sic-bo', betType: 'big', currencyId: inrId, stake: '10', payout: '0', status: 'PENDING_SETTLEMENT', idempotencyKey: randomUUID(), reservationId: randomUUID() } });
    for (let i = 0; i < 5; i += 1) await recovery.recoverOne(round.id); // reservation does not exist → each attempt fails
    expect((await prisma.gameRound.findUnique({ where: { id: round.id } }))!.status).toBe('RECOVERY_FAILED');
    expect(await recovery.recoverOne(round.id)).toBe('skipped'); // terminal — not re-attempted
  }, 30_000);
});
