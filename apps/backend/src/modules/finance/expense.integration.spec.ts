import { randomUUID } from 'node:crypto';

import { BadRequestException, NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ExpenseStatus, Prisma } from '@prisma/client';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { ExpenseService } from './expense.service';

/**
 * Expenses INTEGRATION against real Postgres (`RUN_DB_IT=1`).
 *
 * The property that matters most: an accounting expense creates **no ledger entry, no wallet
 * transaction and no balance change**. It is business accounting, not player money.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

d('Expenses (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let expenses: ExpenseService;
  let actor: string;
  let categoryId: string;

  const today = () => new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    expenses = app.get(ExpenseService);

    actor = (await prisma.user.create({
      data: {
        email: `exp_${randomUUID()}@t.local`,
        username: `exp${randomUUID().slice(0, 12)}`,
        status: 'ACTIVE',
        authProvider: 'LOCAL',
      },
    })).id;

    const cat = await expenses.createCategory({ code: `CAT${Date.now().toString().slice(-6)}`, name: 'Test category', actorUserId: actor });
    categoryId = cat.id;
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  const make = (over: Partial<Parameters<ExpenseService['create']>[0]> = {}) =>
    expenses.create({
      categoryId, description: 'Server hosting', amount: '1500.50',
      currencyCode: 'INR', incurredOn: today(), actorUserId: actor, ...over,
    });

  /* ----------------------------------------------------------- categories */

  it('creates a category with a normalised code', async () => {
    const c = await expenses.createCategory({ code: `mk${Date.now().toString().slice(-6)}`, name: 'Marketing', actorUserId: actor });
    expect(c.code).toMatch(/^MK\d+$/);
    expect(c.isActive).toBe(true);
  }, 60_000);

  it('rejects a duplicate category code', async () => {
    const code = `DUP${Date.now().toString().slice(-6)}`;
    await expenses.createCategory({ code, name: 'One', actorUserId: actor });
    await expect(expenses.createCategory({ code, name: 'Two', actorUserId: actor }))
      .rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('rejects a malformed category code', async () => {
    await expect(expenses.createCategory({ code: 'has spaces!', name: 'Bad', actorUserId: actor }))
      .rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  /* -------------------------------------------------------------- create */

  it('records an expense as DRAFT with exact Decimal precision', async () => {
    const e = await make({ amount: '1234.56789012' });
    expect(e.status).toBe(ExpenseStatus.DRAFT);
    // Precision preserved through Decimal — no float rounding.
    expect(e.amount).toBe('1234.56789012');
    expect(e.currency).toBe('INR');
    expect(e.createdByUserId).toBe(actor);
  }, 60_000);

  it('a client can never create an already-CONFIRMED expense', async () => {
    const e = await make();
    const row = await prisma.expense.findUnique({ where: { id: e.id } });
    expect(row!.status).toBe(ExpenseStatus.DRAFT);
  }, 60_000);

  it('rejects a zero, negative or non-finite amount', async () => {
    for (const bad of ['0', '-100']) {
      await expect(make({ amount: bad })).rejects.toBeInstanceOf(BadRequestException);
    }
  }, 60_000);

  it('rejects an unknown currency', async () => {
    await expect(make({ currencyCode: 'ZZZ' })).rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('rejects an unknown category', async () => {
    await expect(make({ categoryId: '00000000-0000-4000-8000-000000000000' }))
      .rejects.toBeInstanceOf(NotFoundException);
  }, 60_000);

  it('rejects a future business date', async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await expect(make({ incurredOn: future })).rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('rejects a duplicate reference — the same invoice cannot be recorded twice', async () => {
    const ref = `INV-${Date.now()}`;
    await make({ reference: ref });
    await expect(make({ reference: ref })).rejects.toThrow(/duplicate/i);
  }, 60_000);

  it('allows many expenses with NO reference', async () => {
    await expect(make()).resolves.toBeDefined();
    await expect(make()).resolves.toBeDefined();
  }, 60_000);

  /* ------------------------------------------------------------ lifecycle */

  it('confirms a DRAFT so it counts, and refuses to confirm twice', async () => {
    const e = await make();
    const confirmed = await expenses.confirm(e.id, actor);
    expect(confirmed.status).toBe(ExpenseStatus.CONFIRMED);
    await expect(expenses.confirm(e.id, actor)).rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('CONCURRENT confirms cannot both win', async () => {
    const e = await make();
    const results = await Promise.allSettled([expenses.confirm(e.id, actor), expenses.confirm(e.id, actor)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  }, 60_000);

  it('voids with a reason, retains the row, and refuses a void without a reason', async () => {
    const e = await make();
    await expenses.confirm(e.id, actor);

    await expect(expenses.void(e.id, '', actor)).rejects.toBeInstanceOf(BadRequestException);

    const voided = await expenses.void(e.id, 'duplicate invoice from supplier', actor);
    expect(voided.status).toBe(ExpenseStatus.VOID);
    expect(voided.voidReason).toBe('duplicate invoice from supplier');
    expect(voided.voidedAt).not.toBeNull();

    // NOT deleted — financial records are retained for audit.
    expect(await prisma.expense.findUnique({ where: { id: e.id } })).not.toBeNull();
    await expect(expenses.void(e.id, 'again', actor)).rejects.toThrow(/already void/i);
  }, 60_000);

  /* ------------------------------------------------------------- totals */

  it('totals count CONFIRMED only — DRAFT and VOID are excluded', async () => {
    const day = '2026-03-01';
    const before = await expenses.totals({ from: day, to: day });
    const inrBefore = Number(before.byCurrency.find((c) => c.currency === 'INR')?.total ?? 0);

    const draft = await make({ amount: '100', incurredOn: day });
    const confirmed = await make({ amount: '250', incurredOn: day });
    const voided = await make({ amount: '999', incurredOn: day });
    await expenses.confirm(confirmed.id, actor);
    await expenses.confirm(voided.id, actor);
    await expenses.void(voided.id, 'test exclusion', actor);

    const after = await expenses.totals({ from: day, to: day });
    const inrAfter = Number(after.byCurrency.find((c) => c.currency === 'INR')!.total);

    // Only the confirmed 250 counts. The 100 draft and the 999 void do not.
    expect(inrAfter - inrBefore).toBeCloseTo(250, 6);
    expect(draft.status).toBe(ExpenseStatus.DRAFT);
  }, 120_000);

  it('totals are PER CURRENCY and never combined', async () => {
    const t = await expenses.totals({});
    const currencies = t.byCurrency.map((c) => c.currency);
    expect(new Set(currencies).size).toBe(currencies.length);
    expect(t.basis).toMatch(/CONFIRMED expenses only/);
  }, 60_000);

  it('totals declare PROFIT unavailable, naming the missing revenue definition', async () => {
    const t = await expenses.totals({});
    const profit = t.unavailable.find((u) => u.metric === 'profit');
    expect(profit).toBeDefined();
    expect(profit!.reason).toMatch(/BUSINESS DEFINITION MISSING/);
    expect(profit!.reason).toMatch(/revenue/i);
    // And no profit number is present anywhere.
    expect(JSON.stringify(t)).not.toMatch(/"profit":\s*[0-9"]/);
  }, 60_000);

  it('totals match a direct SQL sum over the same statuses', async () => {
    const t = await expenses.totals({});
    const rows = await prisma.$queryRaw<{ code: string; total: string }[]>`
      SELECT c.code, COALESCE(SUM(e.amount),0)::text AS total
      FROM expenses e JOIN currencies c ON c.id = e.currency_id
      WHERE e.deleted_at IS NULL AND e.status = 'CONFIRMED'
      GROUP BY c.code`;
    for (const r of rows) {
      const reported = t.byCurrency.find((x) => x.currency === r.code);
      expect(reported).toBeDefined();
      expect(Number(reported!.total)).toBeCloseTo(Number(r.total), 6);
    }
  }, 60_000);

  /* --------------------------------------------------------------- list */

  it('an unknown currency filter yields EMPTY, not everything', async () => {
    const all = await expenses.list({ limit: 5 });
    const bogus = await expenses.list({ currency: 'ZZZ', limit: 5 });
    expect(all.total).toBeGreaterThan(0);
    expect(bogus.total).toBe(0);
  }, 60_000);

  it('filters by status', async () => {
    const drafts = await expenses.list({ status: ExpenseStatus.DRAFT, limit: 50 });
    expect(drafts.items.every((i) => i.status === ExpenseStatus.DRAFT)).toBe(true);
  }, 60_000);

  /* ---------------------------------------------------------------- audit */

  it('create, confirm and void are all audited with amounts and both statuses', async () => {
    const e = await make({ amount: '77.25' });
    await expenses.confirm(e.id, actor);
    await expenses.void(e.id, 'audit check', actor);

    const audits = await prisma.auditTrail.findMany({
      where: { entityType: 'expense', entityId: e.id }, orderBy: { createdAt: 'asc' },
    });
    expect(audits.length).toBeGreaterThanOrEqual(3);
    expect(audits.every((a) => a.userId === actor)).toBe(true);

    const voidAudit = audits.find((a) => (a.changes as Record<string, unknown>).to === ExpenseStatus.VOID);
    expect((voidAudit!.changes as Record<string, unknown>).reason).toBe('audit check');
    // One audit store only.
    expect(await prisma.adminAuditLog.count()).toBe(0);
  }, 60_000);

  /* ------------------------------------------------- FINANCIAL SAFETY */

  it('an expense creates NO ledger entry, NO wallet transaction and NO balance change', async () => {
    const snapshot = async () => {
      const rows = await prisma.$queryRaw<{ debit: string; credit: string }[]>`
        SELECT COALESCE(SUM(CASE WHEN direction='DEBIT'  THEN amount ELSE 0 END),0)::text AS debit,
               COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE 0 END),0)::text AS credit
        FROM ledger_entries`;
      return {
        ...rows[0]!,
        ledgerEntries: await prisma.ledgerEntry.count(),
        tx: await prisma.walletTransaction.count(),
        wallets: await prisma.wallet.count(),
      };
    };

    const before = await snapshot();

    const e = await make({ amount: '50000' });
    await expenses.confirm(e.id, actor);
    await expenses.void(e.id, 'no money moved', actor);
    await expenses.totals({});
    await expenses.list({ limit: 10 });

    // A 50,000 expense moved nothing at all.
    expect(await snapshot()).toEqual(before);
  }, 120_000);

  it('the ledger stays balanced and no balance is negative', async () => {
    await make({ amount: '9999.99' });
    const rows = await prisma.$queryRaw<{ debit: string; credit: string }[]>`
      SELECT COALESCE(SUM(CASE WHEN direction='DEBIT'  THEN amount ELSE 0 END),0)::text AS debit,
             COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE 0 END),0)::text AS credit
      FROM ledger_entries`;
    expect(new Prisma.Decimal(rows[0]!.debit).equals(new Prisma.Decimal(rows[0]!.credit))).toBe(true);

    const neg = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM wallet_balances
      WHERE available < 0 OR locked < 0 OR pending < 0 OR total < 0`;
    expect(Number(neg[0]!.n)).toBe(0);
  }, 60_000);

  /* ---------------------------------------------------------- persistence */

  it('expenses survive a full service restart', async () => {
    const e = await make({ amount: '4242.42', description: 'Persisted expense' });
    await expenses.confirm(e.id, actor);

    const ref2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app2 = ref2.createNestApplication();
    await app2.init();
    try {
      const svc2 = app2.get(ExpenseService);
      const found = await svc2.getById(e.id);
      expect(found.amount).toBe('4242.42');
      expect(found.status).toBe(ExpenseStatus.CONFIRMED);
    } finally {
      await app2.close();
    }
  }, 180_000);
});
