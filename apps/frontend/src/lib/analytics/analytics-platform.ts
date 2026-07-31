/**
 * Analytics platform (Phase 6D, STEP 1 & 9/10) — the RBAC-enforced facade.
 *
 * The single, read-only entry point for the intelligence layer. Every query carries
 * an `AnalyticsAuthContext`, is permission + tenant checked before running, and is
 * audited. It composes the analytics/BI/observability/monitoring/warehouse services
 * and consumes the frozen platform through read-only ports. It changes no business
 * logic and moves no money.
 */
import { AnalyticsService } from './analytics-service';
import { FinancialBI } from './financial-bi';
import { FraudComplianceAnalyticsService } from './fraud-analytics';
import { KPIEngine } from './kpi-engine';
import { MonitoringService } from './monitoring';
import { Observability } from './observability';
import { PlayerAnalytics } from './player-analytics';
import { type ComplianceAnalyticsPort, type FinancialSnapshotPort, type HealthPort } from './ports';
import {
  AnalyticsAccessDeniedError,
  AnalyticsAudit,
  type AnalyticsAuthContext,
  AnalyticsPermission,
  AnalyticsRBAC,
} from './security';
import {
  type AnalyticsEvent,
  type ExecutiveKPIs,
  type FinancialBIReport,
  type FraudComplianceAnalytics,
  type Report,
} from './types';
import { WarehouseService } from './warehouse';

export interface AnalyticsPlatformDeps {
  financial: FinancialSnapshotPort;
  compliance: ComplianceAnalyticsPort;
  health: HealthPort;
  rbac?: AnalyticsRBAC;
  clock?: () => number;
}

export class AnalyticsPlatform {
  readonly rbac: AnalyticsRBAC;
  readonly audit = new AnalyticsAudit();
  readonly analytics: AnalyticsService;
  readonly kpis: KPIEngine;
  readonly financialBI: FinancialBI;
  readonly players: PlayerAnalytics;
  readonly fraud: FraudComplianceAnalyticsService;
  readonly observability: Observability;
  readonly monitoring: MonitoringService;
  readonly warehouse: WarehouseService;

  private readonly clock: () => number;

  constructor(deps: AnalyticsPlatformDeps) {
    this.clock = deps.clock ?? (() => Date.now());
    this.rbac = deps.rbac ?? new AnalyticsRBAC();
    this.analytics = new AnalyticsService(this.clock);
    this.kpis = new KPIEngine(this.analytics, deps.financial, this.clock);
    this.financialBI = new FinancialBI(this.analytics, deps.financial, this.clock);
    this.players = new PlayerAnalytics(this.analytics);
    this.fraud = new FraudComplianceAnalyticsService(deps.compliance, this.clock);
    this.observability = new Observability(this.clock);
    this.monitoring = new MonitoringService(deps.health, this.observability, this.analytics.metrics, this.clock);
    this.warehouse = new WarehouseService(this.kpis, this.financialBI, this.clock);
  }

  /** Ingest an event (unauthenticated hot path — the app emits facts). */
  track(event: AnalyticsEvent): void {
    this.analytics.track(event);
  }

  /* ------------------------------ enforcement ----------------------------- */

  private enforce<T>(auth: AnalyticsAuthContext, permission: AnalyticsPermission, action: string, fn: () => T): T {
    try {
      this.rbac.assert(auth, permission);
    } catch (e) {
      if (e instanceof AnalyticsAccessDeniedError) this.audit.record({ at: this.clock(), actor: auth.actor, action, tenantId: auth.tenantId, allowed: false, detail: e.reason });
      throw e;
    }
    const result = fn();
    this.audit.record({ at: this.clock(), actor: auth.actor, action, tenantId: auth.tenantId, allowed: true });
    return result;
  }

  /* --------------------------------- APIs --------------------------------- */

  executiveKPIs(auth: AnalyticsAuthContext): ExecutiveKPIs {
    return this.enforce(auth, AnalyticsPermission.KpiView, 'kpi.executive', () => this.kpis.compute({ tenantId: auth.tenantId }));
  }
  financialReport(auth: AnalyticsAuthContext, commission?: { total: number; balance: number }): FinancialBIReport {
    return this.enforce(auth, AnalyticsPermission.FinancialView, 'bi.financial', () => this.financialBI.report({ tenantId: auth.tenantId, commission }));
  }
  cashflowTrend(auth: AnalyticsAuthContext) {
    return this.enforce(auth, AnalyticsPermission.FinancialView, 'bi.cashflow', () => this.financialBI.cashflowTrend(auth.tenantId));
  }
  gamePopularity(auth: AnalyticsAuthContext) {
    return this.enforce(auth, AnalyticsPermission.PlayerView, 'player.games', () => this.players.gamePopularity(auth.tenantId));
  }
  sessionAnalytics(auth: AnalyticsAuthContext) {
    return this.enforce(auth, AnalyticsPermission.PlayerView, 'player.sessions', () => this.players.sessions(auth.tenantId));
  }
  fraudAnalytics(auth: AnalyticsAuthContext): FraudComplianceAnalytics {
    return this.enforce(auth, AnalyticsPermission.FraudView, 'fraud.analytics', () => this.fraud.analytics());
  }
  healthDashboard(auth: AnalyticsAuthContext) {
    return this.enforce(auth, AnalyticsPermission.MonitoringView, 'monitoring.dashboard', () => this.monitoring.dashboard());
  }
  trace(auth: AnalyticsAuthContext, traceId: string) {
    return this.enforce(auth, AnalyticsPermission.ObservabilityView, 'observability.trace', () => this.observability.trace(traceId));
  }
  createAlertRule(auth: AnalyticsAuthContext, rule: Parameters<MonitoringService['addRule']>[0]) {
    return this.enforce(auth, AnalyticsPermission.AlertManage, 'alert.rule', () => this.monitoring.addRule(rule));
  }
  snapshot(auth: AnalyticsAuthContext) {
    return this.enforce(auth, AnalyticsPermission.WarehouseView, 'warehouse.snapshot', () => this.warehouse.snapshot({ tenantId: auth.tenantId }));
  }
  exportFinancial(auth: AnalyticsAuthContext): Report {
    return this.enforce(auth, AnalyticsPermission.Export, 'export.financial', () => this.financialBI.export({ tenantId: auth.tenantId }));
  }
  exportWarehouse(auth: AnalyticsAuthContext): Report {
    return this.enforce(auth, AnalyticsPermission.Export, 'export.warehouse', () => this.warehouse.export());
  }
}
