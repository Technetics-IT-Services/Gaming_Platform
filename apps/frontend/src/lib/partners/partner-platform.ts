/**
 * Partner platform (Phase 6C, STEP 1 & 9) — the RBAC + tenant-isolation facade.
 *
 * The single entry point for partner/affiliate/agent principals. Every call carries a
 * `PartnerAuthContext`, is permission-checked and **tenant-isolated** before any work,
 * and is audited (allow AND deny). It composes the sub-services and consumes existing
 * platform data through the read-only `PlayerFinancialPort`. Commission is LOGICAL
 * only — this platform never moves money.
 */
import { AffiliateService } from './affiliate-service';
import { CommissionEngine } from './commission-engine';
import { PartnerDashboard } from './dashboard';
import { AgentHierarchy } from './hierarchy';
import { PartnerService } from './partner-service';
import { type PlayerFinancialPort } from './ports';
import { PartnerReporting } from './reporting';
import { PartnerAccessDeniedError, PartnerAudit, type PartnerAuthContext, PartnerPermission, PartnerRBAC } from './security';
import {
  type AttributionModel,
  type CommissionContext,
  type CommissionEntry,
  type CommissionPlan,
  type Conversion,
  type PartnerDashboardView,
  type PartnerLifecycle,
  type PartnerProfile,
  type PartnerStatus,
  type PartnerType,
  type Report,
} from './types';
import { WhiteLabelPlatform } from './white-label';

export interface PartnerPlatformDeps {
  financials: PlayerFinancialPort;
  rbac?: PartnerRBAC;
  clock?: () => number;
  maxHierarchyDepth?: number;
}

export class PartnerPlatform {
  readonly rbac: PartnerRBAC;
  readonly audit = new PartnerAudit();
  readonly partners: PartnerService;
  readonly affiliates: AffiliateService;
  readonly hierarchy: AgentHierarchy;
  readonly commissions: CommissionEngine;
  readonly whiteLabel: WhiteLabelPlatform;
  readonly reporting: PartnerReporting;
  readonly dashboard: PartnerDashboard;

  private readonly clock: () => number;

  constructor(deps: PartnerPlatformDeps) {
    this.clock = deps.clock ?? (() => Date.now());
    this.rbac = deps.rbac ?? new PartnerRBAC();
    this.partners = new PartnerService(this.clock);
    this.affiliates = new AffiliateService(undefined, this.clock);
    this.hierarchy = new AgentHierarchy(deps.maxHierarchyDepth ?? 5);
    this.commissions = new CommissionEngine(this.clock);
    this.whiteLabel = new WhiteLabelPlatform(this.clock);
    this.reporting = new PartnerReporting({ affiliates: this.affiliates, commissions: this.commissions, hierarchy: this.hierarchy, financials: deps.financials, clock: this.clock });
    this.dashboard = new PartnerDashboard({ partners: this.partners, hierarchy: this.hierarchy, reporting: this.reporting, clock: this.clock });
  }

  /* ------------------------------ enforcement ----------------------------- */

  private enforce<T>(auth: PartnerAuthContext, permission: PartnerPermission, action: string, target: string | undefined, fn: () => T, opts?: { tenantId?: string; detail?: string }): T {
    try {
      this.rbac.assert(auth, permission);
      if (opts?.tenantId !== undefined) this.rbac.assertTenant(auth, opts.tenantId);
    } catch (e) {
      if (e instanceof PartnerAccessDeniedError) this.audit.record({ at: this.clock(), actor: auth.actor, action, target, tenantId: auth.tenantId, allowed: false, detail: e.reason });
      throw e;
    }
    const result = fn();
    this.audit.record({ at: this.clock(), actor: auth.actor, action, target, tenantId: auth.tenantId, allowed: true, detail: opts?.detail });
    return result;
  }

  /** Guard a partner-scoped read: the resource must belong to the caller's tenant. */
  private tenantOf(partnerId: string): string {
    return this.partners.get(partnerId).tenantId;
  }

