import { randomUUID } from 'node:crypto';

import { BadRequestException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { AnalyticsService, SETTLED_STATUSES } from './analytics.service';

/**
 * Phase 2D.6 — analytics INTEGRATION against real Postgres + Redis (`RUN_DB_IT=1`).
 *
 * Proves the properties only a real database can prove:
 *   - every aggregate equals the same figure computed directly in SQL
 *   - currencies are separated, never combined
 *   - the daily series contains only days that genuinely have rows
 *   - analytics DO NOT mutate financial state: balances and the ledger are identical before and after
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

d('Analytics (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let analytics: AnalyticsService;
  let wallet: WalletEngineService;
  let inrId: string;

  const FROM = new Date('2026-01-01T00:00:00.000Z');
  const TO = new Date('2026-12-31T00:00:00.000Z');
  const q: Record<string, string> = { from: FROM.toISOString(), to: TO.toISOString() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    analytics = app.get(AnalyticsService);
    wallet = app.get(WalletEngineService);
    inrId = (await prisma.currency.findUnique({ where: { code: 'INR' } }))!.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  const num = (v: unknown) => Number(v ?? 0);

  /* ------------------------------------------- correctness vs direct SQL */

  it('round counts match a direct SQL count', async () => {
    const g = await analytics.gaming(q as never);
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM game_rounds WHERE created_at >= ${FROM} AND created_at < ${TO}`;
    expect(g.roundsTotal).toBe(Number(rows[0]!.n));
  }, 60_000);

  it('stake and payout match a direct SQL sum over the SAME status filter', async () => {
    const g = await analytics.gaming(q as never);
    const rows = await prisma.$queryRaw<{ code: string; stake: string; payout: string }[]>`
      SELECT c.code, COALESCE(SUM(gr.stake),0)::text AS stake, COALESCE(SUM(gr.payout),0)::text AS payout
      FROM game_rounds gr JOIN currencies c ON c.id = gr.currency_id
      WHERE gr.created_at >= ${FROM} AND gr.created_at < ${TO}
        AND gr.status::text = ANY(${SETTLED_STATUSES})
      GROUP BY c.code`;

    for (const row of rows) {
      const stake = g.stakeByCurrency.find((b) => b.currency === row.code);
      const payout = g.payoutByCurrency.find((b) => b.currency === row.code);
      expect(stake).toBeDefined();
      expect(num(stake!.total)).toBeCloseTo(num(row.stake), 6);
      expect(num(payout!.total)).toBeCloseTo(num(row.payout), 6);
    }
    expect(g.stakeByCurrency.length).toBe(rows.length);
  }, 60_000);

  it('wins + losses + ties equals the settled-round count exactly', async () => {
    const g = await analytics.gaming(q as never);
    expect(g.outcomes.wins + g.outcomes.losses + g.outcomes.ties).toBe(g.settledRounds);
  }, 60_000);

  it('user counts match direct SQL', async () => {
    const u = await analytics.users(q as never);
    const uRows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM users WHERE deleted_at IS NULL`;
    expect(u.registered).toBe(Number(uRows[0]!.n));

    const pRows = await prisma.$queryRaw<{ p: bigint }[]>`
      SELECT count(DISTINCT user_id)::bigint AS p FROM game_rounds
      WHERE created_at >= ${FROM} AND created_at < ${TO}`;
    expect(u.playedInRange).toBe(Number(pRows[0]!.p));
  }, 60_000);

  it('operations counts match direct SQL', async () => {
    const o = await analytics.operations(q as never);
    const rfRows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM game_rounds WHERE status = 'RECOVERY_FAILED'`;
    expect(o.recoveryFailed).toBe(Number(rfRows[0]!.n));
  }, 60_000);

  /* ------------------------------------------------ currency separation */

  it('a currency filter restricts results to that currency only', async () => {
    const g = await analytics.gaming({ ...q, currency: 'INR' } as never);
    for (const b of g.stakeByCurrency) expect(b.currency).toBe('INR');
  }, 60_000);

  it('an unknown currency yields empty results, not platform-wide totals', async () => {
    const all = await analytics.gaming(q as never);
    const bogus = await analytics.gaming({ ...q, currency: 'ZZZ' } as never);
    expect(bogus.roundsTotal).toBe(0);
    expect(bogus.stakeByCurrency).toEqual([]);
    expect(all.roundsTotal).toBeGreaterThan(0); // proves the filter did the work, not an empty DB
  }, 60_000);

  /* ------------------------------------------------------- daily series */

  it('daily rounds sum to the settled-round total, and every day has rows', async () => {
    const g = await analytics.gaming(q as never);
    const series = await analytics.daily(q as never);

    const summed = series.rounds.reduce((a, r) => a + r.rounds, 0);
    expect(summed).toBe(g.settledRounds);

    // No zero-filling: a day only appears because the query returned rows for it.
    for (const day of series.rounds) expect(day.rounds).toBeGreaterThan(0);
  }, 60_000);

  it('daily buckets are per-currency and dated in UTC', async () => {
    const series = await analytics.daily(q as never);
    for (const day of series.rounds) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.currency).toMatch(/^[A-Z]{3,8}$/);
    }
  }, 60_000);

  /* --------------------------------------------- range validation, live */

  it('rejects an oversized range at the service boundary', async () => {
    await expect(analytics.gaming({ from: '2015-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' } as never))
      .rejects.toBeInstanceOf(BadRequestException);
  }, 30_000);

  it('rejects from > to', async () => {
    await expect(analytics.gaming({ from: '2026-06-01T00:00:00Z', to: '2026-05-01T00:00:00Z' } as never))
      .rejects.toBeInstanceOf(BadRequestException);
  }, 30_000);

  /* ------------------------------------- READ-ONLY: no financial change */

  it('running EVERY analytics query changes no balance and no ledger total', async () => {
    const user = await prisma.user.create({
      data: { email: `an_${randomUUID()}@t.local`, username: `an${randomUUID().slice(0, 12)}`, status: 'ACTIVE', authProvider: 'LOCAL' },
    });
    await wallet.credit(user.id, inrId, { amount: '500', typeCode: 'DEPOSIT', description: 'analytics fixture' });

    const snapshot = async () => {
      const ledgerRows = await prisma.$queryRaw<{ debit: string; credit: string }[]>`
        SELECT COALESCE(SUM(CASE WHEN direction='DEBIT'  THEN amount ELSE 0 END),0)::text AS debit,
               COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE 0 END),0)::text AS credit
        FROM ledger_entries`;
      const balance = (await wallet.getOrCreateWallet(user.id, inrId)).available;
      const txCount = await prisma.walletTransaction.count();
      const roundCount = await prisma.gameRound.count();
      return { ...ledgerRows[0]!, balance, txCount, roundCount };
    };

    const before = await snapshot();

    await Promise.all([
      analytics.summary(q as never), analytics.gaming(q as never), analytics.financial(q as never),
      analytics.users(q as never), analytics.operations(q as never), analytics.daily(q as never),
    ]);

    const after = await snapshot();

    expect(after).toEqual(before);                       // nothing moved at all
    expect(num(before.debit)).toBeCloseTo(num(before.credit), 6); // and the ledger stayed balanced
    expect(num(after.debit)).toBeCloseTo(num(after.credit), 6);
  }, 120_000);

  it('no analytics response contains credential material', async () => {
    const s = await analytics.summary(q as never);
    const dump = JSON.stringify(s).toLowerCase();
    for (const forbidden of ['password', 'passwordhash', 'refreshtoken', 'accesstoken', 'serverseed', 'secret', 'totp', 'authorization']) {
      expect(dump).not.toContain(forbidden);
    }
  }, 60_000);

  it('no analytics response leaks a user identifier', async () => {
    // These are platform aggregates — an operator dashboard has no business receiving a user list.
    const s = await analytics.summary(q as never);
    const dump = JSON.stringify(s);
    expect(dump).not.toMatch(/"userId"/);
    expect(dump).not.toMatch(/"email"/);
  }, 60_000);
});
