import { randomUUID } from 'node:crypto';

import { BadRequestException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { AnalyticsService, SETTLED_STATUSES } from './analytics.service';
import { REPORT_TYPES, ReportsService } from './reports.service';
import { UTF8_BOM } from './csv.util';

/**
 * Phase 2D.7 — reports & export INTEGRATION against real Postgres + Redis (`RUN_DB_IT=1`).
 *
 * Proves the properties only a real database can prove:
 *   - PART J: every report figure equals the same figure computed directly in SQL;
 *   - PART D: the two audit stores' real relationship, measured rather than assumed;
 *   - PART Q: building and exporting EVERY report mutates no balance, no ledger entry, no
 *     cashier row and no game round;
 *   - PART B: the configured range ceiling is enforced end-to-end and never truncates.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

d('Reports & export (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let analytics: AnalyticsService;
  let reports: ReportsService;
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
    reports = app.get(ReportsService);
    wallet = app.get(WalletEngineService);
    inrId = (await prisma.currency.findUnique({ where: { code: 'INR' } }))!.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  const num = (v: unknown) => Number(v ?? 0);
  const cell = (rows: (string | number | null)[][], metric: string, col: number) =>
    rows.find((r) => r[0] === metric)?.[col] ?? null;

  /* --------------------------------------- PART J: report vs authoritative SQL */

  it('gaming report stake/payout equal a direct SQL aggregation over the same statuses', async () => {
    const report = await reports.build('gaming', q as never);
    const sql = await prisma.$queryRaw<{ code: string; stake: string; payout: string }[]>`
      SELECT c.code, COALESCE(SUM(gr.stake),0)::text AS stake, COALESCE(SUM(gr.payout),0)::text AS payout
      FROM game_rounds gr JOIN currencies c ON c.id = gr.currency_id
      WHERE gr.created_at >= ${FROM} AND gr.created_at < ${TO}
        AND gr.status::text = ANY(${SETTLED_STATUSES})
      GROUP BY c.code`;

    for (const row of sql) {
      const reported = report.rows.find((r) => r[0] === 'stake_and_payout' && r[1] === row.code);
      expect(reported).toBeDefined();
      expect(num(reported![3])).toBeCloseTo(num(row.stake), 6);
      expect(num(reported![4])).toBeCloseTo(num(row.payout), 6);
    }
    expect(report.rows.filter((r) => r[0] === 'stake_and_payout')).toHaveLength(sql.length);
  }, 60_000);

  it('gaming report round counts equal direct SQL', async () => {
    const report = await reports.build('gaming', q as never);
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM game_rounds
      WHERE created_at >= ${FROM} AND created_at < ${TO}`;
    expect(cell(report.rows, 'rounds_total_all_statuses', 2)).toBe(Number(rows[0]!.n));
  }, 60_000);

  it('cashier report deposit totals equal direct SQL, per status and currency', async () => {
    const report = await reports.build('cashier', q as never);
    const sql = await prisma.$queryRaw<{ status: string; code: string; n: bigint; total: string }[]>`
      SELECT dr.status::text AS status, c.code, count(*)::bigint AS n, COALESCE(SUM(dr.amount),0)::text AS total
      FROM deposit_requests dr JOIN currencies c ON c.id = dr.currency_id
      WHERE dr.created_at >= ${FROM} AND dr.created_at < ${TO}
      GROUP BY 1, 2`;

    for (const row of sql) {
      const reported = report.rows.find(
        (r) => r[0] === 'deposit' && r[1] === row.status && r[2] === row.code,
      );
      expect(reported).toBeDefined();
      expect(reported![3]).toBe(Number(row.n));
      expect(num(reported![4])).toBeCloseTo(num(row.total), 6);
    }
  }, 60_000);

  it('financial report transaction volume equals direct SQL', async () => {
    const report = await reports.build('financial', q as never);
    const sql = await prisma.$queryRaw<{ code: string; cur: string; n: bigint; total: string }[]>`
      SELECT tt.code, c.code AS cur, count(*)::bigint AS n, COALESCE(SUM(wt.amount),0)::text AS total
      FROM wallet_transactions wt
      JOIN transaction_types tt ON tt.id = wt.type_id
      JOIN currencies c ON c.id = wt.currency_id
      WHERE wt.created_at >= ${FROM} AND wt.created_at < ${TO}
      GROUP BY 1, 2`;

    for (const row of sql) {
      const reported = report.rows.find(
        (r) => r[0] === 'transaction_volume' && r[1] === row.code && r[2] === row.cur,
      );
      expect(reported).toBeDefined();
      expect(reported![3]).toBe(Number(row.n));
      expect(num(reported![4])).toBeCloseTo(num(row.total), 6);
    }
  }, 60_000);

  it('users report counts equal direct SQL', async () => {
    const report = await reports.build('users', q as never);
    const regRows = await prisma.$queryRaw<{ registered: bigint }[]>`
      SELECT count(*)::bigint AS registered FROM users WHERE deleted_at IS NULL`;
    const playedRows = await prisma.$queryRaw<{ played: bigint }[]>`
      SELECT count(DISTINCT user_id)::bigint AS played FROM game_rounds
      WHERE created_at >= ${FROM} AND created_at < ${TO}`;

    expect(cell(report.rows, 'registered', 2)).toBe(Number(regRows[0]!.registered));
    expect(cell(report.rows, 'played', 2)).toBe(Number(playedRows[0]!.played));
  }, 60_000);

  it('a report agrees with the dashboard it mirrors — one computation, used twice', async () => {
    const [report, dashboard] = await Promise.all([
      reports.build('gaming', q as never),
      analytics.gaming(q as never),
    ]);
    expect(cell(report.rows, 'rounds_settled', 2)).toBe(dashboard.settledRounds);
    expect(cell(report.rows, 'outcome_wins', 2)).toBe(dashboard.outcomes.wins);
  }, 60_000);

  /* --------------------------------------------- PART D: audit-store relationship */

  it('MEASURES the audit-store relationship rather than assuming it', async () => {
    const [trails] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM audit_trails`;
    const [adminLogs] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM admin_audit_logs`;

    // There is NO correlating key between the stores: audit_trails uses entity_type/entity_id and
    // admin_audit_logs uses resource/resource_id, with no shared column and no FK between them.
    const shared = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT a.column_name FROM information_schema.columns a
      JOIN information_schema.columns b
        ON b.column_name = a.column_name AND b.table_name = 'admin_audit_logs'
      WHERE a.table_name = 'audit_trails'`;
    const names = shared.map((r) => r.column_name).sort();

    // Only generic columns are shared — nothing that could identify the same event in both stores.
    expect(names).toEqual(['action', 'created_at', 'id', 'ip_address']);
    expect(names).not.toContain('entity_id');
    expect(names).not.toContain('resource_id');

    // And they describe different subjects.
    const fks = await prisma.$queryRaw<{ src: string; tgt: string }[]>`
      SELECT tc.table_name || '.' || kcu.column_name AS src, ccu.table_name AS tgt
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name IN ('audit_trails', 'admin_audit_logs')`;
    expect(fks.find((f) => f.src === 'audit_trails.user_id')?.tgt).toBe('users');
    expect(fks.find((f) => f.src === 'admin_audit_logs.admin_id')?.tgt).toBe('admin_users');

    // Live state: the admin store is dormant while audit_trails is populated.
    expect(Number(trails!.n)).toBeGreaterThan(0);
    expect(Number(adminLogs!.n)).toBe(0);
  }, 60_000);

  it('audit_trails demonstrably contains ADMIN-initiated actions', async () => {
    // This is why a 0 for the dormant admin store would be a lie: admin actions ARE audited.
    const rows = await prisma.$queryRaw<{ entity_type: string; n: bigint }[]>`
      SELECT entity_type, count(*)::bigint AS n FROM audit_trails
      WHERE entity_type IN ('admin_session', 'withdrawal_request', 'deposit_request', 'user_role')
      GROUP BY 1`;
    expect(rows.length).toBeGreaterThan(0);
  }, 60_000);

  it('reports the dormant admin store as null and NEVER a combined total', async () => {
    const a = await analytics.auditCoverage(q as never);
    expect(a.auditTrailRecords).toBeGreaterThan(0);
    expect(a.adminAuditRecords).toBeNull();
    expect(a.totalAuditRecords).toBeNull();
    expect(a.totalAuditReason).toMatch(/cannot safely be deduplicated/i);
  }, 60_000);

  /* ------------------------------------------------ PART B: range enforcement */

  it('accepts a normal range, and rejects an over-limit one without truncating', async () => {
    await expect(reports.build('gaming', { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' } as never))
      .resolves.toBeDefined();
    await expect(reports.build('gaming', { from: '2015-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' } as never))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(reports.build('gaming', { from: '2015-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' } as never))
      .rejects.toThrow(/NOT truncated/i);
  }, 60_000);

  it('rejects from > to', async () => {
    await expect(reports.build('financial', { from: '2026-06-01T00:00:00Z', to: '2026-05-01T00:00:00Z' } as never))
      .rejects.toBeInstanceOf(BadRequestException);
  }, 30_000);

  /* --------------------------------------------- currency & game isolation */

  it('a currency filter keeps every money row in that currency only', async () => {
    const report = await reports.build('financial', { ...q, currency: 'INR' } as never);
    for (const row of report.rows) {
      if (row[2] !== null && row[2] !== undefined) expect(row[2]).toBe('INR');
    }
    expect(report.meta.currency).toBe('INR');
  }, 60_000);

  it('an unknown currency yields an EMPTY report, never platform-wide totals', async () => {
    const all = await reports.build('gaming', q as never);
    const bogus = await reports.build('gaming', { ...q, currency: 'ZZZ' } as never);
    expect(bogus.rows.filter((r) => r[0] === 'stake_and_payout')).toHaveLength(0);
    expect(cell(bogus.rows, 'rounds_total_all_statuses', 2)).toBe(0);
    // Proves the filter did the work rather than the database simply being empty.
    expect(cell(all.rows, 'rounds_total_all_statuses', 2)).toBeGreaterThan(0);
  }, 60_000);

  it('an unknown game key yields an EMPTY report, not every game', async () => {
    const bogus = await reports.build('gaming', { ...q, gameKey: 'definitely-not-a-game' } as never);
    expect(cell(bogus.rows, 'rounds_total_all_statuses', 2)).toBe(0);
  }, 60_000);

  /* ------------------------------------------------------------- CSV export */

  it.each(REPORT_TYPES)('%s exports a valid CSV carrying real data and its envelope', async (type) => {
    const { csv, meta } = await reports.toCsvString(type, q as never);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain('# timezone,UTC');
    expect(csv).toContain(`# type,${type}`);
    expect(meta.rowCount).toBeGreaterThanOrEqual(0);
    expect(csv.endsWith('\r\n')).toBe(true);
  }, 60_000);

  it('no exported CSV contains credential material or a user identifier', async () => {
    for (const type of REPORT_TYPES) {
      const { csv } = await reports.toCsvString(type, q as never);
      const dump = csv.toLowerCase();
      for (const forbidden of [
        'password', 'refreshtoken', 'accesstoken', 'serverseed', 'totp',
        'authorization', 'postgresql://', 'redis://', 'secret',
      ]) {
        expect(dump).not.toContain(forbidden);
      }
      expect(csv).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  }, 120_000);

  /* ------------------------- PART Q: reports and exports mutate NOTHING financial */

  it('building and exporting EVERY report changes no balance, ledger, cashier row or round', async () => {
    const user = await prisma.user.create({
      data: {
        email: `rp_${randomUUID()}@t.local`,
        username: `rp${randomUUID().slice(0, 12)}`,
        status: 'ACTIVE',
        authProvider: 'LOCAL',
      },
    });
    await wallet.credit(user.id, inrId, { amount: '750', typeCode: 'DEPOSIT', description: 'reports fixture' });

    const snapshot = async () => {
      const [ledger] = await prisma.$queryRaw<{ debit: string; credit: string }[]>`
        SELECT COALESCE(SUM(CASE WHEN direction='DEBIT'  THEN amount ELSE 0 END),0)::text AS debit,
               COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE 0 END),0)::text AS credit
        FROM ledger_entries`;
      return {
        ...ledger!,
        balance: (await wallet.getOrCreateWallet(user.id, inrId)).available,
        txCount: await prisma.walletTransaction.count(),
        roundCount: await prisma.gameRound.count(),
        depositCount: await prisma.depositRequest.count(),
        withdrawalCount: await prisma.withdrawalRequest.count(),
        ledgerEntries: await prisma.ledgerEntry.count(),
        auditCount: await prisma.auditTrail.count(),
      };
    };

    const before = await snapshot();

    for (const type of REPORT_TYPES) {
      await reports.build(type, q as never);
      await reports.toCsvString(type, q as never);
    }

    const after = await snapshot();

    expect(after).toEqual(before); // nothing moved at all
    expect(num(before.debit)).toBeCloseTo(num(before.credit), 6);
    expect(num(after.debit)).toBeCloseTo(num(after.credit), 6);
  }, 180_000);

  it('no wallet balance is negative after the full report/export run', async () => {
    const negRows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM wallet_balances
      WHERE available < 0 OR locked < 0 OR pending < 0 OR total < 0`;
    expect(Number(negRows[0]!.n)).toBe(0);
  }, 60_000);
});
