import { BadRequestException } from '@nestjs/common';

import { AnalyticsService } from './analytics.service';
import { REPORT_TYPES, ReportsService, type ReportType } from './reports.service';
import { UTF8_BOM } from './csv.util';

/**
 * Phase 2D.7 — reports & export.
 *
 * `ReportsService` is built entirely on `AnalyticsService`, so these tests drive it against a
 * DOUBLE of that service. That is deliberate: it proves the report layer's own contract (structure,
 * metadata, honesty about nulls, CSV shape, row cap) without re-testing the aggregation that Phase
 * 2D.6 already verified against real SQL. The end-to-end agreement with the database is covered by
 * `reports.integration.spec.ts` against real Postgres.
 *
 * READ-ONLY is proven structurally: the double exposes ONLY read methods, so any write the report
 * layer attempted would be a `TypeError`.
 */

const CURRENCIES = [
  { currency: 'INR', total: '1000.50', count: 3 },
  { currency: 'USD', total: '250.00', count: 2 },
];

function makeAnalytics(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const rec = <T>(name: string, value: T) => async (...args: unknown[]) => {
    calls.push(`${name}:${JSON.stringify(args[0] ?? {})}`);
    return value;
  };

  const analytics = {
    resolveWindow: (q: { from?: string; to?: string }) => ({
      from: new Date(q.from ?? '2026-01-01T00:00:00.000Z'),
      to: new Date(q.to ?? '2026-02-01T00:00:00.000Z'),
    }),
    unavailableMetrics: () => [
      { metric: 'revenue', reason: 'NOT AVAILABLE: no accounting definition of revenue.' },
      { metric: 'expenses', reason: 'NOT AVAILABLE — SOURCE DATA NOT PRESENT.' },
      { metric: 'profit', reason: 'NOT AVAILABLE: blocked by expenses.' },
      { metric: 'partnerProfit', reason: 'NOT AVAILABLE — SOURCE DATA NOT PRESENT.' },
      { metric: 'consolidatedCurrencyTotal', reason: 'NOT AVAILABLE: exchange_rates is empty.' },
      { metric: 'dau', reason: 'NOT AVAILABLE — SOURCE DATA NOT PRESENT.' },
      { metric: 'mau', reason: 'NOT AVAILABLE — SOURCE DATA NOT PRESENT.' },
      { metric: 'retention', reason: 'NOT AVAILABLE — SOURCE DATA NOT PRESENT.' },
      { metric: 'ltv', reason: 'NOT AVAILABLE — SOURCE DATA NOT PRESENT.' },
      { metric: 'sessionTime', reason: 'NOT AVAILABLE.' },
      { metric: 'bounceRate', reason: 'NOT AVAILABLE — SOURCE DATA NOT PRESENT.' },
      { metric: 'marketingConversion', reason: 'NOT AVAILABLE — SOURCE DATA NOT PRESENT.' },
    ],
    financial: rec('financial', {
      transactionsByType: [{ type: 'GAME_BET', currency: 'INR', count: 5, total: '500.00' }],
      depositsByStatus: [{ status: 'COMPLETED', currency: 'INR', count: 2, total: '900.00' }],
      withdrawalsByStatus: [{ status: 'PENDING', currency: 'USD', count: 1, total: '40.00' }],
      averageCompletedDeposit: [{ currency: 'INR', total: '450.00', count: 2 }],
      averageCompletedWithdrawal: [],
      pendingCashier: { deposits: 4, withdrawals: 7 },
      feesByCurrency: [{ currency: 'INR', total: '12.00', count: 5 }],
    }),
    gaming: rec('gaming', {
      roundsTotal: 40,
      roundsByStatus: { SETTLED: 30, PENDING_SETTLEMENT: 10 },
      settledRounds: 30,
      stakeByCurrency: CURRENCIES,
      payoutByCurrency: [
        { currency: 'INR', total: '900.00', count: 3 },
        { currency: 'USD', total: '0', count: 2 },
      ],
      averageStakeByCurrency: CURRENCIES,
      averagePayoutByCurrency: CURRENCIES,
      payoutToStakeRatio: [
        { currency: 'INR', ratio: 0.9 },
        { currency: 'USD', ratio: null }, // undefined ratio — must stay empty, never 0
      ],
      outcomes: { wins: 12, losses: 15, ties: 3 },
      topGames: [{ gameKey: 'dice', rounds: 20 }],
    }),
    users: rec('users', {
      registered: 100,
      byStatus: { ACTIVE: 90, PENDING: 10 },
      emailVerified: 20,
      playedInRange: 30,
      depositedInRange: 5,
      withdrewInRange: 2,
      loggedInInRange: 40,
      depositConversionRate: null, // undefined — must stay empty
    }),
    operations: rec('operations', {
      pendingSettlements: 1,
      recoveryFailed: 2,
      recovering: 0,
      auditRecords: 466,
      auditByEntity: { user: 158 },
      securityEvents: 475,
      securityByType: { LOGIN_SUCCESS: 300 },
      notifications: 466,
      notificationsUnread: 400,
    }),
    auditCoverage: rec('auditCoverage', {
      auditTrailRecords: 466,
      adminAuditRecords: null,
      adminAuditReason: 'NOT AVAILABLE — SOURCE NOT WRITTEN: admin_audit_logs has no writer...',
      totalAuditRecords: null,
      totalAuditReason: 'Combined total unavailable because the stores cannot safely be deduplicated...',
      auditByAction: { LOGIN: 52, APPROVE: 9 },
      unavailable: [
        { metric: 'adminAuditRecords', reason: 'NOT AVAILABLE — SOURCE NOT WRITTEN' },
        { metric: 'totalAuditRecords', reason: 'NOT AVAILABLE: no correlating key' },
      ],
    }),
    ...over,
  };

  return { svc: new ReportsService(analytics as unknown as AnalyticsService), analytics, calls };
}

