import { BadRequestException, Injectable } from '@nestjs/common';

import type { AnalyticsQueryDto, AnalyticsRange } from './dto/analytics-query.dto';
import { AnalyticsService, type UnavailableMetric } from './analytics.service';
import { toCsv } from './csv.util';

/**
 * Phase 2D.7 — operator reports and CSV export.
 *
 * READ-ONLY, like the analytics it is built on. Every report is assembled from `AnalyticsService`
 * (Phase 2D.6), which was verified figure-by-figure against direct SQL, so a report can never
 * disagree with the dashboard: there is exactly one computation, used twice.
 *
 * THE RULES CARRIED OVER FROM 2D.6 AND ENFORCED HERE:
 *   - amounts stay in per-currency rows; nothing is summed across currencies (no FX source exists);
 *   - a value that cannot be computed is empty with a stated reason, never a fabricated `0`;
 *   - game-level (`game_rounds`) and ledger-level (`wallet_transactions`) figures stay in separate
 *     reports, labelled, and are never presented as the same measure.
 *
 * Every report carries a metadata envelope (type, range, currency, filters, generatedAt, timezone,
 * definitions) so an exported file is self-describing once it leaves the console.
 */

export const REPORT_TYPES = [
  'financial',
  'gaming',
  'cashier',
  'operations',
  'users',
  'security-audit',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportMeta {
  reportType: ReportType;
  title: string;
  from: string;
  to: string;
  timezone: 'UTC';
  currency: string | null;
  gameKey: string | null;
  generatedAt: string;
  /** Metric → how it is derived. Travels with the export so a file is self-describing. */
  definitions: Record<string, string>;
  /** Anything this report cannot truthfully include. */
  unavailable: UnavailableMetric[];
  rowCount: number;
  /** True when `rowCount` hit {@link MAX_REPORT_ROWS}; never silently truncated. */
  truncated: false;
}

export interface Report {
  meta: ReportMeta;
  columns: string[];
  rows: (string | number | null)[][];
}

/**
 * Hard ceiling on rows in a single report.
 *
 * Every report below is an AGGREGATE (grouped by currency/status/type/day), so real row counts are
 * in the tens — a 366-day daily gaming report is ~366 × currencies. The cap exists so a future
 * report cannot silently become unbounded; if it is ever hit the request is REJECTED rather than
 * truncated, because a truncated financial report that looks complete is worse than no report.
 */
export const MAX_REPORT_ROWS = 50_000;

@Injectable()
export class ReportsService {
  constructor(private readonly analytics: AnalyticsService) {}

  /* ------------------------------------------------------------------ builder */

  async build(type: ReportType, query: AnalyticsQueryDto): Promise<Report> {
    if (!REPORT_TYPES.includes(type)) {
      // Reachable only if a caller bypasses the DTO; kept as a defence in depth.
      throw new BadRequestException(`Unknown report type: ${type}`);
    }
    // Configured ceiling, not the module default — see AnalyticsService.resolveWindow.
    const range = this.analytics.resolveWindow(query);

    const report = await this[
      ({
        financial: 'financialReport',
        gaming: 'gamingReport',
        cashier: 'cashierReport',
        operations: 'operationsReport',
        users: 'usersReport',
        'security-audit': 'securityAuditReport',
      } as const)[type]
    ](query, range);

    if (report.rows.length > MAX_REPORT_ROWS) {
      throw new BadRequestException(
        `Report produced ${report.rows.length} rows, above the ${MAX_REPORT_ROWS} limit. ` +
          'Narrow the date range or add a currency filter. The report was NOT truncated.',
      );
    }
    report.meta.rowCount = report.rows.length;
    return report;
  }

  async toCsvString(type: ReportType, query: AnalyticsQueryDto): Promise<{ csv: string; meta: ReportMeta }> {
    const report = await this.build(type, query);

    // The envelope rides along as comment-style leading rows so an exported file is self-describing
    // and cannot be mistaken for a different range, currency or measure once detached from the UI.
    const preamble: (string | number | null)[][] = [
      ['# report', report.meta.title],
      ['# type', report.meta.reportType],
      ['# range_from_utc', report.meta.from],
      ['# range_to_utc', report.meta.to],
      ['# timezone', report.meta.timezone],
      ['# currency_filter', report.meta.currency ?? 'ALL (rows stay per-currency; never combined)'],
      ['# game_filter', report.meta.gameKey ?? 'ALL'],
      ['# generated_at_utc', report.meta.generatedAt],
      ['# rows', report.meta.rowCount],
      ...Object.entries(report.meta.definitions).map(([k, v]) => [`# definition:${k}`, v]),
      ...report.meta.unavailable.map((u) => [`# unavailable:${u.metric}`, u.reason]),
      [],
    ];

    const csv = toCsv(report.columns, [...preamble, ...report.rows]);
    return { csv, meta: report.meta };
  }

  /* ------------------------------------------------------------------ reports */

  private meta(
    reportType: ReportType,
    title: string,
    query: AnalyticsQueryDto,
    range: AnalyticsRange,
    definitions: Record<string, string>,
    unavailable: UnavailableMetric[] = [],
  ): ReportMeta {
    return {
      reportType,
      title,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      timezone: 'UTC',
      currency: query.currency ?? null,
      gameKey: query.gameKey ?? null,
      generatedAt: new Date().toISOString(),
      definitions,
      unavailable,
      rowCount: 0,
      truncated: false,
    };
  }

  /** Ledger-level money movement. NOT game-level stake/payout — see PHASE_2D6_AUDIT.md §3. */
  private async financialReport(query: AnalyticsQueryDto, range: AnalyticsRange): Promise<Report> {
    const f = await this.analytics.financial(query);
    const rows: (string | number | null)[][] = [
      ...f.transactionsByType.map((t) => ['transaction_volume', t.type, t.currency, t.count, t.total]),
      ...f.feesByCurrency.map((c) => ['fees', 'ALL_TYPES', c.currency, c.count, c.total]),
      ...f.averageCompletedDeposit.map((c) => ['avg_completed_deposit', 'DEPOSIT', c.currency, c.count, c.total]),
      ...f.averageCompletedWithdrawal.map((c) => ['avg_completed_withdrawal', 'WITHDRAWAL', c.currency, c.count, c.total]),
    ];
    return {
      meta: this.meta('financial', 'Financial activity (ledger-level)', query, range, {
        transaction_volume: 'SUM(wallet_transactions.amount) grouped by transaction type and currency.',
        fees: 'SUM(wallet_transactions.fee) per currency. NOT platform revenue — no revenue definition exists.',
        avg_completed_deposit: 'AVG(deposit_requests.amount) WHERE status = COMPLETED, per currency.',
        avg_completed_withdrawal: 'AVG(withdrawal_requests.amount) WHERE status = COMPLETED, per currency.',
        measure_note:
          'Ledger-level. One interactive game round can produce several wallet transactions, so these ' +
          'totals are NOT the same measure as the game-level stake/payout in the gaming report.',
      }, this.analytics.unavailableMetrics().filter((u) =>
        ['revenue', 'expenses', 'profit', 'partnerProfit', 'consolidatedCurrencyTotal'].includes(u.metric))),
      columns: ['metric', 'type', 'currency', 'count', 'amount'],
      rows,
    };
  }

  /** Game-level rounds, stake and payout from `game_rounds`. */
  private async gamingReport(query: AnalyticsQueryDto, range: AnalyticsRange): Promise<Report> {
    const g = await this.analytics.gaming(query);
    const ratio = new Map(g.payoutToStakeRatio.map((r) => [r.currency, r.ratio]));
    const payout = new Map(g.payoutByCurrency.map((r) => [r.currency, r.total]));
    const avgStake = new Map(g.averageStakeByCurrency.map((r) => [r.currency, r.total]));

    const rows: (string | number | null)[][] = [
      ...g.stakeByCurrency.map((s) => [
        'stake_and_payout', s.currency, s.count, s.total, payout.get(s.currency) ?? null,
        avgStake.get(s.currency) ?? null,
        // null, never 0 — a ratio over zero stake is undefined.
        ratio.get(s.currency) ?? null,
      ]),
      ...g.topGames.map((t) => ['rounds_by_game', t.gameKey, t.rounds, null, null, null, null]),
      ['outcome_wins', 'ALL', g.outcomes.wins, null, null, null, null],
      ['outcome_losses', 'ALL', g.outcomes.losses, null, null, null, null],
      ['outcome_ties', 'ALL', g.outcomes.ties, null, null, null, null],
      ['rounds_total_all_statuses', 'ALL', g.roundsTotal, null, null, null, null],
      ['rounds_settled', 'ALL', g.settledRounds, null, null, null, null],
    ];
    return {
      meta: this.meta('gaming', 'Gaming activity (game-level)', query, range, {
        stake_and_payout: 'SUM/AVG of game_rounds.stake and .payout for rounds in SETTLED, RECOVERED, RESOLVED.',
        payout_to_stake_ratio:
          'SUM(payout)/SUM(stake) per currency. EMPTY when stake is zero (undefined, not 0). ' +
          'This is realised payout ratio for the window — NOT certified RTP.',
        rounds_by_game: 'count(*) grouped by game_key, all statuses, top 15 by round count.',
        outcomes: 'Derived from the money result: wins = payout > stake, ties = payout = stake, losses = the rest.',
        measure_note: 'Game-level: one row per round. NOT the ledger-level totals in the financial report.',
      }),
      columns: ['metric', 'currency_or_game', 'count', 'stake', 'payout', 'avg_stake', 'payout_to_stake_ratio'],
      rows,
    };
  }

  /** Deposits and withdrawals by status, per currency, plus the current queue depth. */
  private async cashierReport(query: AnalyticsQueryDto, range: AnalyticsRange): Promise<Report> {
    const f = await this.analytics.financial(query);
    const rows: (string | number | null)[][] = [
      ...f.depositsByStatus.map((d) => ['deposit', d.status, d.currency, d.count, d.total]),
      ...f.withdrawalsByStatus.map((w) => ['withdrawal', w.status, w.currency, w.count, w.total]),
      ['deposit_queue', 'PENDING+PROCESSING', null, f.pendingCashier.deposits, null],
      ['withdrawal_queue', 'PENDING+UNDER_REVIEW', null, f.pendingCashier.withdrawals, null],
    ];
    return {
      meta: this.meta('cashier', 'Cashier activity', query, range, {
        deposit: 'count(*) and SUM(amount) from deposit_requests grouped by status and currency.',
        withdrawal: 'count(*) and SUM(amount) from withdrawal_requests grouped by status and currency.',
        windowing:
          'Rows are windowed on request CREATION time, not completion time. A request created before ' +
          '`to` and completed after it still appears, under its status at query time.',
        netting: 'Deposits and withdrawals are reported separately and are never netted into a single flow figure.',
      }, this.analytics.unavailableMetrics().filter((u) => u.metric === 'consolidatedCurrencyTotal')),
      columns: ['flow', 'status', 'currency', 'count', 'amount'],
      rows,
    };
  }

  /** Settlement queue, recovery state and notification counts. */
  private async operationsReport(query: AnalyticsQueryDto, range: AnalyticsRange): Promise<Report> {
    const o = await this.analytics.operations(query);
    const rows: (string | number | null)[][] = [
      ['pending_settlements', 'point_in_time', o.pendingSettlements],
      ['recovering', 'point_in_time', o.recovering],
      ['recovery_failed', 'point_in_time', o.recoveryFailed],
      ['notifications_created', 'in_range', o.notifications],
      ['notifications_unread', 'in_range', o.notificationsUnread],
      ...Object.entries(o.securityByType).map(([type, n]) => [`security_event:${type}`, 'in_range', n]),
    ];
    return {
      meta: this.meta('operations', 'Operational & recovery report', query, range, {
        point_in_time:
          'Queue depths reflect state NOW and deliberately ignore the date filter — changing the ' +
          'range will not move them.',
        recovery_failed: 'game_rounds in RECOVERY_FAILED: rounds needing manual intervention.',
        notifications_created: 'In-app notification records written in the window. NOT external delivery.',
      }),
      columns: ['metric', 'basis', 'value'],
      rows,
    };
  }

  /** Registration, verification and activity counts. */
  private async usersReport(query: AnalyticsQueryDto, range: AnalyticsRange): Promise<Report> {
    const u = await this.analytics.users(query);
    const rows: (string | number | null)[][] = [
      ['registered', 'point_in_time', u.registered],
      ['email_verified', 'point_in_time', u.emailVerified],
      ...Object.entries(u.byStatus).map(([s, n]) => [`status:${s}`, 'point_in_time', n]),
      ['played', 'in_range', u.playedInRange],
      ['deposited', 'in_range', u.depositedInRange],
      ['withdrew', 'in_range', u.withdrewInRange],
      ['logged_in', 'in_range', u.loggedInInRange],
      // EMPTY, not 0, when undefined.
      ['deposit_conversion_rate', 'in_range', u.depositConversionRate],
    ];
    return {
      meta: this.meta('users', 'User account & activity report', query, range, {
        played: 'count(DISTINCT user_id) over game_rounds in the window. NOT DAU.',
        logged_in: 'count(DISTINCT user_id) over successful login_history rows. NOT DAU, not sessions, not visits.',
        deposit_conversion_rate:
          'depositors in window / all registered accounts. EMPTY when there are no registered users. ' +
          'DEPOSIT conversion only — not marketing conversion.',
        email_verified: 'Email verification only. NOT KYC or identity verification.',
      }, this.analytics.unavailableMetrics().filter((u2) =>
        ['dau', 'mau', 'retention', 'ltv', 'sessionTime', 'bounceRate', 'marketingConversion'].includes(u2.metric))),
      columns: ['metric', 'basis', 'value'],
      rows,
    };
  }

  /** Security events and audit records — with the two audit stores kept apart (Phase 2D.7 Part D). */
  private async securityAuditReport(query: AnalyticsQueryDto, range: AnalyticsRange): Promise<Report> {
    const o = await this.analytics.operations(query);
    const audit = await this.analytics.auditCoverage(query);

    const rows: (string | number | null)[][] = [
      ['audit_trail_records', 'in_range', audit.auditTrailRecords],
      // EMPTY, not 0 — see the definition below.
      ['admin_audit_records', 'in_range', audit.adminAuditRecords],
      // Deliberately EMPTY: the two audit stores share no correlating key, so a combined total
      // cannot be proven free of double-counting. The reason travels in the metadata envelope.
      ['total_audit_records', 'in_range', audit.totalAuditRecords],
      ['security_events', 'in_range', o.securityEvents],
      ...Object.entries(audit.auditByAction).map(([a, n]) => [`audit_action:${a}`, 'in_range', n]),
      ...Object.entries(o.auditByEntity).map(([e, n]) => [`audit_entity:${e}`, 'in_range', n]),
      ...Object.entries(o.securityByType).map(([t, n]) => [`security_type:${t}`, 'in_range', n]),
    ];
    return {
      meta: this.meta('security-audit', 'Security & audit report', query, range, {
        audit_trail_records: 'count(*) of audit_trails in the window — the platform\'s ACTIVE audit store.',
        admin_audit_records: audit.adminAuditReason,
        total_audit_records: audit.totalAuditReason,
        security_events: 'count(*) of security_events in the window.',
      }, audit.unavailable),
      columns: ['metric', 'basis', 'value'],
      rows,
    };
  }
}
