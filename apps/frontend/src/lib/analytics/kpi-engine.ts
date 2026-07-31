/**
 * KPI engine (Phase 6D, STEP 2).
 *
 * Computes the executive KPI set from the ingested event stream (+ financial port):
 * revenue, NGR, DAU, MAU, retention, churn, LTV, ARPU, ARPPU, conversion and growth.
 * Pure, deterministic aggregation over read-only facts. No money movement.
 */
import { type AnalyticsService } from './analytics-service';
import { type FinancialSnapshotPort } from './ports';
import { type ExecutiveKPIs, EventType } from './types';

const DAY_MS = 24 * 3_600_000;

export class KPIEngine {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly financial: FinancialSnapshotPort,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private distinctPlayers(type: EventType, from: number, to: number, tenantId?: string): Set<string> {
    const out = new Set<string>();
    for (const e of this.analytics.query({ type, tenantId, from, to })) if (e.playerId) out.add(e.playerId);
    return out;
  }
  private activePlayers(from: number, to: number, tenantId?: string): Set<string> {
    const out = new Set<string>();
    for (const e of this.analytics.query({ tenantId, from, to })) {
      if ((e.type === EventType.Login || e.type === EventType.Bet || e.type === EventType.SessionStart) && e.playerId) out.add(e.playerId);
    }
    return out;
  }

  /** Deposit total across the window (logical revenue proxy). */
  private depositTotal(from: number, to: number, tenantId?: string): number {
    return this.analytics.query({ type: EventType.Deposit, tenantId, from, to }).reduce((s, e) => s + (e.amount ?? 0), 0);
  }

  compute(opts: { tenantId?: string; now?: number } = {}): ExecutiveKPIs {
    const now = opts.now ?? this.clock();
    const tenantId = opts.tenantId;
    const dayAgo = now - DAY_MS;
    const monthAgo = now - 30 * DAY_MS;
    const prevMonthStart = now - 60 * DAY_MS;

    const dau = this.activePlayers(dayAgo, now, tenantId).size;
    const mau = this.activePlayers(monthAgo, now, tenantId).size;

    const newPlayers = this.distinctPlayers(EventType.Registration, monthAgo, now, tenantId).size;
    const prevNewPlayers = this.distinctPlayers(EventType.Registration, prevMonthStart, monthAgo, tenantId).size;

    // Retention: of last-month's registrants, how many were active this window.
    const cohort = this.distinctPlayers(EventType.Registration, prevMonthStart, monthAgo, tenantId);
    const activeNow = this.activePlayers(monthAgo, now, tenantId);
    let retained = 0;
    for (const p of cohort) if (activeNow.has(p)) retained += 1;
    const retentionRate = cohort.size ? retained / cohort.size : 0;
    const churnRate = cohort.size ? 1 - retentionRate : 0;

    // Money figures (logical): revenue ≈ deposits; NGR = revenue net of settled payouts.
    const revenue = this.depositTotal(monthAgo, now, tenantId);
    const settlement = this.financial.settlement();
    const ngr = Math.max(0, revenue - settlement.amount);

    // Payers = distinct depositors; conversion = payers / active.
    const payers = this.distinctPlayers(EventType.Deposit, monthAgo, now, tenantId);
    const arpu = mau ? Math.floor(revenue / mau) : 0;
    const arppu = payers.size ? Math.floor(revenue / payers.size) : 0;
    const ltv = arppu; // simplified lifetime proxy (per-payer revenue)
    const conversionRate = mau ? payers.size / mau : 0;
    const growthRate = prevNewPlayers ? (newPlayers - prevNewPlayers) / prevNewPlayers : newPlayers > 0 ? 1 : 0;

    return {
      revenue,
      ngr,
      dau,
      mau,
      newPlayers,
      retentionRate,
      churnRate,
      ltv,
      arpu,
      arppu,
      conversionRate,
      growthRate,
      generatedAt: now,
    };
  }
}