const q = (o: Record<string, unknown> = {}) => o as never;

/* ------------------------------------------------------------------ structure */

describe('report catalogue', () => {
  it('exposes exactly the six report types the data supports', () => {
    expect([...REPORT_TYPES]).toEqual([
      'financial', 'gaming', 'cashier', 'operations', 'users', 'security-audit',
    ]);
  });

  it.each(REPORT_TYPES)('%s builds with a complete metadata envelope', async (type) => {
    const { svc } = makeAnalytics();
    const r = await svc.build(type, q());

    expect(r.meta.reportType).toBe(type);
    expect(r.meta.title.length).toBeGreaterThan(0);
    expect(r.meta.timezone).toBe('UTC');
    expect(r.meta.from).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.meta.to).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(r.meta.definitions).length).toBeGreaterThan(0);
    expect(r.meta.rowCount).toBe(r.rows.length);
    expect(r.meta.truncated).toBe(false);
  });

  it.each(REPORT_TYPES)('%s gives every row the same width as its header', async (type) => {
    const { svc } = makeAnalytics();
    const r = await svc.build(type, q());
    for (const row of r.rows) expect(row).toHaveLength(r.columns.length);
  });

  it('rejects an unknown report type instead of guessing one', async () => {
    const { svc } = makeAnalytics();
    await expect(svc.build('not-a-report' as ReportType, q())).rejects.toBeInstanceOf(BadRequestException);
  });
});

/* --------------------------------------------------------------- filters/date */

