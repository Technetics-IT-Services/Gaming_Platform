import { Injectable } from '@nestjs/common';
import { DepositStatus, GameRoundStatus, Prisma, WithdrawalStatus } from '@prisma/client';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { resolveRange, type AnalyticsQueryDto, type AnalyticsRange } from './dto/analytics-query.dto';

/**
 * Derivable platform analytics (Phase 2D.6).
 *
 * STRICTLY READ-ONLY. Every method issues `count` / `aggregate` / `groupBy` / `findMany` or a
 * parameterised read-only `$queryRaw` SELECT. Nothing here credits, debits, reserves, commits,
 * releases, settles, refunds, or writes any row — analytics can never change financial state.
 *
 * THREE RULES THIS SERVICE OBEYS
 *
 * 1. NOTHING IS FABRICATED. Every number traces to a table that a service already writes inside a
 *    transaction. Metrics whose source does not exist (DAU, MAU, retention, LTV, session time, bounce
 *    rate, revenue, expenses, profit) are NOT computed here — they are reported as unavailable by
 *    `unavailableMetrics()`, with the reason.
 *
 * 2. CURRENCIES ARE NEVER COMBINED. `exchange_rates` is empty and nothing writes it, so there is no
 *    FX source. Every financial aggregate is returned as a per-currency bucket.
 *
 * 3. GAME-LEVEL AND LEDGER-LEVEL FIGURES ARE KEPT APART. `GameRound` holds one row per round;
 *    `WalletTransaction` holds one row per money movement and a single interactive round can produce
 *    several (Blackjack DOUBLE, Mines stages). The two totals are NOT expected to match, and this
 *    service never presents one as the other. See PHASE_2D6_AUDIT.md §3.
 *
 * All grouping and filtering is in UTC.
 */

/** Round statuses in which money has actually moved and the round has a final stake/payout. */
export const SETTLED_STATUSES: GameRoundStatus[] = [
  GameRoundStatus.SETTLED,
  GameRoundStatus.RECOVERED,
  GameRoundStatus.RESOLVED,
];

export interface CurrencyBucket {
  currency: string;
  /** Decimal string — never a float, never converted between currencies. */
  total: string;
  count: number;
}

export interface GamingSummary {
  roundsTotal: number;
  roundsByStatus: Record<string, number>;
  /** Rounds counted in the stake/payout figures below (SETTLED + RECOVERED + RESOLVED). */
  settledRounds: number;
  stakeByCurrency: CurrencyBucket[];
  payoutByCurrency: CurrencyBucket[];
  averageStakeByCurrency: CurrencyBucket[];
  averagePayoutByCurrency: CurrencyBucket[];
  /** sum(payout)/sum(stake) per currency; null when stake is zero (never a fabricated 0 or 1). */
  payoutToStakeRatio: { currency: string; ratio: number | null }[];
  outcomes: { wins: number; losses: number; ties: number };
  topGames: { gameKey: string; rounds: number }[];
}

export interface FinancialSummary {
  transactionsByType: { type: string; currency: string; count: number; total: string }[];
  depositsByStatus: { status: string; currency: string; count: number; total: string }[];
  withdrawalsByStatus: { status: string; currency: string; count: number; total: string }[];
  averageCompletedDeposit: CurrencyBucket[];
  averageCompletedWithdrawal: CurrencyBucket[];
  pendingCashier: { deposits: number; withdrawals: number };
  feesByCurrency: CurrencyBucket[];
}

export interface UsersSummary {
  registered: number;
  byStatus: Record<string, number>;
  emailVerified: number;
  /** DISTINCT users with at least one round in the window. Not DAU — see `unavailableMetrics`. */
  playedInRange: number;
  depositedInRange: number;
  withdrewInRange: number;
  loggedInInRange: number;
  /** playedInRange etc. are counts; this ratio is DEPOSIT conversion, not marketing conversion. */
  depositConversionRate: number | null;
}

export interface OperationsSummary {
  pendingSettlements: number;
  recoveryFailed: number;
  recovering: number;
  auditRecords: number;
  auditByEntity: Record<string, number>;
  securityEvents: number;
  securityByType: Record<string, number>;
  notifications: number;
  notificationsUnread: number;
}

export interface UnavailableMetric {
  metric: string;
  reason: string;
}

export interface AnalyticsMeta {
  from: string;
  to: string;
  timezone: 'UTC';
  currency: string | null;
  gameKey: string | null;
  /** Metrics deliberately not returned, with the reason. Never silently omitted. */
  unavailable: UnavailableMetric[];
}

