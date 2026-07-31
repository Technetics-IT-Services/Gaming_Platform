/**
 * Partner RBAC & security (Phase 6C, STEP 7 & 9).
 *
 * A dedicated partner-facing RBAC with roles, scoped permissions, permission groups
 * and **tenant isolation** — a partner principal can only act within its own tenant
 * (and, for hierarchy reads, its own subtree). Deny-by-default. Every action is
 * audited (allow AND deny). Never moves money.
 */
import { type PartnerAuditRecord } from './types';

export enum PartnerRole {
  PartnerOwner = 'partner_owner',
  PartnerAdmin = 'partner_admin',
  Affiliate = 'affiliate',
  Agent = 'agent',
  ReadOnly = 'read_only',
}

export enum PartnerPermission {
  PartnerView = 'partner.view',
  PartnerManage = 'partner.manage',
  AffiliateView = 'affiliate.view',
  AffiliateManage = 'affiliate.manage',
  HierarchyView = 'hierarchy.view',
  HierarchyManage = 'hierarchy.manage',
  CommissionView = 'commission.view',
  CommissionManage = 'commission.manage',
  CommissionAdjust = 'commission.adjust',
  TenantView = 'tenant.view',
  TenantManage = 'tenant.manage',
  ReportingView = 'reporting.view',
  DashboardView = 'dashboard.view',
}

export const PartnerPermissionGroups = {
  View: [PartnerPermission.PartnerView, PartnerPermission.AffiliateView, PartnerPermission.HierarchyView, PartnerPermission.CommissionView, PartnerPermission.TenantView, PartnerPermission.ReportingView, PartnerPermission.DashboardView],
  Affiliate: [PartnerPermission.AffiliateView, PartnerPermission.AffiliateManage, PartnerPermission.CommissionView, PartnerPermission.ReportingView, PartnerPermission.DashboardView],
} as const satisfies Record<string, PartnerPermission[]>;

const P = PartnerPermission;
const G = PartnerPermissionGroups;

const DEFAULT_ROLES: Record<PartnerRole, PartnerPermission[]> = {
  [PartnerRole.ReadOnly]: [...G.View],
  [PartnerRole.Affiliate]: [...G.Affiliate],
  [PartnerRole.Agent]: [...G.View, P.HierarchyManage, P.AffiliateManage],
  [PartnerRole.PartnerAdmin]: [...G.View, P.PartnerManage, P.AffiliateManage, P.HierarchyManage, P.CommissionManage, P.TenantManage],
  [PartnerRole.PartnerOwner]: Object.values(PartnerPermission),
};

/** Caller identity — scoped to a tenant + partner (the isolation boundary). */
export interface PartnerAuthContext {
  actor: string;
  roles: PartnerRole[];
  tenantId: string;
  partnerId: string;
  correlationId?: string;
}

export class PartnerAccessDeniedError extends Error {
  constructor(
    readonly actor: string,
    readonly reason: string,
  ) {
    super(`Partner access denied: ${actor} — ${reason}`);
    this.name = 'PartnerAccessDeniedError';
  }
}

export class PartnerRBAC {
  private readonly roles: Record<PartnerRole, PartnerPermission[]>;
  constructor(overrides: Partial<Record<PartnerRole, PartnerPermission[]>> = {}) {
    this.roles = { ...DEFAULT_ROLES, ...overrides };
  }
  can(roles: PartnerRole[], permission: PartnerPermission): boolean {
    return roles.some((r) => this.roles[r]?.includes(permission) ?? false);
  }
  assert(auth: PartnerAuthContext, permission: PartnerPermission): void {
    if (!this.can(auth.roles, permission)) throw new PartnerAccessDeniedError(auth.actor, `lacks ${permission}`);
  }
  /** Tenant isolation: the caller may only touch resources in its own tenant. */
  assertTenant(auth: PartnerAuthContext, tenantId: string): void {
    if (auth.tenantId !== tenantId) throw new PartnerAccessDeniedError(auth.actor, `tenant isolation: ${auth.tenantId} ≠ ${tenantId}`);
  }
}

export interface PartnerAuditQuery {
  actor?: string;
  action?: string;
  target?: string;
  tenantId?: string;
  limit?: number;
}

export class PartnerAudit {
  private readonly records: PartnerAuditRecord[] = [];
  record(rec: PartnerAuditRecord): void {
    this.records.push(rec);
  }
  all(): readonly PartnerAuditRecord[] {
    return this.records;
  }
  query(q: PartnerAuditQuery = {}): PartnerAuditRecord[] {
    let out = this.records.filter((r) => {
      if (q.actor && r.actor !== q.actor) return false;
      if (q.action && r.action !== q.action) return false;
      if (q.target && r.target !== q.target) return false;
      if (q.tenantId && r.tenantId !== q.tenantId) return false;
      return true;
    });
    out = out.sort((a, b) => b.at - a.at);
    return q.limit ? out.slice(0, q.limit) : out;
  }
  count(): number {
    return this.records.length;
  }
}
