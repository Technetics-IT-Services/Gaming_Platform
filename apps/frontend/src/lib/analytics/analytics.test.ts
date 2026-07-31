import { describe, expect, it } from 'vitest';

import { Ledger, TransactionType, WalletService } from '@/lib/ledger';
import { TreasuryEngine, WithdrawalService } from '@/lib/treasury';
import { ComplianceService, OperationType } from '@/lib/compliance';
import { OperationsService } from '@/lib/operations';

import { AggregationEngine, MetricsRegistry, TimeSeriesStore } from './metrics';
import { AnalyticsPlatform } from './analytics-platform';
import { Observability } from './observability';
import { complianceAnalyticsPort, operationsHealthPort, treasuryFinancialPort } from './ports';
import { AnalyticsAccessDeniedError, AnalyticsRBAC, AnalyticsRole, AnalyticsPermission, maskPlayerId, type AnalyticsAuthContext } from './security';
import { AggregateOp, AlertComparator, AlertSeverity, EventType, Granularity, LogLevel } from './types';

/**
 * Analytics, BI & Observability platform (Phase 6D). Verifies metric aggregation,
 * executive KPIs, financial BI, player analytics, fraud/compliance analytics,
 * observability (tracing/logs/latency/dependency graph), monitoring + alerting,
 * warehouse export, RBAC and tenant isolation. Everything is read-only — no money
 * moves and no frozen service is mutated.
 */

let CLK = 1_700_000_000_000;
const clock = () => (CLK += 1_000);

const EXEC: AnalyticsAuthContext = { actor: 'ceo', roles: [AnalyticsRole.Executive] };

const DAY = 24 * 3_600_000;

describe('metrics + aggregation', () => {
  it('records counters/gauges/histograms and aggregates a time-series', () => {
    const reg = new MetricsRegistry();
    reg.increment('bets', 3);
    reg.gauge('online', 42);
    reg.observe('latency', 100);
    expect(reg.counter('bets')).toBe(3);
    expect(reg.gaugeValue('online')).toBe(42);
    expect(reg.histogram('latency')).toEqual([100]);

    const ts = new TimeSeriesStore();
    ts.record('rev', 100, 0, { tenantId: 't1' });
    ts.record('rev', 200, 1_000, { tenantId: 't1' });
    ts.record('rev', 50, 2_000, { tenantId: 't2' });
    expect(ts.aggregate('rev', AggregateOp.Sum)).toBe(350);
    expect(ts.aggregate('rev', AggregateOp.Sum, { dims: { tenantId: 't1' } })).toBe(300);
    expect(AggregationEngine.reduce([1, 2, 3, 4], AggregateOp.Avg)).toBe(3);
    expect(ts.query('rev', Granularity.Day)[0]!.value).toBe(350);
  });
});

/* ---------------------------- full-stack wiring --------------------------- */

function fullStack() {
  const ledger = new Ledger();
  const wallet = new WalletService(ledger, 'INR');
  const treasury = new TreasuryEngine(ledger);
  const compliance = ComplianceService.create({ clock });
  const withdrawals = new WithdrawalService(wallet, treasury, { async payout() { return { ok: true }; } }, { limits: { min: 1, perTransaction: 1e9, dailyMax: 1e9 }, clock });
  const ops = new OperationsService({ wallet, withdrawals, compliance, clock });
  const platform = new AnalyticsPlatform({
    financial: treasuryFinancialPort(withdrawals),
    compliance: complianceAnalyticsPort(compliance),
    health: operationsHealthPort(ops),
    clock,
  });
  return { wallet, compliance, withdrawals, ops, platform };
}

