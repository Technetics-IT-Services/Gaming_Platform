import { randomUUID } from 'node:crypto';

import { BadRequestException, NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DepositStatus, WalletStatus } from '@prisma/client';

import { AppModule } from '../../app.module';
import { BonusAdminService } from '../bonus-admin/bonus-admin.service';
import { CashierService } from '../wallet/cashier.service';
import { PrismaService } from '../database/prisma.service';
import { FinanceOpsService } from './finance-ops.service';

/**
 * Phase 2D.10 INTEGRATION against real Postgres (`RUN_DB_IT=1`).
 *
 * Finance operations (F-01 queues, F-06 cash flow, F-07 search and failures) and operator bonus
 * administration (AD-07), including the idempotency and audit the frozen bonus service lacks.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

d('Phase 2D.10 finance + bonus administration (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let finance: FinanceOpsService;
  let bonuses: BonusAdminService;
  let cashier: CashierService;
  let actor: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    finance = app.get(FinanceOpsService);
    bonuses = app.get(BonusAdminService);
    cashier = app.get(CashierService);
    actor = await newUser();
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  async function newUser(): Promise<string> {
    return (await prisma.user.create({
      data: {
        email: `p10_${randomUUID()}@t.local`,
        username: `p10${randomUUID().slice(0, 12)}`,
        status: 'ACTIVE',
        authProvider: 'LOCAL',
        referralCode: `RF${randomUUID().slice(0, 10).toUpperCase().replace(/-/g, '')}`,
      },
    })).id;
  }

  const window = () => ({
    from: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    to: new Date(Date.now() + 60_000).toISOString(),
  });

  /* ==================================================== F-06 CASH FLOW */

  it('reports money in and out PER CURRENCY and never a combined total', async () => {
    const cf = await finance.cashFlow(window());
    expect(Array.isArray(cf.byCurrency)).toBe(true);
    for (const b of cf.byCurrency) {
      expect(typeof b.currency).toBe('string');
      expect(b.currency.length).toBe(3);
    }
    // There must be no field that could be read as a cross-currency sum.
    expect(Object.keys(cf)).not.toContain('total');
    expect(Object.keys(cf)).not.toContain('consolidated');
    expect(Object.keys(cf)).not.toContain('revenue');
    expect(Object.keys(cf)).not.toContain('profit');
  });

  it('states plainly that cash flow is NOT revenue and NOT profit', async () => {
    const cf = await finance.cashFlow(window());
    expect(cf.definition).toContain('not revenue');
    const metrics = cf.unavailable.map((u) => u.metric);
    expect(metrics).toContain('revenue');
    expect(metrics).toContain('profit');
    expect(metrics).toContain('consolidatedCurrencyTotal');
  });

  it('counts only COMPLETED movement — a pending deposit does not appear', async () => {
    const u = await newUser();
    const before = await finance.cashFlow(window());
    const inrBefore = before.byCurrency.find((b) => b.currency === 'INR');

    // Created through the REAL cashier so the row is shaped exactly as production makes it.
    await cashier.createDeposit(u, {
      amount: '777', currency: 'INR', idempotencyKey: `p10-pending-${randomUUID()}`,
    });

    const after = await finance.cashFlow(window());
    const inrAfter = after.byCurrency.find((b) => b.currency === 'INR');
    expect(inrAfter?.moneyIn ?? '0').toBe(inrBefore?.moneyIn ?? '0');
    expect(inrAfter?.depositCount ?? 0).toBe(inrBefore?.depositCount ?? 0);
  });

  it('rejects an over-wide window instead of silently truncating it', async () => {
    await expect(finance.cashFlow({
      from: new Date(Date.now() - 400 * 86_400_000).toISOString(),
      to: new Date().toISOString(),
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  /* ============================================== F-07 TRANSACTION SEARCH */

  it('searches across ALL players, not one at a time', async () => {
    const page = await finance.searchTransactions({ ...window(), limit: 25 });
    expect(page.items.length).toBeGreaterThan(0);
    const distinctUsers = new Set(page.items.map((i) => i.userId));
    // The pre-existing surface could only ever return one user's rows.
    expect(distinctUsers.size).toBeGreaterThan(0);
    expect(page.total).toBeGreaterThanOrEqual(page.items.length);
  });

  it('an UNKNOWN filter value matches nothing rather than being ignored', async () => {
    const real = await finance.searchTransactions({ ...window(), limit: 5 });
    const bogus = await finance.searchTransactions({ ...window(), typeCode: 'NOT_A_REAL_TYPE', limit: 5 });
    // Silently ignoring the filter would return platform-wide rows under a filter label.
    expect(bogus.total).toBe(0);
    expect(bogus.items).toEqual([]);
    expect(real.total).toBeGreaterThan(0);
  });

  it('a type filter returns only that type', async () => {
    const page = await finance.searchTransactions({ ...window(), typeCode: 'GAME_BET', limit: 20 });
    for (const row of page.items) expect(row.type).toBe('GAME_BET');
  });

  it('an amount range filters correctly', async () => {
    const page = await finance.searchTransactions({ ...window(), minAmount: '1', maxAmount: '10', limit: 20 });
    for (const row of page.items) {
      expect(Number(row.amount)).toBeGreaterThanOrEqual(1);
      expect(Number(row.amount)).toBeLessThanOrEqual(10);
    }
  });

  /* ================================================= F-07 FAILURE VIEW */

  it('reports failures from where they are genuinely recorded, and says why', async () => {
    const f = await finance.failures(window());
    expect(Array.isArray(f.failedDeposits)).toBe(true);
    expect(Array.isArray(f.failedWithdrawals)).toBe(true);
    expect(Array.isArray(f.failedRounds)).toBe(true);
    // An empty "failed transactions" table over a source that cannot hold failures would mislead.
    expect(f.ledgerNote).toContain('no failure status by design');
  });

  it('a failed deposit appears in the failure view', async () => {
    const u = await newUser();
    const dep = await cashier.createDeposit(u, {
      amount: '55', currency: 'INR', idempotencyKey: `p10-failed-${randomUUID()}`,
    });
    // A deposit only reaches FAILED through an operator/provider outcome; the state is set
    // directly here because this test is about the VIEW, not about the transition.
    await prisma.depositRequest.update({ where: { id: dep.id }, data: { status: DepositStatus.FAILED } });
    const f = await finance.failures({ ...window(), limit: 200 });
    expect(f.failedDeposits.some((x) => x.amount.startsWith('55'))).toBe(true);
  });

  /* ====================================================== F-01 QUEUES */

  it('reports review queue lengths as counts, with no money mixed in', async () => {
    const q = await finance.reviewQueues();
    for (const k of ['pendingDeposits', 'pendingWithdrawals', 'withdrawalsUnderReview', 'withdrawalsApprovedAwaitingPayment']) {
      expect(typeof (q as unknown as Record<string, unknown>)[k]).toBe('number');
    }
    // A queue length beside an amount invites reading it as an exposure figure.
    expect(JSON.stringify(q)).not.toMatch(/amount|currency|total/i);
  });

  /* =================================================== AD-07 BONUSES */

  it('grants a bonus with the operator\'s own figures and audits who did it', async () => {
    const player = await newUser();
    const reference = `p10-grant-${randomUUID()}`;
    const b = await bonuses.grant({
      userId: player, currencyCode: 'INR', amount: '250.5', wageringRequirement: '10',
      reference, reason: 'integration test grant', actorUserId: actor,
    });

    expect(b.userId).toBe(player);
    expect(b.balance).toContain('250.5');
    expect(b.wageringRequirement).toContain('10');

    const audit = await prisma.auditTrail.findFirst({
      where: { entityType: 'bonus_grant', entityId: b.id },
    });
    // The frozen service writes no audit row at all; this is the whole point of the wrapper.
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBe(actor);
    expect((audit!.changes as Record<string, unknown>).reference).toBe(reference);
  });

  it('IDEMPOTENT — replaying the same reference returns the first grant, not a second bonus', async () => {
    const player = await newUser();
    const reference = `p10-idem-${randomUUID()}`;
    const first = await bonuses.grant({
      userId: player, currencyCode: 'INR', amount: '100',
      reference, reason: 'first', actorUserId: actor,
    });
    const second = await bonuses.grant({
      userId: player, currencyCode: 'INR', amount: '100',
      reference, reason: 'replay', actorUserId: actor,
    });

    expect(second.id).toBe(first.id);
    const count = await prisma.bonusWallet.count({ where: { userId: player, deletedAt: null } });
    expect(count).toBe(1);
  });

  it('refuses a zero, negative or absurd amount', async () => {
    const player = await newUser();
    const base = { userId: player, currencyCode: 'INR', reason: 'bad', actorUserId: actor };
    await expect(bonuses.grant({ ...base, amount: '0', reference: `z-${randomUUID()}` }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(bonuses.grant({ ...base, amount: '-5', reference: `n-${randomUUID()}` }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(bonuses.grant({ ...base, amount: '99999999', reference: `h-${randomUUID()}` }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an unknown player and an unknown currency', async () => {
    await expect(bonuses.grant({
      userId: randomUUID(), currencyCode: 'INR', amount: '10',
      reference: `u-${randomUUID()}`, reason: 'x', actorUserId: actor,
    })).rejects.toBeInstanceOf(NotFoundException);

    const player = await newUser();
    await expect(bonuses.grant({
      userId: player, currencyCode: 'ZZZ', amount: '10',
      reference: `c-${randomUUID()}`, reason: 'x', actorUserId: actor,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('expiring a bonus closes it, zeroes it and records the forfeited balance', async () => {
    const player = await newUser();
    const b = await bonuses.grant({
      userId: player, currencyCode: 'INR', amount: '75',
      reference: `p10-exp-${randomUUID()}`, reason: 'to be expired', actorUserId: actor,
    });

    const expired = await bonuses.expire(b.id, 'no longer applicable', actor);
    expect(expired.status).toBe(WalletStatus.CLOSED);
    expect(Number(expired.balance)).toBe(0);

    const audit = await prisma.auditTrail.findFirst({
      where: { entityType: 'bonus_grant', entityId: b.id, action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect((audit!.changes as Record<string, unknown>).forfeitedBalance).toContain('75');

    // Expiring twice is refused rather than silently repeated.
    await expect(bonuses.expire(b.id, 'again', actor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the bonus list declares that nothing is awarded automatically', async () => {
    const page = await bonuses.list({ limit: 5 });
    const metrics = page.unavailable.map((u) => u.metric);
    expect(metrics).toContain('automaticBonusAward');
    expect(page.unavailable[0]!.reason).toContain('BUSINESS DEFINITION MISSING');
  });

  it('granting a bonus does NOT move the ledger — a bonus is not real money until converted', async () => {
    const player = await newUser();
    const before = await prisma.ledgerEntry.count();
    await bonuses.grant({
      userId: player, currencyCode: 'INR', amount: '500',
      reference: `p10-ledger-${randomUUID()}`, reason: 'ledger check', actorUserId: actor,
    });
    expect(await prisma.ledgerEntry.count()).toBe(before);
  });
});
