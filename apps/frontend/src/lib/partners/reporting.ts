/**
 * Partner reporting (Phase 6C, STEP 6).
 *
 * Read-only aggregation: player acquisition, traffic, conversions, lifetime value,
 * retention, commission summary and revenue summary — with export-ready `{columns,
 * rows}` contracts + a CSV serializer. Financial figures come from the read-only
 * `PlayerFinancialPort` (logical NGR/LTV); nothing here moves money.
 */
import { type AffiliateService } from './affiliate-service';
import { type CommissionEngine } from './commission-engine';
import { type AgentHierarchy } from './hierarchy';
import { type PlayerFinancialPort } from './ports';
import {
  type AcquisitionReport,
  type CommissionSummary,
  type Report,
  type RevenueReport,
} from './types';

export interface ReportingDeps {
  affiliates: AffiliateService;
  commissions: CommissionEngine;
  hierarchy: AgentHierarchy;
  financials: PlayerFinancialPort;
  clock?: () => number;
}

export class PartnerReporting {
  private readonly clock: () => number;
  constructor(private readonly deps: ReportingDeps) {
    this.clock = deps.clock ?? (() => Date.now());
  }

  acquisition(affiliateId: string, campaign?: string): AcquisitionReport {
    const s = this.deps.affiliates.campaignStats(affiliateId, campaign);
    return { partnerId: affiliateId, clicks: s.clicks, registrations: s.registrations, qualified: s.qualified, conversionRate: s.clicks ? s.qualified / s.clicks : 0 };
  }

  /** LTV/NGR + retention across an affiliate's attributed players (logical). */
  revenue(affiliateId: string, opts?: { retentionThreshold?: number }): RevenueReport {
    const players = this.deps.affiliates.playersFor(affiliateId);
    let ngr = 0;
    let deposits = 0;
    let retained = 0;
    const threshold = opts?.retentionThreshold ?? 1;
    for (const p of players) {
      const f = this.deps.financials.financials(p);
      ngr += f.ngr;
      deposits += f.depositTotal;
      if (f.depositTotal >= threshold) retained += 1;
    }
    const count = players.length;
    return { partnerId: affiliateId, ngr, ltv: count ? Math.floor(deposits / count) : 0, players: count, retainedPlayers: retained, retentionRate: count ? retained / count : 0 };
  }

  commission(partnerId: string): CommissionSummary {
    const s = this.deps.commissions.summary(partnerId);
    return { partnerId, pending: s.pending, approved: s.approved, paid: s.paid, total: s.total, balance: s.balance };
  }

  /** Roll a partner's commission up its downline (network revenue view). */
  networkCommission(partnerId: string): CommissionSummary {
    const ids = [partnerId, ...this.deps.hierarchy.descendants(partnerId)];
    const agg = ids.reduce(
      (acc, id) => {
        const s = this.deps.commissions.summary(id);
        return { pending: acc.pending + s.pending, approved: acc.approved + s.approved, paid: acc.paid + s.paid, total: acc.total + s.total, balance: acc.balance + s.balance };
      },
      { pending: 0, approved: 0, paid: 0, total: 0, balance: 0 },
    );
    return { partnerId, ...agg };
  }

  /** Export-ready commission report for an affiliate. */
  exportCommission(partnerId: string): Report {
    const rows = this.deps.commissions.history(partnerId).map((e) => [e.at, e.model, e.amount, e.status, e.base ?? '', e.reason ?? ''] as (string | number)[]);
    return { name: 'commission-report', columns: ['at', 'model', 'amount', 'status', 'base', 'reason'], rows, generatedAt: this.clock() };
  }

  static toCsv(report: Report): string {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [report.columns.join(','), ...report.rows.map((r) => r.map(esc).join(','))].join('\n');
  }
}
