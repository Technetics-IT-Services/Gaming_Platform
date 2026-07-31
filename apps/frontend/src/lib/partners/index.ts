/**
 * Partner, Affiliate & Multi-Tenant platform (Phase 6C) — public surface.
 *
 * An enterprise growth/distribution layer that manages business relationships,
 * commissions, white-label brands and partner reporting. It CONSUMES existing
 * services read-only and **owns no gameplay and no money** — commission is LOGICAL
 * accounting only, never a ledger posting. Zero changes to any frozen system.
 */
export * from './types';
export { secureId, maskContact } from './util';
export {
  PartnerRBAC,
  PartnerRole,
  PartnerPermission,
  PartnerPermissionGroups,
  PartnerAccessDeniedError,
  PartnerAudit,
  type PartnerAuthContext,
  type PartnerAuditQuery,
} from './security';
export { type PlayerFinancialPort, operationsFinancialPort } from './ports';
export { PartnerService } from './partner-service';
export { AffiliateService } from './affiliate-service';
export { AgentHierarchy, HierarchyError, type HierarchyNode } from './hierarchy';
export { CommissionEngine } from './commission-engine';
export { WhiteLabelPlatform } from './white-label';
export { PartnerReporting, type ReportingDeps } from './reporting';
export { PartnerDashboard, type PartnerDashboardDeps } from './dashboard';
export { PartnerPlatform, type PartnerPlatformDeps } from './partner-platform';