/** Seed a month of representative events ending "now". */
function seed(platform: AnalyticsPlatform, now: number) {
  const p = (id: string) => `player${id}`;
  // registrations last month
  for (let i = 0; i < 5; i += 1) platform.track({ type: EventType.Registration, at: now - 20 * DAY, playerId: p(String(i)), tenantId: 't1' });
  // logins today (DAU) for 3 of them
  for (let i = 0; i < 3; i += 1) platform.track({ type: EventType.Login, at: now - 1_000, playerId: p(String(i)), tenantId: 't1' });
  // deposits (payers = 2)
  platform.track({ type: EventType.Deposit, at: now - 2 * DAY, playerId: p('0'), amount: 100_000, tenantId: 't1' });
  platform.track({ type: EventType.Deposit, at: now - 3 * DAY, playerId: p('1'), amount: 50_000, tenantId: 't1' });
  platform.track({ type: EventType.DepositFailed, at: now - 3 * DAY, playerId: p('2'), tenantId: 't1' });
  // bets on games
  platform.track({ type: EventType.Bet, at: now - DAY, playerId: p('0'), gameId: 'crash', amount: 1_000, tenantId: 't1' });
  platform.track({ type: EventType.Bet, at: now - DAY, playerId: p('1'), gameId: 'crash', amount: 2_000, tenantId: 't1' });
  platform.track({ type: EventType.Bet, at: now - DAY, playerId: p('0'), gameId: 'dice', amount: 500, tenantId: 't1' });
  // a session
  platform.track({ type: EventType.SessionStart, at: now - 5_000, playerId: p('0'), sessionId: 's1', tenantId: 't1' });
  platform.track({ type: EventType.SessionEnd, at: now - 2_000, playerId: p('0'), sessionId: 's1', tenantId: 't1' });
}

describe('executive KPIs', () => {
  it('computes DAU/MAU, revenue, ARPU/ARPPU and conversion', () => {
    const { platform } = fullStack();
    const now = CLK + 100 * DAY; // stable "now" well after seed
    seed(platform, now);
    const kpi = platform.kpis.compute({ tenantId: 't1', now });
    expect(kpi.dau).toBe(3);
    expect(kpi.mau).toBe(3); // active = logins/bets/sessions in 30d
    expect(kpi.revenue).toBe(150_000);
    expect(kpi.arppu).toBe(75_000); // 150k / 2 payers
    expect(kpi.conversionRate).toBeCloseTo(2 / 3, 5);
    expect(kpi.newPlayers).toBe(5);
  });
});

describe('financial BI', () => {
  it('summarizes deposits/withdrawals, payment success and cashflow (read-only)', () => {
    const { platform, wallet } = fullStack();
    const now = CLK + 100 * DAY;
    seed(platform, now);
    wallet.credit('x', 1, { type: TransactionType.Deposit }); // ensure ledger untouched by analytics
    const before = wallet.getBalance('x').total;
    const bi = platform.financialBI.report({ tenantId: 't1' });
    expect(bi.deposits).toEqual({ count: 2, total: 150_000 });
    expect(bi.paymentSuccessRate).toBeCloseTo(2 / 3, 5); // 2 ok / (2 ok + 1 failed)
    expect(bi.treasury.balanced).toBe(true);
    expect(wallet.getBalance('x').total).toBe(before); // analytics moved no money
    const csv = platform.financialBI.export({ tenantId: 't1' });
    expect(csv.columns).toEqual(['metric', 'value']);
  });
});

describe('player analytics', () => {
  it('computes session, game popularity and funnels', () => {
    const { platform } = fullStack();
    const now = CLK + 100 * DAY;
    seed(platform, now);
    const sessions = platform.players.sessions('t1');
    expect(sessions.sessions).toBe(1);
    expect(sessions.avgSessionMs).toBe(3_000);
    const games = platform.players.gamePopularity('t1');
    expect(games[0]!.gameId).toBe('crash'); // 2 rounds vs dice 1
    const funnel = platform.players.funnel([{ name: 'reg', type: EventType.Registration }, { name: 'dep', type: EventType.Deposit }], 't1');
    expect(funnel.steps[0]!.count).toBe(5);
    expect(funnel.steps[1]!.count).toBe(2);
    expect(funnel.overallConversion).toBeCloseTo(2 / 5, 5);
  });
});

describe('fraud & compliance analytics', () => {
  it('aggregates decisions into risk distribution + reason counts', () => {
    const { platform, compliance } = fullStack();
    compliance.decide({ operation: OperationType.Withdrawal, playerId: 'p1', amount: 1_000 }); // approve, low risk
    compliance.decide({ operation: OperationType.Withdrawal, playerId: 'p2', amount: 1_000 }); // approve
    const fa = platform.fraud.analytics();
    expect(fa.totalDecisions).toBe(2);
    expect(fa.riskDistribution.low).toBe(2); // no fraud/aml signals → low risk
    expect(Object.values(fa.byAction).reduce((a, b) => a + b, 0)).toBe(2); // 2 decisions, some action
  });
});