const dec = (v: Prisma.Decimal | null | undefined): string => (v ? v.toString() : '0');

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Resolve the query window using the CONFIGURED maximum (Phase 2D.7 Part B).
   *
   * Every public method goes through this rather than calling `resolveRange` directly, so the
   * operational safeguard cannot be bypassed by adding a new endpoint that forgets it.
   */
  private range(query: AnalyticsQueryDto): AnalyticsRange {
    return resolveRange(query, this.config.analytics.maxRangeDays);
  }

  /**
   * The same configured window resolution, for collaborators that need the resolved range
   * (`ReportsService` stamps it into a report's metadata envelope).
   *
   * Exposed deliberately: a caller that resolved the range itself would silently fall back to the
   * DEFAULT ceiling and could report a window wider than the deployment allows.
   */
  resolveWindow(query: AnalyticsQueryDto): AnalyticsRange {
    return this.range(query);
  }

  /**
   * Metrics the platform CANNOT truthfully produce, and why.
   *
   * Returned with every response so a consumer can render "Not available" instead of a fabricated
   * zero. Each reason names the missing source, verified empty in PHASE_2D6_AUDIT.md §2.
   */
  unavailableMetrics(): UnavailableMetric[] {
    return [
      { metric: 'dau', reason: 'NOT AVAILABLE FROM THIS RESPONSE — see GET /analytics/engagement (Phase 2D.9). The activity-event pipeline records DAU/MAU, but it has NO BACKFILL, so this general summary carries no figure that could be mistaken for history.' },
      { metric: 'mau', reason: 'NOT AVAILABLE FROM THIS RESPONSE — see GET /analytics/engagement. Same no-backfill caveat as DAU.' },
      { metric: 'retention', reason: 'NOT AVAILABLE — BUSINESS DEFINITION MISSING: events are now recorded, but no cohort definition (start event, day boundaries) is specified.' },
      { metric: 'ltv', reason: 'NOT AVAILABLE: requires the accounting definition of revenue that also blocks F-02.' },
      { metric: 'sessionTime', reason: 'NOT AVAILABLE: sessions.lastActivityAt only advances on token rotation, so any duration would reflect refresh cadence, not user behaviour.' },
      { metric: 'bounceRate', reason: 'NOT AVAILABLE — SOURCE DATA NOT PRESENT: page_views is empty.' },
      { metric: 'revenue', reason: 'NOT AVAILABLE: no accounting definition of revenue is established for this platform. Stake volume and ledger volume are reported instead, under their own names.' },
      { metric: 'expenses', reason: 'NOT AVAILABLE — SOURCE DATA NOT PRESENT: there is no expense model in the schema.' },
      { metric: 'profit', reason: 'NOT AVAILABLE: blocked by expenses. Profit will not be inferred from deposits−withdrawals or stakes−payouts.' },
      { metric: 'partnerProfit', reason: 'NOT AVAILABLE — SOURCE DATA NOT PRESENT: no partner entity exists.' },
      { metric: 'consolidatedCurrencyTotal', reason: 'NOT AVAILABLE: exchange_rates is empty, so no FX source exists. Totals are reported per currency and never combined.' },
      { metric: 'marketingConversion', reason: 'NOT AVAILABLE — SOURCE DATA NOT PRESENT: visitor funnel needs page_views, which is empty. `depositConversionRate` is a different, explicitly-named metric.' },
    ];
  }

  meta(query: AnalyticsQueryDto, range: AnalyticsRange): AnalyticsMeta {
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      timezone: 'UTC',
      currency: query.currency ?? null,
      gameKey: query.gameKey ?? null,
      unavailable: this.unavailableMetrics(),
    };
  }

  /* ------------------------------------------------------------------ gaming */

  async gaming(query: AnalyticsQueryDto): Promise<GamingSummary> {
    const range = this.range(query);
    const currencyId = await this.currencyId(query.currency);
    const base: Prisma.GameRoundWhereInput = {
      createdAt: { gte: range.from, lt: range.to },
      ...(currencyId ? { currencyId } : {}),
      ...(query.gameKey ? { gameKey: query.gameKey } : {}),
    };
    const settled: Prisma.GameRoundWhereInput = { ...base, status: { in: SETTLED_STATUSES } };

    const [roundsTotal, byStatus, settledRounds, stakeGroups, topGames] = await Promise.all([
      this.prisma.gameRound.count({ where: base }),
      this.prisma.gameRound.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.gameRound.count({ where: settled }),
      this.prisma.gameRound.groupBy({
        by: ['currencyId'],
        where: settled,
        _sum: { stake: true, payout: true },
        _avg: { stake: true, payout: true },
        _count: { _all: true },
      }),
      this.prisma.gameRound.groupBy({
        by: ['gameKey'],
        where: base,
        _count: { _all: true },
        orderBy: { _count: { gameKey: 'desc' } },
        take: 15,
      }),
    ]);

    const codes = await this.currencyCodes(stakeGroups.map((g) => g.currencyId));

    // Win/loss/tie are derived from the MONEY OUTCOME (there is no stored win flag) — documented as
    // a YELLOW metric in PHASE_2D6_AUDIT.md §6.1.
    const [wins, ties] = await Promise.all([
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM game_rounds
        WHERE created_at >= ${range.from} AND created_at < ${range.to}
          AND status::text = ANY(${SETTLED_STATUSES})
          AND (${currencyId}::uuid IS NULL OR currency_id = ${currencyId}::uuid)
          AND (${query.gameKey ?? null}::text IS NULL OR game_key = ${query.gameKey ?? null}::text)
          AND payout > stake`,
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM game_rounds
        WHERE created_at >= ${range.from} AND created_at < ${range.to}
          AND status::text = ANY(${SETTLED_STATUSES})
          AND (${currencyId}::uuid IS NULL OR currency_id = ${currencyId}::uuid)
          AND (${query.gameKey ?? null}::text IS NULL OR game_key = ${query.gameKey ?? null}::text)
          AND payout = stake`,
    ]);
    const winCount = Number(wins[0]?.n ?? 0);
    const tieCount = Number(ties[0]?.n ?? 0);

    return {
      roundsTotal,
      roundsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      settledRounds,
      stakeByCurrency: stakeGroups.map((g) => ({ currency: codes[g.currencyId] ?? g.currencyId, total: dec(g._sum.stake), count: g._count._all })),
      payoutByCurrency: stakeGroups.map((g) => ({ currency: codes[g.currencyId] ?? g.currencyId, total: dec(g._sum.payout), count: g._count._all })),
      averageStakeByCurrency: stakeGroups.map((g) => ({ currency: codes[g.currencyId] ?? g.currencyId, total: dec(g._avg.stake), count: g._count._all })),
      averagePayoutByCurrency: stakeGroups.map((g) => ({ currency: codes[g.currencyId] ?? g.currencyId, total: dec(g._avg.payout), count: g._count._all })),
      payoutToStakeRatio: stakeGroups.map((g) => {
        const stake = Number(g._sum.stake ?? 0);
        const payout = Number(g._sum.payout ?? 0);
        // null, not 0 and not 1 — a ratio over zero stake is undefined, not a value.
        return { currency: codes[g.currencyId] ?? g.currencyId, ratio: stake > 0 ? payout / stake : null };
      }),
      outcomes: { wins: winCount, losses: settledRounds - winCount - tieCount, ties: tieCount },
      topGames: topGames.map((g) => ({ gameKey: g.gameKey, rounds: g._count._all })),
    };
  }

  /* --------------------------------------------------------------- financial */

  async financial(query: AnalyticsQueryDto): Promise<FinancialSummary> {
    const range = this.range(query);
    const currencyId = await this.currencyId(query.currency);
    const window = { createdAt: { gte: range.from, lt: range.to }, ...(currencyId ? { currencyId } : {}) };

    const [txns, deposits, withdrawals, depAvg, wdAvg, pendingDep, pendingWd] = await Promise.all([
      this.prisma.walletTransaction.groupBy({
        by: ['typeId', 'currencyId'], where: window, _count: { _all: true }, _sum: { amount: true, fee: true },
      }),
      this.prisma.depositRequest.groupBy({
        by: ['status', 'currencyId'], where: window, _count: { _all: true }, _sum: { amount: true },
      }),
      this.prisma.withdrawalRequest.groupBy({
        by: ['status', 'currencyId'], where: window, _count: { _all: true }, _sum: { amount: true },
      }),
      this.prisma.depositRequest.groupBy({
        by: ['currencyId'], where: { ...window, status: DepositStatus.COMPLETED }, _avg: { amount: true }, _count: { _all: true },
      }),
      this.prisma.withdrawalRequest.groupBy({
        by: ['currencyId'], where: { ...window, status: WithdrawalStatus.COMPLETED }, _avg: { amount: true }, _count: { _all: true },
      }),
      this.prisma.depositRequest.count({ where: { ...window, status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] } } }),
      this.prisma.withdrawalRequest.count({ where: { ...window, status: { in: [WithdrawalStatus.PENDING, WithdrawalStatus.UNDER_REVIEW] } } }),
    ]);

    const allCurrencyIds = [
      ...txns.map((t) => t.currencyId), ...deposits.map((d) => d.currencyId),
      ...withdrawals.map((w) => w.currencyId), ...depAvg.map((d) => d.currencyId), ...wdAvg.map((w) => w.currencyId),
    ];
    const [codes, typeCodes] = await Promise.all([
      this.currencyCodes(allCurrencyIds),
      this.transactionTypeCodes(txns.map((t) => t.typeId)),
    ]);

    // Fee totals are grouped per currency across every transaction type.
    const feeByCurrency = new Map<string, { total: number; count: number }>();
    for (const t of txns) {
      const code = codes[t.currencyId] ?? t.currencyId;
      const cur = feeByCurrency.get(code) ?? { total: 0, count: 0 };
      cur.total += Number(t._sum.fee ?? 0);
      cur.count += t._count._all;
      feeByCurrency.set(code, cur);
    }

    return {
      transactionsByType: txns.map((t) => ({
        type: typeCodes[t.typeId] ?? t.typeId,
        currency: codes[t.currencyId] ?? t.currencyId,
        count: t._count._all,
        total: dec(t._sum.amount),
      })),
      depositsByStatus: deposits.map((d) => ({
        status: d.status, currency: codes[d.currencyId] ?? d.currencyId, count: d._count._all, total: dec(d._sum.amount),
      })),
      withdrawalsByStatus: withdrawals.map((w) => ({
        status: w.status, currency: codes[w.currencyId] ?? w.currencyId, count: w._count._all, total: dec(w._sum.amount),
      })),
      averageCompletedDeposit: depAvg.map((d) => ({ currency: codes[d.currencyId] ?? d.currencyId, total: dec(d._avg.amount), count: d._count._all })),
      averageCompletedWithdrawal: wdAvg.map((w) => ({ currency: codes[w.currencyId] ?? w.currencyId, total: dec(w._avg.amount), count: w._count._all })),
      pendingCashier: { deposits: pendingDep, withdrawals: pendingWd },
      feesByCurrency: [...feeByCurrency.entries()].map(([currency, v]) => ({ currency, total: String(v.total), count: v.count })),
    };
  }

  /* -------------------------------------------------------------------- users */

  async users(query: AnalyticsQueryDto): Promise<UsersSummary> {
    const range = this.range(query);

    // Phase 2D.7 (Part A): these four were `findMany({ distinct: ['userId'], select: { userId } })`,
    // which transfers one row PER DISTINCT USER into Node just to read `.length`. Benchmarked on the
    // synthetic 10k-round / 50k-transaction dataset, `users()` over a 366-day range grew RSS by
    // ~8-11 MB per call and dominated `summary()`. `COUNT(DISTINCT ...)` does the same work in
    // Postgres and returns a single number, so memory no longer scales with the user base.
    // See PHASE_2D7_PERFORMANCE.md.
    const [registered, byStatus, emailVerified, played, deposited, withdrew, loggedIn] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.user.count({ where: { deletedAt: null, emailVerified: true } }),
      this.countDistinctUsers`
        SELECT count(DISTINCT user_id)::bigint AS n FROM game_rounds
        WHERE created_at >= ${range.from} AND created_at < ${range.to}`,
      this.countDistinctUsers`
        SELECT count(DISTINCT user_id)::bigint AS n FROM deposit_requests
        WHERE created_at >= ${range.from} AND created_at < ${range.to} AND status = 'COMPLETED'`,
      this.countDistinctUsers`
        SELECT count(DISTINCT user_id)::bigint AS n FROM withdrawal_requests
        WHERE created_at >= ${range.from} AND created_at < ${range.to} AND status = 'COMPLETED'`,
      this.countDistinctUsers`
        SELECT count(DISTINCT user_id)::bigint AS n FROM login_history
        WHERE created_at >= ${range.from} AND created_at < ${range.to} AND success = true`,
    ]);

    return {
      registered,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      emailVerified,
      playedInRange: played,
      depositedInRange: deposited,
      withdrewInRange: withdrew,
      loggedInInRange: loggedIn,
      // DEPOSIT conversion only. Never presented as marketing/visitor conversion.
      depositConversionRate: registered > 0 ? deposited / registered : null,
    };
  }

  /* --------------------------------------------------------------- operations */

  async operations(query: AnalyticsQueryDto): Promise<OperationsSummary> {
    const range = this.range(query);
    const inRange = { createdAt: { gte: range.from, lt: range.to } };

    const [pendingSettlements, recoveryFailed, recovering, auditRecords, auditByEntity, securityEvents, securityByType, notifications, unread] =
      await Promise.all([
        this.prisma.gameRound.count({ where: { status: GameRoundStatus.PENDING_SETTLEMENT } }),
        this.prisma.gameRound.count({ where: { status: GameRoundStatus.RECOVERY_FAILED } }),
        this.prisma.gameRound.count({ where: { status: GameRoundStatus.RECOVERING } }),
        this.prisma.auditTrail.count({ where: inRange }),
        this.prisma.auditTrail.groupBy({ by: ['entityType'], where: inRange, _count: { _all: true } }),
        this.prisma.securityEvent.count({ where: inRange }),
        this.prisma.securityEvent.groupBy({ by: ['type'], where: inRange, _count: { _all: true } }),
        this.prisma.notification.count({ where: { ...inRange, deletedAt: null } }),
        this.prisma.notification.count({ where: { ...inRange, deletedAt: null, readAt: null } }),
      ]);

    return {
      pendingSettlements,
      recoveryFailed,
      recovering,
      auditRecords,
      auditByEntity: Object.fromEntries(auditByEntity.map((r) => [r.entityType, r._count._all])),
      securityEvents,
      securityByType: Object.fromEntries(securityByType.map((r) => [r.type, r._count._all])),
      notifications,
      notificationsUnread: unread,
    };
  }

  /* ------------------------------------------------------- audit coverage (2D.7) */

  /**
   * Audit-record counts, with the two audit stores kept HONESTLY apart (Phase 2D.7, Part D).
   *
   * THE RELATIONSHIP WAS ESTABLISHED BY EVIDENCE, NOT ASSUMED:
   *
   *   1. WRITERS. `audit_trails` is written by exactly one service (`AuditService.record`).
   *      `admin_audit_logs` has **zero writers anywhere in the codebase** — the only references to
   *      it are the two `count()` reads below.
   *   2. ROWS. `audit_trails` is populated; `admin_audit_logs` has zero rows all-time (as does
   *      `admin_users`, the table its FK points at).
   *   3. SUBJECT. They describe different subjects: `AuditTrail.userId -> users.id` versus
   *      `AdminAuditLog.adminId -> admin_users.id`.
   *   4. NO CORRELATING KEY. `audit_trails` identifies its object as `entity_type`/`entity_id`;
   *      `admin_audit_logs` uses `resource`/`resource_id`. There is no shared identifier and no
   *      foreign key between the two tables.
   *
   * VERDICT: they are COMPLEMENTARY stores that CANNOT BE SAFELY COMBINED. Point 4 is the decisive
   * one — with no correlating key, if both were ever populated there would be no way to detect or
   * remove an overlapping event. So **no combined total is exposed, ever**. That is a permanent
   * property of the schema, not a temporary consequence of one store being empty.
   *
   * Admin actions are NOT unaudited: they are recorded in `audit_trails` (live rows include
   * `admin_session/LOGIN`, `withdrawal_request/APPROVE|REJECT|EXECUTE`, `deposit_request/APPROVE`,
   * `user_role/UPDATE`). This is why `adminAuditRecords` is reported as `null` rather than `0` while
   * the store is dormant: a zero would read as "no admin actions were audited", which is false.
   *
   * The dormant-vs-populated decision is made at RUNTIME from the data, not hardcoded.
   */
  async auditCoverage(query: AnalyticsQueryDto): Promise<{
    auditTrailRecords: number;
    adminAuditRecords: number | null;
    adminAuditReason: string;
    /** Always `null`: the stores have no correlating key, so a total cannot be proven safe. */
    totalAuditRecords: null;
    totalAuditReason: string;
    auditByAction: Record<string, number>;
    unavailable: UnavailableMetric[];
  }> {
    const range = this.range(query);
    const inRange = { createdAt: { gte: range.from, lt: range.to } };

    const [auditTrailRecords, byAction, adminInRange, adminAllTime] = await Promise.all([
      this.prisma.auditTrail.count({ where: inRange }),
      this.prisma.auditTrail.groupBy({ by: ['action'], where: inRange, _count: { _all: true } }),
      this.prisma.adminAuditLog.count({ where: inRange }),
      // All-time, so a store that has NEVER been written is distinguished from one that is merely
      // quiet in this particular window. Those two mean very different things to an operator.
      this.prisma.adminAuditLog.count(),
    ]);

    const dormant = adminAllTime === 0;

    return {
      auditTrailRecords,
      adminAuditRecords: dormant ? null : adminInRange,
      adminAuditReason: dormant
        ? 'NOT AVAILABLE — SOURCE NOT WRITTEN: admin_audit_logs has no writer anywhere in the codebase ' +
          'and zero rows all-time. Reported as empty rather than 0, because 0 would read as "no admin ' +
          'actions were audited" — admin actions ARE audited, in audit_trails.'
        : 'count(*) of admin_audit_logs in the window.',
      totalAuditRecords: null,
      totalAuditReason:
        'Combined total unavailable because the stores cannot safely be deduplicated: audit_trails ' +
        'identifies its object as entity_type/entity_id while admin_audit_logs uses ' +
        'resource/resource_id, with no shared key and no foreign key between them. Overlap could ' +
        'therefore never be detected, so no total is reported. Counts are given separately above.',
      auditByAction: Object.fromEntries(byAction.map((r) => [r.action, r._count._all])),
      unavailable: [
        ...(dormant
          ? [{
              metric: 'adminAuditRecords',
              reason:
                'NOT AVAILABLE — SOURCE NOT WRITTEN: the admin_audit_logs table exists in the schema ' +
                'but nothing writes it (0 rows all-time, 0 writers in code). Admin actions are ' +
                'recorded in audit_trails instead, which IS counted.',
            }]
          : []),
        {
          metric: 'totalAuditRecords',
          reason:
            'NOT AVAILABLE: audit_trails and admin_audit_logs share no correlating key, so a combined ' +
            'total cannot be proven free of double-counting. Separate counts are reported instead.',
        },
      ],
    };
  }

  /* ------------------------------------------------------------- time series */

  /**
   * Daily gaming and cashier series, grouped in UTC.
   *
   * A day appears ONLY when the underlying query produced rows for it — no synthetic zero-filling.
   * Uses a parameterised read-only `$queryRaw` because Prisma cannot group by a date truncation;
   * every value is a bound parameter, never string-interpolated.
   */
  async daily(query: AnalyticsQueryDto): Promise<{
    rounds: { date: string; currency: string; rounds: number; stake: string; payout: string }[];
    cashier: { date: string; currency: string; deposits: number; depositTotal: string; withdrawals: number; withdrawalTotal: string }[];
  }> {
    const range = this.range(query);
    const currencyId = await this.currencyId(query.currency);
    const gameKey = query.gameKey ?? null;

    const rounds = await this.prisma.$queryRaw<
      { date: Date; currency: string; rounds: bigint; stake: Prisma.Decimal; payout: Prisma.Decimal }[]
    >`
      SELECT date_trunc('day', gr.created_at AT TIME ZONE 'UTC') AS date,
             c.code AS currency,
             count(*)::bigint AS rounds,
             SUM(gr.stake) AS stake,
             SUM(gr.payout) AS payout
      FROM game_rounds gr JOIN currencies c ON c.id = gr.currency_id
      WHERE gr.created_at >= ${range.from} AND gr.created_at < ${range.to}
        AND gr.status::text = ANY(${SETTLED_STATUSES})
        AND (${currencyId}::uuid IS NULL OR gr.currency_id = ${currencyId}::uuid)
        AND (${gameKey}::text IS NULL OR gr.game_key = ${gameKey}::text)
      GROUP BY 1, 2 ORDER BY 1 ASC`;

    const cashier = await this.prisma.$queryRaw<
      { date: Date; currency: string; deposits: bigint; deposit_total: Prisma.Decimal; withdrawals: bigint; withdrawal_total: Prisma.Decimal }[]
    >`
      SELECT d.date, d.currency,
             COALESCE(d.deposits, 0)::bigint AS deposits, COALESCE(d.deposit_total, 0) AS deposit_total,
             COALESCE(w.withdrawals, 0)::bigint AS withdrawals, COALESCE(w.withdrawal_total, 0) AS withdrawal_total
      FROM (
        SELECT date_trunc('day', dr.created_at AT TIME ZONE 'UTC') AS date, c.code AS currency,
               count(*) AS deposits, SUM(dr.amount) AS deposit_total
        FROM deposit_requests dr JOIN currencies c ON c.id = dr.currency_id
        WHERE dr.created_at >= ${range.from} AND dr.created_at < ${range.to}
          AND dr.status = 'COMPLETED'
          AND (${currencyId}::uuid IS NULL OR dr.currency_id = ${currencyId}::uuid)
        GROUP BY 1, 2
      ) d
      FULL OUTER JOIN (
        SELECT date_trunc('day', wr.created_at AT TIME ZONE 'UTC') AS date, c.code AS currency,
               count(*) AS withdrawals, SUM(wr.amount) AS withdrawal_total
        FROM withdrawal_requests wr JOIN currencies c ON c.id = wr.currency_id
        WHERE wr.created_at >= ${range.from} AND wr.created_at < ${range.to}
          AND wr.status = 'COMPLETED'
          AND (${currencyId}::uuid IS NULL OR wr.currency_id = ${currencyId}::uuid)
        GROUP BY 1, 2
      ) w ON w.date = d.date AND w.currency = d.currency
      ORDER BY 1 ASC`;

    return {
      rounds: rounds.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        currency: r.currency,
        rounds: Number(r.rounds),
        stake: dec(r.stake),
        payout: dec(r.payout),
      })),
      cashier: cashier.map((r) => ({
        date: (r.date ?? new Date(0)).toISOString().slice(0, 10),
        currency: r.currency,
        deposits: Number(r.deposits),
        depositTotal: dec(r.deposit_total),
        withdrawals: Number(r.withdrawals),
        withdrawalTotal: dec(r.withdrawal_total),
      })),
    };
  }

  /* ----------------------------------------------------------------- summary */

  /** Everything an operator dashboard needs, in one authenticated round trip. */
  async summary(query: AnalyticsQueryDto) {
    const range = this.range(query);
    const [gaming, financial, users, operations] = await Promise.all([
      this.gaming(query),
      this.financial(query),
      this.users(query),
      this.operations(query),
    ]);
    return { meta: this.meta(query, range), gaming, financial, users, operations };
  }

  /* -------------------------------------------------- engagement (2D.9, X-02) */

  /**
   * DAU / MAU from the activity-event pipeline (Phase 2D.9, X-02).
   *
   * THE DEFINITIONS, STATED SO THEY CANNOT BE MISREAD:
   *   DAU  = distinct users with at least one recorded activity event in a UTC calendar day.
   *   MAU  = distinct users with at least one recorded activity event in the 30 days ending at `to`.
   * Both are counted from `user_activities`, which the pipeline writes on login, deposit and
   * real-money play. No other definition is implied, and none is inferred from logins alone.
   *
   * THE HONEST CAVEAT, RETURNED IN THE PAYLOAD: **the pipeline has no backfill.** History begins at
   * the first recorded event, so a window that starts before `dataAvailableFrom` is genuinely
   * incomplete — the response says so rather than reporting a small number as if it were the truth.
   *
   * DORMANT VS QUIET, decided at runtime from the data (the same rule as `auditCoverage`): if the
   * table has never been written at all, DAU/MAU are reported as **null with a reason**, never as 0.
   * A zero would read as "nobody was active", which is a different and false claim.
   *
   * STILL UNAVAILABLE, and why: retention needs a cohort definition the client has not given; LTV
   * needs the revenue definition that also blocks F-02; session duration needs session start/end
   * events that are not emitted; bounce rate needs page views, and `page_views` is still empty.
   */
  async engagement(query: AnalyticsQueryDto): Promise<{
    definitions: { dau: string; mau: string };
    dataAvailableFrom: string | null;
    windowFullyCovered: boolean;
    eventsInWindow: number;
    activeUsersInWindow: number | null;
    mauRolling30: number | null;
    dailyActiveUsers: { date: string; activeUsers: number }[];
    eventsByType: Record<string, number>;
    unavailable: UnavailableMetric[];
  }> {
    const range = this.range(query);
    const inRange = { occurredAt: { gte: range.from, lt: range.to } };

    const [allTime, earliest, eventsInWindow, byType] = await Promise.all([
      // All-time, so a store that has NEVER been written is distinguished from one that is merely
      // quiet in this particular window. Those two mean very different things to an operator.
      this.prisma.userActivity.count(),
      this.prisma.userActivity.findFirst({ orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } }),
      this.prisma.userActivity.count({ where: inRange }),
      this.prisma.userActivity.groupBy({ by: ['type'], where: inRange, _count: { _all: true } }),
    ]);

    const dormant = allTime === 0;
    const mauFrom = new Date(range.to.getTime() - 30 * 86_400_000);

    const [activeUsersInWindow, mauRolling30, dailyActiveUsers] = dormant
      ? [null, null, [] as { date: string; activeUsers: number }[]]
      : await Promise.all([
        this.countDistinctUsers`
            SELECT count(DISTINCT user_id)::bigint AS n FROM user_activities
            WHERE occurred_at >= ${range.from} AND occurred_at < ${range.to}`,
        this.countDistinctUsers`
            SELECT count(DISTINCT user_id)::bigint AS n FROM user_activities
            WHERE occurred_at >= ${mauFrom} AND occurred_at < ${range.to}`,
        this.prisma.$queryRaw<{ day: Date; n: bigint }[]>`
            SELECT date_trunc('day', occurred_at) AS day, count(DISTINCT user_id)::bigint AS n
            FROM user_activities
            WHERE occurred_at >= ${range.from} AND occurred_at < ${range.to}
            GROUP BY 1 ORDER BY 1`.then((rows) =>
          rows.map((r) => ({ date: r.day.toISOString().slice(0, 10), activeUsers: Number(r.n) })),
        ),
      ]);

    const dormantReason =
      'NOT AVAILABLE — SOURCE NOT YET WRITTEN: the activity-event pipeline exists but has recorded ' +
      'no events. Reported as empty rather than 0, because 0 would read as "nobody was active".';

    return {
      definitions: {
        dau: 'Distinct users with at least one recorded activity event in a UTC calendar day.',
        mau: 'Distinct users with at least one recorded activity event in the 30 days ending at the window end.',
      },
      dataAvailableFrom: earliest?.occurredAt.toISOString() ?? null,
      // False when the requested window reaches back before the first event ever recorded.
      windowFullyCovered: earliest ? earliest.occurredAt <= range.from : false,
      eventsInWindow,
      activeUsersInWindow,
      mauRolling30,
      dailyActiveUsers,
      eventsByType: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
      unavailable: [
        ...(dormant
          ? [
            { metric: 'dau', reason: dormantReason },
            { metric: 'mau', reason: dormantReason },
          ]
          : []),
        ...(earliest && earliest.occurredAt > range.from
          ? [{
            metric: 'coverage',
            reason:
              'INCOMPLETE WINDOW: the activity-event pipeline has no backfill and its earliest record ' +
              `is ${earliest.occurredAt.toISOString()}. Figures before that date reflect absent ` +
              'instrumentation, not absent activity.',
          }]
          : []),
        {
          metric: 'retention',
          reason:
            'NOT AVAILABLE — BUSINESS DEFINITION MISSING: no cohort definition is specified (which ' +
            'event starts a cohort, and at which day boundaries retention is measured). Events are ' +
            'now recorded, so this becomes computable the moment the definition exists.',
        },
        {
          metric: 'ltv',
          reason:
            'NOT AVAILABLE: lifetime value requires the accounting definition of revenue that also ' +
            'blocks F-02. Activity is recorded; the monetary side of the formula is not defined.',
        },
        {
          metric: 'sessionTime',
          reason:
            'NOT AVAILABLE — SOURCE DATA NOT PRESENT: no session start/end events are emitted, and ' +
            'sessions.lastActivityAt only advances on token rotation, so any duration would measure ' +
            'refresh cadence rather than user behaviour.',
        },
        {
          metric: 'bounceRate',
          reason:
            'NOT AVAILABLE — SOURCE DATA NOT PRESENT: page_views is still empty; this pipeline emits ' +
            'no page-view instrumentation.',
        },
      ],
    };
  }

  /* ----------------------------------------------------------------- helpers */

  /**
   * Run a `count(DISTINCT ...)` as a tagged template and return a plain number.
   *
   * Used instead of `findMany({ distinct })` so the count is computed in Postgres and only one row
   * crosses the wire — the memory a distinct-user count uses no longer scales with the user base.
   */
  private countDistinctUsers = async (
    sql: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number> => {
    const rows = await this.prisma.$queryRaw<{ n: bigint }[]>(sql, ...values);
    return Number(rows[0]?.n ?? 0);
  };

  /** Resolve a currency code to its id, or null when unfiltered. Unknown codes yield no rows. */
  private async currencyId(code?: string): Promise<string | null> {
    if (!code) return null;
    const row = await this.prisma.currency.findUnique({ where: { code: code.toUpperCase() }, select: { id: true } });
    // An unknown currency filters everything out rather than being ignored — a silent
    // "filter not applied" would report platform-wide totals under a currency label.
    return row?.id ?? '00000000-0000-0000-0000-000000000000';
  }

  private async currencyCodes(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return {};
    const rows = await this.prisma.currency.findMany({ where: { id: { in: unique } }, select: { id: true, code: true } });
    return Object.fromEntries(rows.map((r) => [r.id, r.code]));
  }

  private async transactionTypeCodes(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return {};
    const rows = await this.prisma.transactionType.findMany({ where: { id: { in: unique } }, select: { id: true, code: true } });
    return Object.fromEntries(rows.map((r) => [r.id, r.code]));
  }
}
