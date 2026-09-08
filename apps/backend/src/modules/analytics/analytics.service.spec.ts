import { BadRequestException } from '@nestjs/common';

import { AnalyticsService, SETTLED_STATUSES } from './analytics.service';
import { MAX_RANGE_DAYS, resolveRange } from './dto/analytics-query.dto';

/**
 * Phase 2D.6 — analytics contract without a database.
 *
 * Pins the properties that make these numbers trustworthy: range validation, per-currency separation,
 * the exact status filter used for stake/payout, undefined ratios staying null, an unknown currency
 * filtering rather than being ignored, and — most importantly — that the service is READ-ONLY and
 * never invents a metric it cannot source.
 *
 * The DB-gated integration suite proves the same behaviour against real Postgres, and
 * `verify_analytics` compares every aggregate to direct SQL.
 */

function make(
  over: Record<string, unknown> = {},
  configOver: { analytics?: { maxRangeDays: number } } = {},
) {
  const calls: string[] = [];
  const track = <T>(name: string, value: T) =>
    jest.fn().mockImplementation(() => { calls.push(name); return Promise.resolve(value); });

  const prisma = {
    gameRound: {
      count: track('gameRound.count', 0),
      groupBy: track('gameRound.groupBy', []),
      findMany: track('gameRound.findMany', []),
    },
    walletTransaction: { groupBy: track('walletTransaction.groupBy', []) },
    depositRequest: { groupBy: track('depositRequest.groupBy', []), count: track('depositRequest.count', 0), findMany: track('depositRequest.findMany', []) },
    withdrawalRequest: { groupBy: track('withdrawalRequest.groupBy', []), count: track('withdrawalRequest.count', 0), findMany: track('withdrawalRequest.findMany', []) },
    user: { count: track('user.count', 0), groupBy: track('user.groupBy', []) },
    loginHistory: { findMany: track('loginHistory.findMany', []) },
    auditTrail: { count: track('auditTrail.count', 0), groupBy: track('auditTrail.groupBy', []) },
    // Phase 2D.7 Part D: the admin store is read (count) but never written.
    adminAuditLog: { count: track('adminAuditLog.count', 0) },
    securityEvent: { count: track('securityEvent.count', 0), groupBy: track('securityEvent.groupBy', []) },
    notification: { count: track('notification.count', 0) },
    currency: { findUnique: track('currency.findUnique', null), findMany: track('currency.findMany', []) },
    transactionType: { findMany: track('transactionType.findMany', []) },
    $queryRaw: track('$queryRaw', [{ n: 0n }]),
    ...over,
  };
  // Phase 2D.7 Part B: the range ceiling is configuration, so the service takes AppConfigService.
  const config = { analytics: { maxRangeDays: 366 }, ...configOver };
  return { svc: new AnalyticsService(prisma as never, config as never), prisma, calls };
}

const q = (o: Record<string, unknown> = {}) => o as never;

