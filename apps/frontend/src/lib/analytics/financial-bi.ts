/**
 * Financial BI (Phase 6D, STEP 3).
 *
 * Read-only revenue / deposit / withdrawal / treasury / payment-success / commission
 * / cashflow analytics from the event stream + the financial snapshot port. Every
 * figure is derived, never authoritative — the ledger/treasury remain the source of
 * truth. Export-ready. No money movement.
 */
import { type AnalyticsService } from './analytics-service';
import { type FinancialSnapshotPort } from './ports';
import { type FinancialBIReport, type Report, EventType, Granularity } from './types';

export class FinancialBI {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly financial: FinancialSnapshotPort,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private totals(type: EventType, tenantId?: string, from?: number, to?: number): { count: number; total: number } {
    const rows = this.analytics.query({ type, tenantId, from, to });
    return { count: rows.length, total: rows.reduce((s, e) => s + (e.amount ?? 0), 0) };
  }

  /** Payment success rate = successful deposits / (successful + failed). */
  paymentSuccessRate(tenantId?: string): number {
    const ok = this.analytics.query({ type: EventType.Deposit, tenantId }).length;
    const failed = this.analytics.query({ type: EventType.DepositFailed, tenantId }).length;
    return ok + failed === 0 ? 1 : ok / (ok + failed);
  }

  report(opts: { tenantId?: string; commission?: { total: number; balance: number } } = {}): FinancialBIReport {
    const deposits = this.totals(EventType.Deposit, opts.tenantId);
    const withdrawals = this.totals(EventType.Withdrawal, opts.tenantId);
    const treasury = this.financial.treasury();
    return {
      deposits,
      withdrawals,
      paymentSuccessRate: this.paymentSuccessRate(opts.tenantId),
      treasury: { reservedTotal: treasury.reservedTotal, pending: treasury.pending, settlement: treasury.settlement, external: treasury.external, balanced: treasury.balanced },
      commission: opts.commission ?? { total: 0, balance: 0 },
      netCashflow: deposits.total - withdrawals.total,
      generatedAt: this.clock(),
    };
  }

  /** Daily cashflow trend (deposits − withdrawals per bucket). */
  cashflowTrend(tenantId?: string): { at: number; deposits: number; withdrawals: number; net: number }[] {
    const dims = tenantId ? { tenantId } : undefined;
    const dep = new Map(this.analytics.timeSeries('event.deposit.amount', Granularity.Day, dims ? { dims } : undefined).map((p) => [p.at, p.value]));
    const wd = new Map(this.analytics.timeSeries('event.withdrawal.amount', Granularity.Day, dims ? { dims } : undefined).map((p) => [p.at, p.value]));
    const buckets = [...new Set([...dep.keys(), ...wd.keys()])].sort((a, b) => a - b);
    return buckets.map((at) => {
      const d = dep.get(at) ?? 0;
      const w = wd.get(at) ?? 0;
      return { at, deposits: d, withdrawals: w, net: d - w };
    });
  }

  export(opts: { tenantId?: string; commission?: { total: number; balance: number } } = {}): Report {
    const r = this.report(opts);
    return {
      name: 'financial-bi',
      columns: ['metric', 'value'],
      rows: [
        ['depositCount', r.deposits.count],
        ['depositTotal', r.deposits.total],
        ['withdrawalCount', r.withdrawals.count],
        ['withdrawalTotal', r.withdrawals.total],
        ['paymentSuccessRate', Math.round(r.paymentSuccessRate * 10_000) / 10_000],
        ['treasuryPending', r.treasury.pending],
        ['treasuryBalanced', r.treasury.balanced ? 1 : 0],
        ['netCashflow', r.netCashflow],
      ],
      generatedAt: r.generatedAt,
    };
  }
}