  /* ------------------------------- partners ------------------------------- */

  createPartner(auth: PartnerAuthContext, input: { type: PartnerType; name: string; email?: string; parentId?: string }): PartnerProfile {
    return this.enforce(auth, PartnerPermission.PartnerManage, 'partner.create', undefined, () => {
      const partner = this.partners.create({ ...input, tenantId: auth.tenantId });
      this.hierarchy.addPartner(partner.id, partner.type);
      if (input.parentId) this.hierarchy.link(partner.id, input.parentId);
      return partner;
    }, { tenantId: auth.tenantId, detail: input.name });
  }
  getPartner(auth: PartnerAuthContext, partnerId: string): PartnerProfile {
    return this.enforce(auth, PartnerPermission.PartnerView, 'partner.view', partnerId, () => this.partners.get(partnerId), { tenantId: this.tenantOf(partnerId) });
  }
  setPartnerStatus(auth: PartnerAuthContext, partnerId: string, status: PartnerStatus): PartnerProfile {
    return this.enforce(auth, PartnerPermission.PartnerManage, 'partner.status', partnerId, () => this.partners.setStatus(partnerId, status), { tenantId: this.tenantOf(partnerId), detail: status });
  }
  setPartnerLifecycle(auth: PartnerAuthContext, partnerId: string, lifecycle: PartnerLifecycle): PartnerProfile {
    return this.enforce(auth, PartnerPermission.PartnerManage, 'partner.lifecycle', partnerId, () => this.partners.setLifecycle(partnerId, lifecycle), { tenantId: this.tenantOf(partnerId) });
  }
  addPartnerNote(auth: PartnerAuthContext, partnerId: string, body: string) {
    return this.enforce(auth, PartnerPermission.PartnerManage, 'partner.note', partnerId, () => this.partners.addNote(partnerId, body, auth.actor), { tenantId: this.tenantOf(partnerId) });
  }

  /* ------------------------------ affiliates ------------------------------ */

  registerAffiliate(auth: PartnerAuthContext, partnerId: string, attribution?: AttributionModel) {
    return this.enforce(auth, PartnerPermission.AffiliateManage, 'affiliate.register', partnerId, () => this.affiliates.register(partnerId, attribution), { tenantId: this.tenantOf(partnerId) });
  }
  createTrackingCode(auth: PartnerAuthContext, partnerId: string, opts?: { code?: string; campaign?: string }) {
    return this.enforce(auth, PartnerPermission.AffiliateManage, 'affiliate.code', partnerId, () => this.affiliates.createCode(partnerId, opts), { tenantId: this.tenantOf(partnerId) });
  }
  getAffiliateLink(auth: PartnerAuthContext, code: string) {
    this.rbac.assert(auth, PartnerPermission.AffiliateView);
    return this.affiliates.link(code);
  }
  recordConversion(auth: PartnerAuthContext, code: string): Conversion {
    this.rbac.assert(auth, PartnerPermission.AffiliateManage);
    return this.affiliates.click(code);
  }
  attributePlayer(auth: PartnerAuthContext, conversionId: string, playerId: string): Conversion {
    this.rbac.assert(auth, PartnerPermission.AffiliateManage);
    return this.affiliates.attribute(conversionId, playerId);
  }

  /* ------------------------------- hierarchy ------------------------------ */

  linkPartner(auth: PartnerAuthContext, childId: string, parentId: string): void {
    this.enforce(auth, PartnerPermission.HierarchyManage, 'hierarchy.link', childId, () => this.hierarchy.link(childId, parentId), { tenantId: this.tenantOf(childId), detail: `→ ${parentId}` });
  }
  getTree(auth: PartnerAuthContext, partnerId: string) {
    return this.enforce(auth, PartnerPermission.HierarchyView, 'hierarchy.tree', partnerId, () => this.hierarchy.tree(partnerId), { tenantId: this.tenantOf(partnerId) });
  }

  /* ------------------------------ commission ------------------------------ */

