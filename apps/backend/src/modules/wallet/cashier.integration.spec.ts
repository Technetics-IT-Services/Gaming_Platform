import { randomUUID } from 'node:crypto';

import { BadRequestException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { CashierService } from './cashier.service';

/**
 * Phase 2C.9 — cashier INTEGRATION against real Postgres + Redis (gated on `RUN_DB_IT=1`). Real
 * services only — the real frozen WalletEngineService, real ledger, the real cashier — no faked money.
 * Proves: a deposit stays PENDING with NO credit; operator-complete credits (B1 = B0 + amount);
 * withdrawal HOLDS funds on request (B1 = B0 − amount) and reject/cancel refund back to B0; the
 * financial invariant holds, the ledger reconciles balanced, idempotency debits once, concurrency is
 * safe, and no negative balance is ever produced.
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

d('Cashier (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wallet: WalletEngineService;
  let cashier: CashierService;
  let inrId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    wallet = app.get(WalletEngineService);
    cashier = app.get(CashierService);
    inrId = (await prisma.currency.findUnique({ where: { code: 'INR' } }))!.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  async function fundUser(amount: string): Promise<string> {
    const u = await prisma.user.create({ data: { email: `it_${randomUUID()}@t.local`, username: `it${randomUUID().slice(0, 12)}`, status: 'ACTIVE', authProvider: 'LOCAL' } });
    await wallet.credit(u.id, inrId, { amount, typeCode: 'DEPOSIT', description: 'it fund' });
    return u.id;
  }
  const avail = async (userId: string) => Number((await wallet.getOrCreateWallet(userId, inrId)).available);

  /**
   * A REAL operator actor, shaped exactly as `AdminCashierController` builds it from the JWT.
   *
   * Phase 2C.17 (P0-5): the previous spec called `approveWithdrawal(id, undefined)`, so `reviewedById`
   * was always null and the `admin_users` foreign key was never exercised — while production always
   * passed a real `users.id` and therefore ALWAYS failed with P2003 → HTTP 500. Passing a real
   * operator here is what makes this suite able to catch that class of defect.
   */
  async function operator(roles: string[] = ['admin']): Promise<{ id: string; roles: string[] }> {
    const u = await prisma.user.create({
      data: { email: `op_${randomUUID()}@t.local`, username: `op${randomUUID().slice(0, 12)}`, status: 'ACTIVE', authProvider: 'LOCAL' },
    });
    return { id: u.id, roles };
  }

  /** Count audit-trail rows for one entity — proves the operator action was durably recorded. */
  async function auditCount(entityId: string): Promise<number> {
    return prisma.auditTrail.count({ where: { entityId } });
  }

  it('DEPOSIT stays PENDING (no credit); operator complete credits (B1 = B0 + amount); reconcile balanced', async () => {
    const userId = await fundUser('100');
    const b0 = await avail(userId);
    const dep = await cashier.createDeposit(userId, { amount: '500', currency: 'INR', idempotencyKey: randomUUID() });
    expect(dep.status).toBe('PENDING');
    expect(await avail(userId)).toBe(b0); // NOT credited yet
    const done = await cashier.completeDeposit(dep.id);
    expect(done.status).toBe('COMPLETED');
    expect(await avail(userId)).toBe(b0 + 500); // invariant
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);

  it('DEPOSIT idempotency — a duplicate key returns the same request and completes once', async () => {
    const userId = await fundUser('10');
    const key = randomUUID();
    const a = await cashier.createDeposit(userId, { amount: '300', currency: 'INR', idempotencyKey: key });
    const b = await cashier.createDeposit(userId, { amount: '300', currency: 'INR', idempotencyKey: key });
    expect(a.id).toBe(b.id);
    const b0 = await avail(userId);
    await cashier.completeDeposit(a.id);
    await cashier.completeDeposit(a.id); // idempotent complete
    expect(await avail(userId)).toBe(b0 + 300); // credited ONCE
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);

  it('WITHDRAWAL holds funds on request (B1 = B0 − amount); operator complete does not move money again', async () => {
    const userId = await fundUser('1000');
    const b0 = await avail(userId);
    const wd = await cashier.createWithdrawal(userId, { amount: '200', currency: 'INR', idempotencyKey: randomUUID() });
    expect(wd.status).toBe('UNDER_REVIEW');
    expect(await avail(userId)).toBe(b0 - 200); // held immediately
    await cashier.approveWithdrawal(wd.id, await operator());
    const done = await cashier.completeWithdrawal(wd.id);
    expect(done.status).toBe('COMPLETED');
    expect(await avail(userId)).toBe(b0 - 200); // no double movement
    expect(await avail(userId)).toBeGreaterThanOrEqual(0);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);

  it('WITHDRAWAL reject refunds the held funds (back to B0); reconcile balanced', async () => {
    const userId = await fundUser('1000');
    const b0 = await avail(userId);
    const wd = await cashier.createWithdrawal(userId, { amount: '250', currency: 'INR', idempotencyKey: randomUUID() });
    expect(await avail(userId)).toBe(b0 - 250);
    const rej = await cashier.rejectWithdrawal(wd.id, 'kyc failed');
    expect(rej.status).toBe('REJECTED');
    expect(await avail(userId)).toBe(b0); // refunded
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);

  it('WITHDRAWAL insufficient balance is rejected with no movement', async () => {
    const userId = await fundUser('50');
    await expect(cashier.createWithdrawal(userId, { amount: '200', currency: 'INR', idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(BadRequestException);
    expect(await avail(userId)).toBe(50);
  }, 30_000);

  it('WITHDRAWAL idempotency — a duplicate key holds funds ONCE', async () => {
    const userId = await fundUser('1000');
    const b0 = await avail(userId);
    const key = randomUUID();
    const a = await cashier.createWithdrawal(userId, { amount: '150', currency: 'INR', idempotencyKey: key });
    const b = await cashier.createWithdrawal(userId, { amount: '150', currency: 'INR', idempotencyKey: key });
    expect(a.id).toBe(b.id);
    expect(await avail(userId)).toBe(b0 - 150); // debited once, not twice
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);

  it('CONCURRENCY — 5 concurrent withdrawals: no negative balance, no double debit, ledger balanced', async () => {
    const userId = await fundUser('1000');
    const b0 = await avail(userId);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => cashier.createWithdrawal(userId, { amount: '100', currency: 'INR', idempotencyKey: randomUUID() })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const after = await avail(userId);
    expect(after).toBe(b0 - 100 * ok); // exactly the successful holds
    expect(after).toBeGreaterThanOrEqual(0);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 60_000);

  it('final ledger reconcile is balanced', async () => {
    expect(await ledgerBalanced(prisma)).toBe(true);
  });

  /* ------------------------------------------------ Phase 2C.17 — P0-3 / P0-4 / P0-5 regressions */

  it('P0-5: approving with a REAL operator id succeeds (no admin_users FK violation)', async () => {
    const userId = await fundUser('1000');
    const wd = await cashier.createWithdrawal(userId, { amount: '200', currency: 'INR', idempotencyKey: randomUUID() });
    const op = await operator();

    // Before the fix this threw PrismaClientKnownRequestError P2003 and surfaced as HTTP 500.
    const approved = await cashier.approveWithdrawal(wd.id, op);

    expect(approved.status).toBe('APPROVED');
    const row = await prisma.withdrawalRequest.findUnique({ where: { id: wd.id } });
    // The operator has no linked AdminUser, so the FK column is null — and attribution is kept
    // in metadata + the audit trail instead of being lost.
    expect(row!.reviewedById).toBeNull();
    expect((row!.metadata as Record<string, unknown>).reviewedByUserId).toBe(op.id);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);

  it('P0-5: approval is idempotent and never double-approves or moves money', async () => {
    const userId = await fundUser('1000');
    const b0 = await avail(userId);
    const wd = await cashier.createWithdrawal(userId, { amount: '150', currency: 'INR', idempotencyKey: randomUUID() });
    const op = await operator();

    const first = await cashier.approveWithdrawal(wd.id, op);
    const second = await cashier.approveWithdrawal(wd.id, op);

    expect(first.status).toBe('APPROVED');
    expect(second.status).toBe('APPROVED');
    expect(await avail(userId)).toBe(b0 - 150); // held once, no second movement
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);

  it('P0-3: operator approve/reject write durable audit records with actor, IP and no secrets', async () => {
    const userId = await fundUser('1000');
    const op = await operator();

    const wd = await cashier.createWithdrawal(userId, { amount: '120', currency: 'INR', idempotencyKey: randomUUID() });
    await cashier.approveWithdrawal(wd.id, { ...op, requestId: 'req-1', meta: { ipAddress: '203.0.113.9', userAgent: 'jest', fingerprint: 'fp', fingerprintHint: null, countryCode: null, city: null } });

    const rows = await prisma.auditTrail.findMany({ where: { entityId: wd.id } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const rec = rows[0]!;
    expect(rec.userId).toBe(op.id);
    expect(rec.entityType).toBe('withdrawal_request');
    expect(rec.ipAddress).toBe('203.0.113.9');
    const changes = rec.changes as Record<string, unknown>;
    expect(changes.affectedUserId).toBe(userId);
    expect(changes.toStatus).toBe('APPROVED');
    // No credential material may ever reach the audit trail.
    const dump = JSON.stringify(rec).toLowerCase();
    for (const forbidden of ['password', 'passwordhash', 'refreshtoken', 'accesstoken', 'serverseed', 'secret']) {
      expect(dump).not.toContain(forbidden);
    }
  }, 30_000);

  it('P0-3: a rejected withdrawal is audited exactly once and refunds exactly once', async () => {
    const userId = await fundUser('1000');
    const b0 = await avail(userId);
    const op = await operator();
    const wd = await cashier.createWithdrawal(userId, { amount: '250', currency: 'INR', idempotencyKey: randomUUID() });

    await cashier.rejectWithdrawal(wd.id, 'kyc failed', op);
    await cashier.rejectWithdrawal(wd.id, 'kyc failed', op); // repeat must not re-refund or re-log

    expect(await avail(userId)).toBe(b0); // refunded back to the starting balance, once
    expect(await auditCount(wd.id)).toBe(1);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);

  it('P0-4: escalation is DISABLED by default — behaviour is unchanged when no threshold is configured', async () => {
    delete process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD;
    const userId = await fundUser('5000');
    const wd = await cashier.createWithdrawal(userId, { amount: '4000', currency: 'INR', idempotencyKey: randomUUID() });
    const approved = await cashier.approveWithdrawal(wd.id, await operator(['admin']));
    expect(approved.status).toBe('APPROVED'); // an ordinary admin can still approve
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);

  it('P0-4: when configured, a large withdrawal escalates server-side and needs a super admin', async () => {
    process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD = '1000';
    try {
      const userId = await fundUser('5000');
      const wd = await cashier.createWithdrawal(userId, { amount: '2500', currency: 'INR', idempotencyKey: randomUUID() });

      // Escalation is derived from the STORED amount and persisted at request time.
      const stored = await prisma.withdrawalRequest.findUnique({ where: { id: wd.id } });
      expect((stored!.metadata as Record<string, unknown>).largeWithdrawal).toBe(true);

      // An ordinary admin is refused...
      await expect(cashier.approveWithdrawal(wd.id, await operator(['admin']))).rejects.toThrow(/super admin/i);
      const stillHeld = await prisma.withdrawalRequest.findUnique({ where: { id: wd.id } });
      expect(stillHeld!.status).toBe('UNDER_REVIEW'); // refusal changed nothing

      // ...a super admin may approve.
      const approved = await cashier.approveWithdrawal(wd.id, await operator(['super_admin']));
      expect(approved.status).toBe('APPROVED');
      expect(await ledgerBalanced(prisma)).toBe(true);
    } finally {
      delete process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD;
    }
  }, 30_000);

  it('P0-4: a BELOW-threshold withdrawal is not escalated and any admin may approve', async () => {
    process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD = '1000';
    try {
      const userId = await fundUser('5000');
      const wd = await cashier.createWithdrawal(userId, { amount: '500', currency: 'INR', idempotencyKey: randomUUID() });
      const approved = await cashier.approveWithdrawal(wd.id, await operator(['admin']));
      expect(approved.status).toBe('APPROVED');
      expect(await ledgerBalanced(prisma)).toBe(true);
    } finally {
      delete process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD;
    }
  }, 30_000);
});