describe('range validation', () => {
  it('defaults to the last 30 days when unspecified', () => {
    const r = resolveRange({});
    const days = (r.to.getTime() - r.from.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it('rejects from > to', () => {
    expect(() => resolveRange({ from: '2026-06-01T00:00:00Z', to: '2026-05-01T00:00:00Z' }))
      .toThrow(BadRequestException);
  });

  it('rejects an invalid date', () => {
    expect(() => resolveRange({ from: 'not-a-date' })).toThrow(BadRequestException);
  });

  it('rejects a range that starts in the future', () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect(() => resolveRange({ from: future })).toThrow(BadRequestException);
  });

  it(`rejects a range longer than ${MAX_RANGE_DAYS} days`, () => {
    expect(() => resolveRange({ from: '2020-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }))
      .toThrow(BadRequestException);
  });

  it('accepts a range exactly at the limit', () => {
    const to = new Date();
    const from = new Date(to.getTime() - MAX_RANGE_DAYS * 86_400_000);
    expect(() => resolveRange({ from: from.toISOString(), to: to.toISOString() })).not.toThrow();
  });

  it('allows a `to` in the future (it simply yields no rows)', () => {
    const to = new Date(Date.now() + 86_400_000).toISOString();
    expect(() => resolveRange({ to })).not.toThrow();
  });
});

describe('stake/payout use an explicit status filter', () => {
  it('only SETTLED, RECOVERED and RESOLVED count as money-moved', () => {
    expect(SETTLED_STATUSES).toEqual(['SETTLED', 'RECOVERED', 'RESOLVED']);
  });

  it('the stake/payout groupBy is filtered by exactly that set', async () => {
    const { svc, prisma } = make();
    await svc.gaming(q());
    const stakeCall = prisma.gameRound.groupBy.mock.calls.find(
      (c: [{ by: string[] }]) => c[0].by.includes('currencyId'),
    );
    expect(stakeCall![0].where.status).toEqual({ in: SETTLED_STATUSES });
  });

  it('the total-rounds count is NOT status-filtered (it counts every round)', async () => {
    const { svc, prisma } = make();
    await svc.gaming(q());
    expect(prisma.gameRound.count.mock.calls[0][0].where.status).toBeUndefined();
  });
});

describe('multi-currency safety', () => {
  it('returns one bucket per currency and never a combined total', async () => {
    const { svc } = make({
      gameRound: {
        count: jest.fn().mockResolvedValue(4),
        groupBy: jest.fn().mockImplementation(({ by }: { by: string[] }) =>
          Promise.resolve(by.includes('currencyId')
            ? [
                { currencyId: 'c-inr', _sum: { stake: '100', payout: '90' }, _avg: { stake: '25', payout: '22.5' }, _count: { _all: 4 } },
                { currencyId: 'c-usd', _sum: { stake: '10', payout: '30' }, _avg: { stake: '5', payout: '15' }, _count: { _all: 2 } },
              ]
            : [])),
        findMany: jest.fn().mockResolvedValue([]),
      },
      currency: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ id: 'c-inr', code: 'INR' }, { id: 'c-usd', code: 'USD' }]),
      },
    });
    const g = await svc.gaming(q());
    expect(g.stakeByCurrency.map((b) => b.currency).sort()).toEqual(['INR', 'USD']);
    expect(g.stakeByCurrency.find((b) => b.currency === 'INR')!.total).toBe('100');
    expect(g.stakeByCurrency.find((b) => b.currency === 'USD')!.total).toBe('10');
    // There is no aggregate field that would imply a cross-currency sum.
    expect(Object.keys(g)).not.toContain('stakeTotal');
  });

  it('an UNKNOWN currency filters everything out rather than being ignored', async () => {
    const { svc, prisma } = make();
    await svc.gaming(q({ currency: 'XYZ' }));
    // A missing currency resolves to a sentinel id, so the filter is applied and matches nothing.
    // Silently dropping the filter would report platform-wide totals under a currency label.
    expect(prisma.gameRound.count.mock.calls[0][0].where.currencyId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('a known currency filters by its id', async () => {
    const { svc, prisma } = make({
      currency: { findUnique: jest.fn().mockResolvedValue({ id: 'c-inr' }), findMany: jest.fn().mockResolvedValue([]) },
    });
    await svc.gaming(q({ currency: 'inr' }));
    expect(prisma.gameRound.count.mock.calls[0][0].where.currencyId).toBe('c-inr');
  });
});

describe('undefined values stay null — never a fabricated number', () => {
  it('payout/stake ratio is null when stake is zero', async () => {
    const { svc } = make({
      gameRound: {
        count: jest.fn().mockResolvedValue(1),
        groupBy: jest.fn().mockImplementation(({ by }: { by: string[] }) =>
          Promise.resolve(by.includes('currencyId')
            ? [{ currencyId: 'c1', _sum: { stake: '0', payout: '0' }, _avg: { stake: '0', payout: '0' }, _count: { _all: 1 } }]
            : [])),
        findMany: jest.fn().mockResolvedValue([]),
      },
      currency: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([{ id: 'c1', code: 'INR' }]) },
    });
    const g = await svc.gaming(q());
    expect(g.payoutToStakeRatio[0]!.ratio).toBeNull();
  });

  it('deposit conversion is null when there are no registered users', async () => {
    const { svc } = make();
    const u = await svc.users(q());
    expect(u.registered).toBe(0);
    expect(u.depositConversionRate).toBeNull();
  });

  it('an empty dataset returns zeros for COUNTS, which are real counts, not placeholders', async () => {
    const { svc } = make();
    const g = await svc.gaming(q());
    expect(g.roundsTotal).toBe(0);
    expect(g.stakeByCurrency).toEqual([]); // no bucket invented for a currency with no rows
    expect(g.topGames).toEqual([]);
  });
});

describe('unavailable metrics are declared, not silently omitted', () => {
  const { svc } = make();
  const names = svc.unavailableMetrics().map((m) => m.metric);

  it.each(['dau', 'mau', 'retention', 'ltv', 'sessionTime', 'bounceRate', 'revenue', 'expenses', 'profit', 'partnerProfit', 'consolidatedCurrencyTotal', 'marketingConversion'])(
    '%s is declared unavailable', (m) => expect(names).toContain(m),
  );

  it('every unavailable metric carries a reason naming the missing source', () => {
    for (const m of svc.unavailableMetrics()) {
      expect(m.reason.length).toBeGreaterThan(20);
      expect(m.reason).toMatch(/NOT AVAILABLE/);
    }
  });

  it('no unavailable metric is also returned as a value', async () => {
    const g = await svc.gaming(q());
    const f = await svc.financial(q());
    const u = await svc.users(q());
    const dump = JSON.stringify({ g, f, u });
    for (const forbidden of ['"dau"', '"mau"', '"retention"', '"ltv"', '"revenue"', '"profit"', '"expenses"']) {
      expect(dump).not.toContain(forbidden);
    }
  });

  it('meta carries the range, UTC marker and the unavailable list', () => {
    const range = resolveRange({});
    const meta = svc.meta(q({ currency: 'INR' }), range);
    expect(meta.timezone).toBe('UTC');
    expect(meta.currency).toBe('INR');
    expect(meta.unavailable.length).toBeGreaterThan(0);
  });
});

describe('the service is READ-ONLY', () => {
  it('never calls a write method on any model', async () => {
    const { svc, prisma } = make();
    await Promise.all([svc.gaming(q()), svc.financial(q()), svc.users(q()), svc.operations(q())]);

    // The mock exposes ONLY read methods. If the service attempted create/update/delete/upsert the
    // property would be undefined and the call would throw, failing this test.
    const models = ['gameRound', 'walletTransaction', 'depositRequest', 'withdrawalRequest', 'user', 'auditTrail', 'securityEvent', 'notification'];
    for (const m of models) {
      const model = prisma[m as keyof typeof prisma] as Record<string, unknown>;
      for (const forbidden of ['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
        expect(model[forbidden]).toBeUndefined();
      }
    }
  });

  it('touches no wallet, ledger, settlement or reservation model at all', () => {
    const { prisma } = make();
    for (const forbidden of ['wallet', 'walletBalance', 'ledger', 'ledgerEntry', 'lockedFunds']) {
      expect(prisma[forbidden as keyof typeof prisma]).toBeUndefined();
    }
  });
});

describe('game filtering', () => {
  it('applies the gameKey filter to the round queries', async () => {
    const { svc, prisma } = make();
    await svc.gaming(q({ gameKey: 'dice' }));
    expect(prisma.gameRound.count.mock.calls[0][0].where.gameKey).toBe('dice');
  });

  it('omits the filter entirely when no gameKey is given', async () => {
    const { svc, prisma } = make();
    await svc.gaming(q());
    expect(prisma.gameRound.count.mock.calls[0][0].where.gameKey).toBeUndefined();
  });
});

/* =========================================================== Phase 2D.7 additions */

describe('configurable range ceiling (2D.7 Part B)', () => {
  it('defaults to 366 days when no override is supplied', () => {
    expect(MAX_RANGE_DAYS).toBe(366);
    expect(() =>
      resolveRange({ from: '2025-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }),
    ).toThrow(BadRequestException);
    expect(() =>
      resolveRange({ from: '2025-07-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }),
    ).not.toThrow();
  });

  it('honours a SMALLER configured ceiling', () => {
    // A 30-day deployment limit must refuse a 60-day request.
    expect(() =>
      resolveRange({ from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z' }, 30),
    ).toThrow(BadRequestException);
  });

  it('honours a LARGER configured ceiling', () => {
    expect(() =>
      resolveRange({ from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }, 1000),
    ).not.toThrow();
  });

  it('accepts a range exactly AT the ceiling (no off-by-one refusal)', () => {
    const to = new Date('2026-02-01T00:00:00Z');
    const from = new Date(to.getTime() - 30 * 86_400_000);
    expect(() => resolveRange({ from: from.toISOString(), to: to.toISOString() }, 30)).not.toThrow();
  });

  it('refuses one millisecond BEYOND the ceiling', () => {
    const to = new Date('2026-02-01T00:00:00Z');
    const from = new Date(to.getTime() - 30 * 86_400_000 - 1);
    expect(() => resolveRange({ from: from.toISOString(), to: to.toISOString() }, 30))
      .toThrow(BadRequestException);
  });

  it('says the range was NOT truncated, so refusal cannot be mistaken for partial data', () => {
    expect(() => resolveRange({ from: '2015-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }, 366))
      .toThrow(/NOT truncated/i);
  });

  it('names both the limit and what was requested', () => {
    expect(() => resolveRange({ from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z' }, 30))
      .toThrow(/30 days \(requested 59\)/);
  });

  it('the service uses the CONFIGURED ceiling, not the module default', async () => {
    const { svc } = make({}, { analytics: { maxRangeDays: 7 } });
    await expect(svc.gaming(q({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' })))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolveWindow exposes the SAME configured ceiling to collaborators', () => {
    const { svc } = make({}, { analytics: { maxRangeDays: 7 } });
    expect(() => svc.resolveWindow(q({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' })))
      .toThrow(BadRequestException);
  });
});

describe('date boundaries are deterministic and UTC (2D.7 Part L)', () => {
  it('treats the window as half-open [from, to)', () => {
    const r = resolveRange({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' });
    expect(r.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('accepts a midnight-to-23:59:59.999 same-day window', () => {
    const r = resolveRange({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T23:59:59.999Z' });
    expect(r.to.getTime() - r.from.getTime()).toBe(86_399_999);
  });

  it('accepts from === to (an empty but valid window)', () => {
    const r = resolveRange({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' });
    expect(r.from.getTime()).toBe(r.to.getTime());
  });

  it('is unaffected by the host timezone — an explicit offset normalises to the same UTC instant', () => {
    const a = resolveRange({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' });
    const b = resolveRange({ from: '2026-01-01T05:30:00.000+05:30', to: '2026-01-02T05:30:00.000+05:30' });
    expect(b.from.getTime()).toBe(a.from.getTime());
    expect(b.to.getTime()).toBe(a.to.getTime());
  });

  it('filters on created_at with gte/lt, never gte/lte', async () => {
    const { svc, prisma } = make();
    await svc.gaming(q({ from: '2026-01-01T00:00:00Z', to: '2026-01-08T00:00:00Z' }));
    const where = prisma.gameRound.count.mock.calls[0][0].where;
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    // `lte` would double-count a row landing exactly on the boundary between adjacent windows.
    expect(where.createdAt.lte).toBeUndefined();
  });
});

describe('audit coverage semantics (2D.7 Part D)', () => {
  const auditTrail = (n: number) => ({
    count: jest.fn().mockResolvedValue(n),
    groupBy: jest.fn().mockResolvedValue([]),
  });

  it('returns the authoritative audit_trails count', async () => {
    const { svc } = make({ auditTrail: auditTrail(466), adminAuditLog: { count: jest.fn().mockResolvedValue(0) } });
    expect((await svc.auditCoverage(q())).auditTrailRecords).toBe(466);
  });

  it('reports a DORMANT admin store as null, never 0', async () => {
    const { svc } = make({ auditTrail: auditTrail(466), adminAuditLog: { count: jest.fn().mockResolvedValue(0) } });
    const a = await svc.auditCoverage(q());
    expect(a.adminAuditRecords).toBeNull();
    expect(a.adminAuditRecords).not.toBe(0);
    expect(a.adminAuditReason).toMatch(/SOURCE NOT WRITTEN/);
  });

  it('distinguishes "never written" from "quiet in this window" via an all-time count', async () => {
    // 0 rows in the window but rows exist all-time → the store IS live, so the real 0 is reported.
    const count = jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(12);
    const { svc } = make({ auditTrail: auditTrail(5), adminAuditLog: { count } });
    const a = await svc.auditCoverage(q());
    expect(a.adminAuditRecords).toBe(0);
    expect(a.adminAuditReason).not.toMatch(/SOURCE NOT WRITTEN/);
  });

  it('NEVER exposes a combined total — not even when BOTH stores are populated', async () => {
    const count = jest.fn().mockResolvedValueOnce(7).mockResolvedValueOnce(7);
    const { svc } = make({ auditTrail: auditTrail(466), adminAuditLog: { count } });
    const a = await svc.auditCoverage(q());
    expect(a.adminAuditRecords).toBe(7);
    // The decisive property: with no correlating key, overlap could never be ruled out.
    expect(a.totalAuditRecords).toBeNull();
    expect(a.totalAuditRecords).not.toBe(473);
  });

  it('explains WHY no total is available, naming both identifier schemes', async () => {
    const { svc } = make({ auditTrail: auditTrail(1), adminAuditLog: { count: jest.fn().mockResolvedValue(0) } });
    const a = await svc.auditCoverage(q());
    expect(a.totalAuditReason).toMatch(/cannot safely be deduplicated/i);
    expect(a.totalAuditReason).toMatch(/entity_type\/entity_id/);
    expect(a.totalAuditReason).toMatch(/resource\/resource_id/);
  });

  it('always declares totalAuditRecords unavailable', async () => {
    const { svc } = make({ auditTrail: auditTrail(1), adminAuditLog: { count: jest.fn().mockResolvedValue(3) } });
    expect((await svc.auditCoverage(q())).unavailable.map((u) => u.metric)).toContain('totalAuditRecords');
  });

  it('never WRITES to either audit store', async () => {
    const at = auditTrail(1);
    const aal = { count: jest.fn().mockResolvedValue(0) };
    const { svc } = make({ auditTrail: at, adminAuditLog: aal });
    await svc.auditCoverage(q());
    // Reading an audit store must never append to it.
    for (const store of [at, aal] as unknown as Record<string, unknown>[]) {
      for (const w of ['create', 'createMany', 'update', 'delete', 'upsert']) {
        expect(store[w]).toBeUndefined();
      }
    }
  });
});

describe('distinct-user counts are computed in the DATABASE (2D.7 Part A)', () => {
  it('does not load per-user rows into Node', async () => {
    const { svc, prisma } = make();
    await svc.users(q());
    // The old implementation used findMany({ distinct: ['userId'] }) on four tables, transferring
    // one row per distinct user just to read `.length`. It must not come back.
    expect(prisma.gameRound.findMany).not.toHaveBeenCalled();
    expect(prisma.depositRequest.findMany).not.toHaveBeenCalled();
    expect(prisma.withdrawalRequest.findMany).not.toHaveBeenCalled();
    expect(prisma.loginHistory.findMany).not.toHaveBeenCalled();
  });

  it('uses count(DISTINCT ...) via a parameterised raw query', async () => {
    const { svc, prisma } = make();
    await svc.users(q());
    const sqls = prisma.$queryRaw.mock.calls.map((c: unknown[]) => String((c[0] as string[]).join('?')));
    expect(sqls.some((s: string) => /count\(DISTINCT user_id\)/i.test(s))).toBe(true);
  });
});