describe('observability', () => {
  it('traces spans, builds a timeline, computes latency + dependency graph', () => {
    const obs = new Observability(clock);
    const root = obs.startSpan({ service: 'api', operation: 'GET /kpi', at: 0 });
    const child = obs.startSpan({ service: 'db', operation: 'query', traceId: root.traceId, parentId: root.id, at: 5 });
    obs.endSpan(child.id, { at: 25 });
    obs.endSpan(root.id, { at: 40 });
    const timeline = obs.trace(root.traceId);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]!.id).toBe(root.id); // ordered by start
    expect(obs.latency('db').max).toBe(20);
    const graph = obs.dependencyGraph();
    expect(graph).toEqual([{ from: 'api', to: 'db', calls: 1, errors: 0 }]);
    obs.log({ level: LogLevel.Error, service: 'api', message: 'boom' });
    obs.log({ level: LogLevel.Info, service: 'api', message: 'ok' });
    expect(obs.errorRate('api')).toBe(0.5);
  });
});

describe('monitoring & alerting', () => {
  it('surfaces a health dashboard and fires alerts on breached rules', () => {
    const { platform } = fullStack();
    platform.monitoring.setGauge('queue.depth', 120);
    const chan = platform.monitoring.addChannel({ kind: 'slack', target: '#ops' });
    const rule = platform.monitoring.addRule({ metric: 'queue.depth', comparator: AlertComparator.GreaterThan, threshold: 100, severity: AlertSeverity.Warning, channels: [chan.id], description: 'queue backed up', enabled: true });
    const alerts = platform.monitoring.evaluate();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.ruleId).toBe(rule.id);
    expect(platform.monitoring.channelsFor(alerts[0]!)[0]!.target).toBe('#ops');
    expect(platform.monitoring.dashboard().overall).toBeTruthy();
  });
});

describe('warehouse / data platform', () => {
  it('captures snapshots, exposes ETL contracts and exports CSV', () => {
    const { platform } = fullStack();
    const now = CLK + 100 * DAY;
    seed(platform, now);
    platform.warehouse.snapshot({ tenantId: 't1' });
    platform.warehouse.snapshot({ tenantId: 't1' });
    expect(platform.warehouse.history()).toHaveLength(2);
    expect(platform.warehouse.etlContract('kpis').columns.some((c) => c.name === 'dau')).toBe(true);
    const sched = platform.warehouse.scheduleReport({ name: 'daily-kpi', report: 'kpis', cron: '0 6 * * *' });
    expect(platform.warehouse.listSchedules()).toContainEqual(sched);
  });
});

describe('security — RBAC, tenant-aware, masking', () => {
  it('enforces analytics permissions and audits allow + deny', () => {
    const { platform } = fullStack();
    const sre: AnalyticsAuthContext = { actor: 'sre1', roles: [AnalyticsRole.SRE] };
    expect(() => platform.financialReport(sre)).toThrow(AnalyticsAccessDeniedError); // SRE lacks financial view
    expect(() => platform.healthDashboard(sre)).not.toThrow(); // SRE has monitoring
    platform.executiveKPIs(EXEC);
    expect(platform.audit.count()).toBeGreaterThanOrEqual(3);
    expect(platform.audit.all().some((r) => !r.allowed)).toBe(true);
  });

  it('RBAC roles + masking behave as configured', () => {
    const rbac = new AnalyticsRBAC();
    expect(rbac.can([AnalyticsRole.FinanceAnalyst], AnalyticsPermission.FinancialView)).toBe(true);
    expect(rbac.can([AnalyticsRole.FinanceAnalyst], AnalyticsPermission.ObservabilityView)).toBe(false);
    expect(rbac.can([], AnalyticsPermission.KpiView)).toBe(false);
    expect(maskPlayerId('player12345')).toBe('play*******');
  });

  it('tenant-scoped principal only sees its tenant KPIs', () => {
    const { platform } = fullStack();
    // Seed relative to the live clock so events fall inside the facade's default window.
    const now = CLK;
    seed(platform, now);
    platform.track({ type: EventType.Registration, at: now - 10 * DAY, playerId: 'z', tenantId: 't2' });
    const t1Exec: AnalyticsAuthContext = { actor: 'e', roles: [AnalyticsRole.Executive], tenantId: 't1' };
    const kpi = platform.executiveKPIs(t1Exec);
    expect(kpi.newPlayers).toBe(5); // only t1 registrations, not the t2 one
  });
});
