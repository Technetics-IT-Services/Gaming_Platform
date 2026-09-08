import { randomUUID } from 'node:crypto';

import { NotFoundException, type INestApplication } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { CashierService } from '../wallet/cashier.service';
import { NotificationsService } from './notifications.service';

/**
 * Phase 2D.1 — notifications INTEGRATION against real Postgres + Redis (gated on `RUN_DB_IT=1`).
 *
 * Uses the real application graph: the real cashier, the real frozen WalletEngine, the real ledger and
 * the real notification service. Proves the guarantees that only a database can prove — durable
 * deduplication under concurrency and across a restart, ownership isolation, and that notifications
 * are strictly downstream of money.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

async function ledgerBalanced(prisma: PrismaService): Promise<boolean> {
  const rows = await prisma.ledgerEntry.groupBy({ by: ['direction'], _sum: { amount: true } });
  let debit = 0;
  let credit = 0;
  for (const r of rows) {
    const v = Number(r._sum.amount ?? 0);
    if (r.direction === 'DEBIT') debit = v;
    else credit = v;
  }
  return Math.abs(debit - credit) < 1e-6;
}

d('Notifications (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wallet: WalletEngineService;
  let cashier: CashierService;
  let notifications: NotificationsService;
  let inrId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    wallet = app.get(WalletEngineService);
    cashier = app.get(CashierService);
    notifications = app.get(NotificationsService);
    inrId = (await prisma.currency.findUnique({ where: { code: 'INR' } }))!.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  async function player(): Promise<string> {
    const u = await prisma.user.create({
      data: { email: `nt_${randomUUID()}@t.local`, username: `nt${randomUUID().slice(0, 12)}`, status: 'ACTIVE', authProvider: 'LOCAL' },
    });
    return u.id;
  }

  async function funded(amount: string): Promise<string> {
    const id = await player();
    await wallet.credit(id, inrId, { amount, typeCode: 'DEPOSIT', description: 'it fund' });
    return id;
  }

  const countFor = (userId: string) => prisma.notification.count({ where: { userId } });

  /* ----------------------------------------------------- idempotency (Phase F) */

  it('the SAME event twice creates exactly ONE notification', async () => {
    const userId = await player();
    const key = `it:dup:${randomUUID()}`;
    const first = await notifications.create({ userId, type: NotificationType.SYSTEM, title: 'T', body: 'B', eventKey: key });
    const second = await notifications.create({ userId, type: NotificationType.SYSTEM, title: 'T', body: 'B', eventKey: key });

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // deduplicated, not an error
    expect(await countFor(userId)).toBe(1);
  }, 30_000);

  it('CONCURRENT delivery of the same event creates exactly ONE notification', async () => {
    const userId = await player();
    const key = `it:conc:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        notifications.create({ userId, type: NotificationType.SYSTEM, title: 'T', body: 'B', eventKey: key })),
    );
    expect(results.filter(Boolean)).toHaveLength(1); // exactly one writer won
    expect(await countFor(userId)).toBe(1);
  }, 30_000);

  it('deduplication SURVIVES a service restart (it is a database constraint, not memory)', async () => {
    const userId = await player();
    const key = `it:restart:${randomUUID()}`;
    await notifications.create({ userId, type: NotificationType.SYSTEM, title: 'T', body: 'B', eventKey: key });

    // A brand-new application graph — nothing in memory carries over.
    const ref2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app2 = ref2.createNestApplication();
    await app2.init();
    const fresh = app2.get(NotificationsService);
    const again = await fresh.create({ userId, type: NotificationType.SYSTEM, title: 'T', body: 'B', eventKey: key });
    await app2.close();

    expect(again).toBeNull();
    expect(await countFor(userId)).toBe(1);
  }, 90_000);

  /* -------------------------------------------------- ownership (Phase G) */

  it('Player A cannot read, get or mark-read Player B notifications', async () => {
    const a = await player();
    const b = await player();
    const created = await notifications.create({ userId: b, type: NotificationType.SECURITY, title: 'B only', body: 'secret-ish', eventKey: `it:own:${randomUUID()}` });

    const aList = await notifications.listForUser(a, { page: 1, limit: 50, sortOrder: 'desc' } as never);
    expect(aList.items).toHaveLength(0);
    expect(aList.unread).toBe(0);

    await expect(notifications.getForUser(a, created!.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(notifications.markAsRead(a, created!.id)).rejects.toBeInstanceOf(NotFoundException);

    // B's row is untouched.
    const still = await prisma.notification.findUnique({ where: { id: created!.id } });
    expect(still!.readAt).toBeNull();
  }, 30_000);

  it('markAllAsRead only affects the caller', async () => {
    const a = await player();
    const b = await player();
    await notifications.create({ userId: a, type: NotificationType.SYSTEM, title: 'a1', body: 'x', eventKey: `it:ma:a:${randomUUID()}` });
    await notifications.create({ userId: b, type: NotificationType.SYSTEM, title: 'b1', body: 'x', eventKey: `it:ma:b:${randomUUID()}` });

    await notifications.markAllAsRead(a);

    expect((await notifications.unreadCount(a)).unread).toBe(0);
    expect((await notifications.unreadCount(b)).unread).toBe(1); // B untouched
  }, 30_000);

  /* --------------------------------------------- read state persistence */

  it('read state is DURABLE — it survives a re-read from the database', async () => {
    const userId = await player();
    const n = await notifications.create({ userId, type: NotificationType.SYSTEM, title: 'T', body: 'B', eventKey: `it:read:${randomUUID()}` });
    await notifications.markAsRead(userId, n!.id);

    const row = await prisma.notification.findUnique({ where: { id: n!.id } });
    expect(row!.readAt).not.toBeNull();
    expect(row!.status).toBe('READ');
    expect((await notifications.unreadCount(userId)).unread).toBe(0);
  }, 30_000);

  it('pagination is deterministic across pages (no duplicate or skipped rows)', async () => {
    const userId = await player();
    for (let i = 0; i < 25; i += 1) {
      await notifications.create({ userId, type: NotificationType.SYSTEM, title: `n${i}`, body: 'x', eventKey: `it:page:${userId}:${i}` });
    }
    const p1 = await notifications.listForUser(userId, { page: 1, limit: 10, sortOrder: 'desc' } as never);
    const p2 = await notifications.listForUser(userId, { page: 2, limit: 10, sortOrder: 'desc' } as never);
    const p3 = await notifications.listForUser(userId, { page: 3, limit: 10, sortOrder: 'desc' } as never);

    const ids = [...p1.items, ...p2.items, ...p3.items].map((n) => n.id);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25); // every row exactly once
    expect(p1.total).toBe(25);
  }, 60_000);

  /* ------------------------------------- financial events (Phases D + E + O) */

  it('a real DEPOSIT lifecycle produces exactly one notification per transition', async () => {
    const userId = await player();
    const dep = await cashier.createDeposit(userId, { amount: '300', currency: 'INR', idempotencyKey: randomUUID() });
    await cashier.completeDeposit(dep.id, { id: userId, roles: ['admin'] });
    await cashier.completeDeposit(dep.id, { id: userId, roles: ['admin'] }); // idempotent replay

    const rows = await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const kinds = rows.map((r) => (r.data as Record<string, unknown>).kind);
    expect(kinds).toContain('deposit.requested');
    expect(kinds).toContain('deposit.completed');
    expect(kinds.filter((k) => k === 'deposit.completed')).toHaveLength(1); // NOT duplicated by the replay
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 60_000);

  it('a real WITHDRAWAL rejection notifies the refund once and leaves the ledger balanced', async () => {
    const userId = await funded('1000');
    const wd = await cashier.createWithdrawal(userId, { amount: '250', currency: 'INR', idempotencyKey: randomUUID() });
    await cashier.rejectWithdrawal(wd.id, 'kyc failed', { id: userId, roles: ['admin'] });
    await cashier.rejectWithdrawal(wd.id, 'kyc failed', { id: userId, roles: ['admin'] }); // no second refund

    const rows = await prisma.notification.findMany({ where: { userId } });
    const rejected = rows.filter((r) => (r.data as Record<string, unknown>).kind === 'withdrawal.rejected');
    expect(rejected).toHaveLength(1);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 60_000);

  it('FINANCIAL SAFETY: a notification failure does not roll back or alter the money movement', async () => {
    const userId = await player();
    const spy = jest.spyOn(notifications, 'create').mockRejectedValue(new Error('notification store down'));
    try {
      const before = Number((await wallet.getOrCreateWallet(userId, inrId)).available);
      const dep = await cashier.createDeposit(userId, { amount: '400', currency: 'INR', idempotencyKey: randomUUID() });
      const done = await cashier.completeDeposit(dep.id, { id: userId, roles: ['admin'] });
      const after = Number((await wallet.getOrCreateWallet(userId, inrId)).available);

      expect(done.status).toBe('COMPLETED'); // the transition still succeeded
      expect(after).toBe(before + 400);      // the money still moved, exactly once
      expect(await ledgerBalanced(prisma)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);

  it('no notification payload contains credential material', async () => {
    const userId = await funded('500');
    const dep = await cashier.createDeposit(userId, { amount: '100', currency: 'INR', idempotencyKey: randomUUID() });
    await cashier.completeDeposit(dep.id, { id: userId, roles: ['admin'] });

    const rows = await prisma.notification.findMany({ where: { userId } });
    const dump = JSON.stringify(rows).toLowerCase();
    for (const forbidden of ['password', 'passwordhash', 'refreshtoken', 'accesstoken', 'serverseed', 'secret', 'authorization']) {
      expect(dump).not.toContain(forbidden);
    }
  }, 30_000);
});