describe('filters reach the underlying analytics unchanged', () => {
  it('passes the date range through', async () => {
    const { svc, calls } = makeAnalytics();
    await svc.build('gaming', q({ from: '2026-03-01T00:00:00.000Z', to: '2026-03-08T00:00:00.000Z' }));
    expect(calls.some((c) => c.includes('2026-03-01') && c.includes('2026-03-08'))).toBe(true);
  });

  it('passes a currency filter through and records it in the metadata', async () => {
    const { svc, calls } = makeAnalytics();
    const r = await svc.build('financial', q({ currency: 'INR' }));
    expect(calls.some((c) => c.includes('"currency":"INR"'))).toBe(true);
    expect(r.meta.currency).toBe('INR');
  });

  it('passes a game filter through and records it in the metadata', async () => {
    const { svc, calls } = makeAnalytics();
    const r = await svc.build('gaming', q({ gameKey: 'dice' }));
    expect(calls.some((c) => c.includes('"gameKey":"dice"'))).toBe(true);
    expect(r.meta.gameKey).toBe('dice');
  });

  it('records an ABSENT filter as null rather than inventing a default', async () => {
    const { svc } = makeAnalytics();
    const r = await svc.build('gaming', q());
    expect(r.meta.currency).toBeNull();
    expect(r.meta.gameKey).toBeNull();
  });

  it('resolves the window through the CONFIGURED resolver, not the module default', async () => {
    // If the report layer called resolveRange() itself it would silently use the default ceiling.
    const seen: unknown[] = [];
    const { svc } = makeAnalytics({
      resolveWindow: (x: unknown) => {
        seen.push(x);
        return { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-01-02T00:00:00.000Z') };
      },
    });
    await svc.build('users', q({ from: '2026-01-01T00:00:00.000Z' }));
    expect(seen).toHaveLength(1);
  });

  it('propagates a range rejection rather than returning partial data', async () => {
    const { svc } = makeAnalytics({
      resolveWindow: () => { throw new BadRequestException('Range must not exceed 366 days'); },
    });
    await expect(svc.build('gaming', q({ from: '2015-01-01T00:00:00.000Z' })))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

/* ------------------------------------------------------------ multi-currency */

describe('multi-currency stays separated', () => {
  it('keeps one row per currency and never sums across them', async () => {
    const { svc } = makeAnalytics();
    const r = await svc.build('gaming', q());
    const stakeRows = r.rows.filter((row) => row[0] === 'stake_and_payout');

    expect(stakeRows.map((row) => row[1])).toEqual(['INR', 'USD']);
    // 1000.50 + 250.00 = 1250.50 would be a fabricated cross-currency total.
    expect(r.rows.some((row) => String(row[3]) === '1250.50')).toBe(false);
  });

  it('declares consolidation unavailable on money reports', async () => {
    const { svc } = makeAnalytics();
    for (const type of ['financial', 'cashier'] as const) {
      const r = await svc.build(type, q());
      expect(r.meta.unavailable.map((u) => u.metric)).toContain('consolidatedCurrencyTotal');
    }
  });

  it('states in the cashier report that deposits and withdrawals are never netted', async () => {
    const { svc } = makeAnalytics();
    const r = await svc.build('cashier', q());
    expect(JSON.stringify(r.meta.definitions)).toContain('never netted');
  });
});

/* -------------------------------------------------------- null, never zero */

describe('undefined values stay empty and never become zero', () => {
  it('keeps a null payout/stake ratio null', async () => {
    const { svc } = makeAnalytics();
    const r = await svc.build('gaming', q());
    const usd = r.rows.find((row) => row[0] === 'stake_and_payout' && row[1] === 'USD')!;
    expect(usd[6]).toBeNull();
    expect(usd[6]).not.toBe(0);
  });

  it('keeps a null deposit-conversion rate null', async () => {
    const { svc } = makeAnalytics();
    const r = await svc.build('users', q());
    const row = r.rows.find((x) => x[0] === 'deposit_conversion_rate')!;
    expect(row[2]).toBeNull();
  });

  it('renders those nulls as EMPTY cells in CSV, not as 0', async () => {
    const { svc } = makeAnalytics();
    const { csv } = await svc.toCsvString('users', q());
    const line = csv.split('\r\n').find((l) => l.startsWith('deposit_conversion_rate'))!;
    expect(line).toBe('deposit_conversion_rate,in_range,');
    expect(line.endsWith(',0')).toBe(false);
  });
});

/* --------------------------------------------------- Part D — audit semantics */

describe('audit semantics (Part D)', () => {
  it('reports the authoritative audit_trails count', async () => {
    const { svc } = makeAnalytics();
    const r = await svc.build('security-audit', q());
    expect(r.rows.find((x) => x[0] === 'audit_trail_records')![2]).toBe(466);
  });

  it('reports a dormant admin store as EMPTY, never as 0', async () => {
    const { svc } = makeAnalytics();
    const r = await svc.build('security-audit', q());
    const row = r.rows.find((x) => x[0] === 'admin_audit_records')!;
    expect(row[2]).toBeNull();
    // A 0 here would read as "no admin actions were audited", which is false.
    expect(row[2]).not.toBe(0);
  });

  it('NEVER exposes a combined total, because the stores share no correlating key', async () => {
    const { svc } = makeAnalytics();
    const r = await svc.build('security-audit', q());
    const total = r.rows.find((x) => x[0] === 'total_audit_records')!;
    expect(total[2]).toBeNull();
    // Specifically NOT the naive sum, and specifically not audit_trails relabelled as a total.
    expect(total[2]).not.toBe(466);
  });

  it('states why the total is unavailable, in the report metadata', async () => {
    const { svc } = makeAnalytics();
    const r = await svc.build('security-audit', q());
    expect(r.meta.definitions.total_audit_records).toMatch(/cannot safely be deduplicated/i);
  });

  it('carries the audit unavailability into the metadata envelope', async () => {
    const { svc } = makeAnalytics();
    const r = await svc.build('security-audit', q());
    expect(r.meta.unavailable.map((u) => u.metric)).toEqual(
      expect.arrayContaining(['adminAuditRecords', 'totalAuditRecords']),
    );
  });

  it('surfaces the empty total and its reason in the exported CSV', async () => {
    const { svc } = makeAnalytics();
    const { csv } = await svc.toCsvString('security-audit', q());
    expect(csv).toContain('total_audit_records,in_range,\r\n');
    expect(csv).toContain('# unavailable:totalAuditRecords');
  });
});

/* ------------------------------------------------------------ empty datasets */

describe('empty datasets', () => {
  const empty = {
    financial: async () => ({
      transactionsByType: [], depositsByStatus: [], withdrawalsByStatus: [],
      averageCompletedDeposit: [], averageCompletedWithdrawal: [],
      pendingCashier: { deposits: 0, withdrawals: 0 }, feesByCurrency: [],
    }),
    gaming: async () => ({
      roundsTotal: 0, roundsByStatus: {}, settledRounds: 0,
      stakeByCurrency: [], payoutByCurrency: [], averageStakeByCurrency: [],
      averagePayoutByCurrency: [], payoutToStakeRatio: [],
      outcomes: { wins: 0, losses: 0, ties: 0 }, topGames: [],
    }),
  };

  it('produces a valid report with no data rows rather than throwing', async () => {
    const { svc } = makeAnalytics(empty);
    const r = await svc.build('gaming', q());
    expect(r.columns.length).toBeGreaterThan(0);
    expect(r.meta.rowCount).toBe(r.rows.length);
  });

  it('still emits header, envelope and a valid CSV document when empty', async () => {
    const { svc } = makeAnalytics(empty);
    const { csv } = await svc.toCsvString('financial', q());
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain('metric,type,currency,count,amount');
    expect(csv).toContain('# generated_at_utc');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('reports a genuine measured zero as 0 (0 rounds really is zero rounds)', async () => {
    const { svc } = makeAnalytics(empty);
    const r = await svc.build('gaming', q());
    expect(r.rows.find((x) => x[0] === 'rounds_total_all_statuses')![2]).toBe(0);
  });
});

/* --------------------------------------------------------------- large export */

describe('large-report protection', () => {
  it('REJECTS an over-sized report instead of truncating it', async () => {
    const huge = Array.from({ length: 50_001 }, (_, i) => ({
      type: `T${i}`, currency: 'INR', count: 1, total: '1.00',
    }));
    const { svc } = makeAnalytics({
      financial: async () => ({
        transactionsByType: huge, depositsByStatus: [], withdrawalsByStatus: [],
        averageCompletedDeposit: [], averageCompletedWithdrawal: [],
        pendingCashier: { deposits: 0, withdrawals: 0 }, feesByCurrency: [],
      }),
    });
    await expect(svc.build('financial', q())).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.build('financial', q())).rejects.toThrow(/NOT truncated/i);
  });
});

/* ------------------------------------------------------------ CSV correctness */

describe('CSV export', () => {
  it('leads with the header row, then the self-describing envelope', async () => {
    const { svc } = makeAnalytics();
    const { csv } = await svc.toCsvString('gaming', q({ currency: 'INR' }));
    const lines = csv.replace(UTF8_BOM, '').split('\r\n');
    expect(lines[0]).toBe('metric,currency_or_game,count,stake,payout,avg_stake,payout_to_stake_ratio');
    expect(csv).toContain('# type,gaming');
    expect(csv).toContain('# timezone,UTC');
    expect(csv).toContain('# currency_filter,INR');
  });

  it('states in the file that unfiltered currency rows stay per-currency', async () => {
    const { svc } = makeAnalytics();
    const { csv } = await svc.toCsvString('financial', q());
    expect(csv).toContain('never combined');
  });

  it('returns the same metadata as the JSON build, so the two cannot disagree', async () => {
    const { svc } = makeAnalytics();
    const json = await svc.build('cashier', q());
    const { meta } = await svc.toCsvString('cashier', q());
    expect(meta.reportType).toBe(json.meta.reportType);
    expect(meta.rowCount).toBe(json.meta.rowCount);
  });

  it.each(REPORT_TYPES)('%s exports a parseable CSV with a stable column count', async (type) => {
    const { svc } = makeAnalytics();
    const { csv } = await svc.toCsvString(type, q());
    const lines = csv.replace(UTF8_BOM, '').split('\r\n').filter(Boolean);
    const width = lines[0]!.split(',').length;
    expect(width).toBeGreaterThan(1);
    // Data rows (skipping the '#' envelope) must all match the header width.
    for (const line of lines.slice(1).filter((l) => !l.startsWith('#'))) {
      if (line.includes('"')) continue; // quoted cells may legitimately contain commas
      expect(line.split(',')).toHaveLength(width);
    }
  });
});

/* ---------------------------------------------- injection through real data */

describe('formula injection arriving from the DATABASE is neutralised in export', () => {
  it('escapes a malicious game key without touching the numbers beside it', async () => {
    const { svc } = makeAnalytics({
      gaming: async () => ({
        roundsTotal: 1, roundsByStatus: {}, settledRounds: 1,
        stakeByCurrency: [{ currency: 'INR', total: '-1250.00', count: 1 }],
        payoutByCurrency: [{ currency: 'INR', total: '0', count: 1 }],
        averageStakeByCurrency: [{ currency: 'INR', total: '-1250.00', count: 1 }],
        averagePayoutByCurrency: [], payoutToStakeRatio: [{ currency: 'INR', ratio: null }],
        outcomes: { wins: 0, losses: 1, ties: 0 },
        topGames: [{ gameKey: '=cmd|\' /C calc\'!A0', rounds: 1 }],
      }),
    });
    const { csv } = await svc.toCsvString('gaming', q());

    expect(csv).toContain("'=cmd");          // neutralised
    expect(csv).not.toMatch(/,=cmd/);        // never lands raw in a cell
    expect(csv).toContain('-1250.00');       // legitimate negative money survives intact
    expect(csv).not.toContain("'-1250.00");  // and is NOT mangled by the escaping
  });
});

/* ------------------------------------------------------------------ security */

describe('reports never carry sensitive material', () => {
  it.each(REPORT_TYPES)('%s contains no credential-like field', async (type) => {
    const { svc } = makeAnalytics();
    const { csv } = await svc.toCsvString(type, q());
    const dump = csv.toLowerCase();
    for (const forbidden of [
      'password', 'passwordhash', 'refreshtoken', 'accesstoken', 'bearer',
      'serverseed', 'server_seed', 'totp', 'authorization', 'apikey', 'api_key',
      'database_url', 'postgresql://', 'redis://',
    ]) {
      expect(dump).not.toContain(forbidden);
    }
  });

  it.each(REPORT_TYPES)('%s exposes no per-user identifier', async (type) => {
    const { svc } = makeAnalytics();
    const r = await svc.build(type, q());
    const dump = JSON.stringify(r);
    // These are platform aggregates; a per-player row has no business in an operator report.
    expect(dump).not.toMatch(/"userId"/);
    expect(dump).not.toMatch(/"email"/);
    expect(dump).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

/* ----------------------------------------------------------------- read-only */

describe('reports are structurally READ-ONLY', () => {
  it('touches only read methods on the analytics service', async () => {
    // The double exposes no create/update/delete of any kind, so a write would be a TypeError.
    const { svc, analytics } = makeAnalytics();
    for (const type of REPORT_TYPES) await svc.build(type, q());

    for (const forbidden of ['create', 'update', 'delete', 'upsert', 'credit', 'debit', 'settle', 'refund']) {
      expect((analytics as Record<string, unknown>)[forbidden]).toBeUndefined();
    }
  });

  it('has no wallet, ledger or cashier mutation collaborator at all', () => {
    const { analytics } = makeAnalytics();
    for (const model of ['wallet', 'ledger', 'ledgerEntry', 'walletEngine', 'cashier']) {
      expect((analytics as Record<string, unknown>)[model]).toBeUndefined();
    }
  });
});
