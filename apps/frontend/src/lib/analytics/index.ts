/**
 * Analytics, BI & Observability platform (Phase 6D) — public surface.
 *
 * The enterprise intelligence layer. It measures, aggregates and visualizes existing
 * platform activity and is strictly **read-only** — it owns no gameplay, no money,
 * and changes no business logic. Consumes the frozen services through read-only
 * ports. Zero changes to any frozen system.
 */
export * from './types';
export {
  AnalyticsRBAC,
  AnalyticsRole,
  AnalyticsPermission,
  AnalyticsAccessDeniedError,
  AnalyticsAudit,
  maskPlayerId,
  type AnalyticsAuthContext,
  type AnalyticsAuditRecord,
} from './security';
export {
  type FinancialSnapshotPort,
  type ComplianceAnalyticsPort,
  type HealthPort,
  treasuryFinancialPort,
  complianceAnalyticsPort,
  operationsHealthPort,
} from './ports';
export { MetricsRegistry, TimeSeriesStore, AggregationEngine, bucketOf } from './metrics';
export { AnalyticsService } from './analytics-service';
export { KPIEngine } from './kpi-engine';
export { FinancialBI } from './financial-bi';
export { PlayerAnalytics } from './player-analytics';
export { FraudComplianceAnalyticsService } from './fraud-analytics';
export { Observability } from './observability';
export { MonitoringService, type SystemHealthDashboard } from './monitoring';
export { WarehouseService } from './warehouse';
export { AnalyticsPlatform, type AnalyticsPlatformDeps } from './analytics-platform';
