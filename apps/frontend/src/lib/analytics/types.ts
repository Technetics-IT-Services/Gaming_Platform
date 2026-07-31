/**
 * Analytics, BI & Observability platform contracts (Phase 6D).
 *
 * The enterprise intelligence layer: `Platform Services → Analytics → BI →
 * Observability → Dashboards`. It **measures, aggregates and visualizes** existing
 * platform activity. It is strictly **read-only** — it owns no gameplay, no money,
 * and changes no business logic. Framework-agnostic. Integer minor/logical units.
 */

/* ------------------------------- events ----------------------------------- */

export enum EventType {
  Registration = 'registration',
  Login = 'login',
  SessionStart = 'session_start',
  SessionEnd = 'session_end',
  Bet = 'bet',
  Win = 'win',
  Deposit = 'deposit',
  Withdrawal = 'withdrawal',
  DepositFailed = 'deposit_failed',
  GameRound = 'game_round',
  Conversion = 'conversion',
}

/** A single analytics fact. Emitted by the app; the platform only reads/aggregates. */
export interface AnalyticsEvent {
  type: EventType;
  at: number;
  playerId?: string;
  tenantId?: string;
  gameId?: string;
  /** Integer minor units where monetary. */
  amount?: number;
  sessionId?: string;
  correlationId?: string;
  dimensions?: Record<string, string>;
}

/* ------------------------------- metrics ---------------------------------- */

export enum MetricKind {
  Counter = 'counter',
  Gauge = 'gauge',
  Histogram = 'histogram',
}
export interface MetricDefinition {
  name: string;
  kind: MetricKind;
  description: string;
  unit?: string;
  /** Allowed dimension keys for this metric. */
  dimensions?: string[];
}
export interface TimeSeriesPoint {
  at: number;
  value: number;
}
export enum Granularity {
  Hour = 'hour',
  Day = 'day',
}
export enum AggregateOp {
  Sum = 'sum',
  Count = 'count',
  Avg = 'avg',
  Min = 'min',
  Max = 'max',
  DistinctCount = 'distinct_count',
}

/* --------------------------- executive KPIs ------------------------------- */

export interface ExecutiveKPIs {
  revenue: number;
  ngr: number;
  dau: number;
  mau: number;
  newPlayers: number;
  retentionRate: number;
  churnRate: number;
  ltv: number;
  arpu: number;
  arppu: number;
  conversionRate: number;
  growthRate: number;
  generatedAt: number;
}

/* ------------------------------ financial BI ------------------------------ */

export interface FinancialBIReport {
  deposits: { count: number; total: number };
  withdrawals: { count: number; total: number };
  paymentSuccessRate: number;
  treasury: { reservedTotal: number; pending: number; settlement: number; external: number; balanced: boolean };
  commission: { total: number; balance: number };
  netCashflow: number;
  generatedAt: number;
}

/* ----------------------------- player analytics --------------------------- */

export interface SessionAnalytics {
  sessions: number;
  uniquePlayers: number;
  avgSessionMs: number;
}
export interface GamePopularity {
  gameId: string;
  rounds: number;
  players: number;
  wagered: number;
}
export interface CohortRetention {
  cohort: string;
  size: number;
  retainedByDay: number[];
}
export interface FunnelResult {
  steps: { name: string; count: number }[];
  overallConversion: number;
}

/* ------------------------ fraud & compliance analytics -------------------- */

export interface FraudComplianceAnalytics {
  totalDecisions: number;
  byAction: Record<string, number>;
  riskDistribution: { low: number; medium: number; high: number; critical: number };
  topReasons: { code: string; count: number }[];
  manualReviewQueue: number;
  generatedAt: number;
}

/* ------------------------------ observability ----------------------------- */

export interface Span {
  id: string;
  traceId: string;
  parentId?: string;
  service: string;
  operation: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: 'ok' | 'error';
  attributes?: Record<string, string>;
}
export enum LogLevel {
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}
export interface LogEntry {
  at: number;
  level: LogLevel;
  service: string;
  message: string;
  correlationId?: string;
  attributes?: Record<string, string>;
}
export interface DependencyEdge {
  from: string;
  to: string;
  calls: number;
  errors: number;
}
export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/* ------------------------- monitoring & alerting -------------------------- */

export enum AlertSeverity {
  Info = 'info',
  Warning = 'warning',
  Critical = 'critical',
}
export enum AlertComparator {
  GreaterThan = 'gt',
  LessThan = 'lt',
}
export interface AlertRule {
  id: string;
  metric: string;
  comparator: AlertComparator;
  threshold: number;
  severity: AlertSeverity;
  channels: string[];
  description: string;
  enabled: boolean;
}
export interface Alert {
  id: string;
  ruleId: string;
  metric: string;
  value: number;
  threshold: number;
  severity: AlertSeverity;
  firedAt: number;
  message: string;
}
export interface AlertChannel {
  id: string;
  kind: 'email' | 'slack' | 'webhook' | 'pagerduty';
  target: string;
}

/* ------------------------------ data platform ----------------------------- */

export interface Snapshot {
  id: string;
  at: number;
  kpis: ExecutiveKPIs;
  financial: FinancialBIReport;
}
export interface ReportSchedule {
  id: string;
  name: string;
  report: string;
  cron: string;
  enabled: boolean;
}
/** A typed ETL extract contract (warehouse-facing). */
export interface ETLContract {
  dataset: string;
  columns: { name: string; type: 'string' | 'number' | 'timestamp' }[];
  grain: Granularity;
}
export interface Report {
  name: string;
  columns: string[];
  rows: (string | number)[][];
  generatedAt: number;
}
