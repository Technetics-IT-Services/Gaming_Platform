/**
 * Analytics security (Phase 6D, STEP 9).
 *
 * A dedicated analytics RBAC with tenant-aware scoping, PII masking, secure export
 * gating and an audit trail. Deny-by-default; `AnalyticsRBAC.assert` is the
 * enforcement primitive. Read-only platform — nothing here moves money or mutates a
 * frozen service.
 */

export enum AnalyticsRole {
  Executive = 'executive',
  Analyst = 'analyst',
  FinanceAnalyst = 'finance_analyst',
  ComplianceAnalyst = 'compliance_analyst',
  SRE = 'sre',
  ReadOnly = 'read_only',
}

export enum AnalyticsPermission {
  KpiView = 'analytics.kpi.view',
  FinancialView = 'analytics.financial.view',
  PlayerView = 'analytics.player.view',
  FraudView = 'analytics.fraud.view',
  ObservabilityView = 'analytics.observability.view',
  MonitoringView = 'analytics.monitoring.view',
  AlertManage = 'analytics.alert.manage',
  Export = 'analytics.export',
  WarehouseView = 'analytics.warehouse.view',
}

const P = AnalyticsPermission;
const VIEW = [P.KpiView, P.FinancialView, P.PlayerView, P.FraudView, P.ObservabilityView, P.MonitoringView, P.WarehouseView];

const DEFAULT_ROLES: Record<AnalyticsRole, AnalyticsPermission[]> = {
  [AnalyticsRole.ReadOnly]: [P.KpiView, P.PlayerView, P.MonitoringView],
  [AnalyticsRole.Analyst]: [P.KpiView, P.PlayerView, P.WarehouseView, P.Export],
  [AnalyticsRole.FinanceAnalyst]: [P.KpiView, P.FinancialView, P.WarehouseView, P.Export],
  [AnalyticsRole.ComplianceAnalyst]: [P.KpiView, P.FraudView, P.WarehouseView, P.Export],
  [AnalyticsRole.SRE]: [P.ObservabilityView, P.MonitoringView, P.AlertManage, P.KpiView],
  [AnalyticsRole.Executive]: [...VIEW, P.Export, P.AlertManage],
};

/** Caller identity. `tenantId === undefined` ⇒ a global (cross-tenant) principal. */
export interface AnalyticsAuthContext {
  actor: string;
  roles: AnalyticsRole[];
  /** When set, the principal may only see this tenant's data (tenant-aware analytics). */
  tenantId?: string;
  correlationId?: string;
}

export class AnalyticsAccessDeniedError extends Error {
  constructor(
    readonly actor: string,
    readonly reason: string,
  ) {
    super(`Analytics access denied: ${actor} — ${reason}`);
    this.name = 'AnalyticsAccessDeniedError';
  }
}

export class AnalyticsRBAC {
  private readonly roles: Record<AnalyticsRole, AnalyticsPermission[]>;
  constructor(overrides: Partial<Record<AnalyticsRole, AnalyticsPermission[]>> = {}) {
    this.roles = { ...DEFAULT_ROLES, ...overrides };
  }
  can(roles: AnalyticsRole[], permission: AnalyticsPermission): boolean {
    return roles.some((r) => this.roles[r]?.includes(permission) ?? false);
  }
  assert(auth: AnalyticsAuthContext, permission: AnalyticsPermission): void {
    if (!this.can(auth.roles, permission)) throw new AnalyticsAccessDeniedError(auth.actor, `lacks ${permission}`);
  }
}

export interface AnalyticsAuditRecord {
  at: number;
  actor: string;
  action: string;
  tenantId?: string;
  allowed: boolean;
  detail?: string;
}

export class AnalyticsAudit {
  private readonly records: AnalyticsAuditRecord[] = [];
  record(rec: AnalyticsAuditRecord): void {
    this.records.push(rec);
  }
  all(): readonly AnalyticsAuditRecord[] {
    return this.records;
  }
  count(): number {
    return this.records.length;
  }
}

/** Mask a player id for exports/dashboards (keep a short prefix for correlation). */
export function maskPlayerId(playerId: string): string {
  if (playerId.length <= 4) return '*'.repeat(playerId.length);
  return `${playerId.slice(0, 4)}${'*'.repeat(playerId.length - 4)}`;
}