  createPlan(auth: PartnerAuthContext, plan: CommissionPlan): CommissionPlan {
    return this.enforce(auth, PartnerPermission.CommissionManage, 'commission.plan', plan.id, () => this.commissions.createPlan(plan));
  }
  accrueCommission(auth: PartnerAuthContext, partnerId: string, planId: string, ctx: CommissionContext): CommissionEntry {
    return this.enforce(auth, PartnerPermission.CommissionManage, 'commission.accrue', partnerId, () => this.commissions.accrue(partnerId, planId, ctx), { tenantId: this.tenantOf(partnerId) });
  }
  approveCommission(auth: PartnerAuthContext, entryId: string): CommissionEntry {
    return this.enforce(auth, PartnerPermission.CommissionManage, 'commission.approve', entryId, () => this.commissions.approve(entryId, auth.actor));
  }
  adjustCommission(auth: PartnerAuthContext, partnerId: string, amount: number, reason: string): CommissionEntry {
    return this.enforce(auth, PartnerPermission.CommissionAdjust, 'commission.adjust', partnerId, () => this.commissions.adjust(partnerId, amount, auth.actor, reason), { tenantId: this.tenantOf(partnerId), detail: `${amount}` });
  }
  commissionHistory(auth: PartnerAuthContext, partnerId: string): CommissionEntry[] {
    return this.enforce(auth, PartnerPermission.CommissionView, 'commission.history', partnerId, () => this.commissions.history(partnerId), { tenantId: this.tenantOf(partnerId) });
  }

  /* ------------------------------ white-label ----------------------------- */

  createTenant(auth: PartnerAuthContext, input: Parameters<WhiteLabelPlatform['createTenant']>[0]) {
    return this.enforce(auth, PartnerPermission.TenantManage, 'tenant.create', input.partnerId, () => this.whiteLabel.createTenant(input), { detail: input.brandName });
  }
  mapDomain(auth: PartnerAuthContext, tenantId: string, host: string): void {
    this.enforce(auth, PartnerPermission.TenantManage, 'tenant.domain', tenantId, () => this.whiteLabel.mapDomain(tenantId, host), { detail: host });
  }
  setFeatureFlag(auth: PartnerAuthContext, tenantId: string, flag: string, enabled: boolean) {
    return this.enforce(auth, PartnerPermission.TenantManage, 'tenant.flag', tenantId, () => this.whiteLabel.setFeatureFlag(tenantId, flag, enabled));
  }
  resolveTenant(host: string) {
    return this.whiteLabel.resolveByHost(host); // public host resolution (unauthenticated entry)
  }

  /* ------------------------- reporting & dashboard ------------------------ */

  acquisitionReport(auth: PartnerAuthContext, partnerId: string) {
    return this.enforce(auth, PartnerPermission.ReportingView, 'report.acquisition', partnerId, () => this.reporting.acquisition(partnerId), { tenantId: this.tenantOf(partnerId) });
  }
  revenueReport(auth: PartnerAuthContext, partnerId: string) {
    return this.enforce(auth, PartnerPermission.ReportingView, 'report.revenue', partnerId, () => this.reporting.revenue(partnerId), { tenantId: this.tenantOf(partnerId) });
  }
  commissionSummary(auth: PartnerAuthContext, partnerId: string) {
    return this.enforce(auth, PartnerPermission.CommissionView, 'report.commission', partnerId, () => this.reporting.commission(partnerId), { tenantId: this.tenantOf(partnerId) });
  }
  exportCommission(auth: PartnerAuthContext, partnerId: string): Report {
    return this.enforce(auth, PartnerPermission.ReportingView, 'export.commission', partnerId, () => this.reporting.exportCommission(partnerId), { tenantId: this.tenantOf(partnerId) });
  }
  getDashboard(auth: PartnerAuthContext, partnerId: string): PartnerDashboardView {
    return this.enforce(auth, PartnerPermission.DashboardView, 'dashboard.view', partnerId, () => this.dashboard.overview(partnerId), { tenantId: this.tenantOf(partnerId) });
  }
}
