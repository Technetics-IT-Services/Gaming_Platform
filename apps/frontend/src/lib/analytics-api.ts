import { apiClient, unwrap } from './api-client';

/**
 * Operator analytics API client (Phase 2D.6).
 *
 * Every figure here is server-derived from authoritative tables. Nothing is computed, estimated or
 * defaulted on the client. Metrics the platform cannot truthfully produce arrive in
 * `meta.unavailable` with a reason, so the UI renders "Not available" instead of a fabricated zero.
 *
 * Financial totals are ALWAYS per-currency — there is no FX source, so currencies are never combined.
 */

export interface CurrencyBucket {
  currency: string;
  /** Decimal string. Never a float, never converted between currencies. */
  total: string;
  count: number;
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
  unavailable: UnavailableMetric[];
}

export interface GamingSummary {
  roundsTotal: number;
  roundsByStatus: Record<string, number>;
  settledRounds: number;
  stakeByCurrency: CurrencyBucket[];
  payoutByCurrency: CurrencyBucket[];
  averageStakeByCurrency: CurrencyBucket[];
  averagePayoutByCurrency: CurrencyBucket[];
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
  playedInRange: number;
  depositedInRange: number;
  withdrewInRange: number;
  loggedInInRange: number;
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

export interface AnalyticsSummary {
  meta: AnalyticsMeta;
  gaming: GamingSummary;
  financial: FinancialSummary;
  users: UsersSummary;
  operations: OperationsSummary;
}

export interface DailySeries {
  rounds: { date: string; currency: string; rounds: number; stake: string; payout: string }[];
  cashier: {
    date: string; currency: string;
    deposits: number; depositTotal: string;
    withdrawals: number; withdrawalTotal: string;
  }[];
}

export interface AnalyticsFilters {
  from?: string;
  to?: string;
  currency?: string;
  gameKey?: string;
}

function qs(params: AnalyticsFilters): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, String(v)));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * Engagement (Phase 2D.9, X-02).
 *
 * DAU/MAU come from the activity-event pipeline. The pipeline has NO BACKFILL, so the payload also
 * states from which moment the data is genuinely complete — a figure covering a window that starts
 * before `dataAvailableFrom` describes absent instrumentation, not absent players, and the UI must
 * say so rather than drawing a flat line.
 */
export interface EngagementSummary {
  definitions: { dau: string; mau: string };
  dataAvailableFrom: string | null;
  windowFullyCovered: boolean;
  eventsInWindow: number;
  /** null (never 0) while the pipeline has recorded nothing at all. */
  activeUsersInWindow: number | null;
  mauRolling30: number | null;
  dailyActiveUsers: { date: string; activeUsers: number }[];
  eventsByType: Record<string, number>;
  unavailable: UnavailableMetric[];
}

export const analyticsApi = {
  summary: (f: AnalyticsFilters = {}) => unwrap<AnalyticsSummary>(apiClient.get(`/analytics/summary${qs(f)}`)),
  daily: (f: AnalyticsFilters = {}) => unwrap<DailySeries>(apiClient.get(`/analytics/daily${qs(f)}`)),
  engagement: (f: AnalyticsFilters = {}) => unwrap<EngagementSummary>(apiClient.get(`/analytics/engagement${qs(f)}`)),
  unavailable: () => unwrap<{ unavailable: UnavailableMetric[] }>(apiClient.get('/analytics/unavailable')),
};
