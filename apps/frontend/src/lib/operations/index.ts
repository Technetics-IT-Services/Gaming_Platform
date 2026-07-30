/**
 * Operations & Administration platform (Phase 6A) — public surface.
 *
 * An enterprise back-office layer for internal staff. It CONSUMES the frozen
 * platform services (ledger/wallet, treasury/withdrawals, compliance) through
 * read-only ports and exposes RBAC-gated administration: player management, account
 * operations, support tools, a unified audit viewer, dashboards, reporting and
 * system health. It never modifies gameplay, money movement or any frozen service.
 */
export * from './types';
export { RBACService, AccessDeniedError } from './rbac';
export { OperationsAudit } from './operations-audit';
export { AccountService } from './account-service';
export { SupportService } from './support-service';
export { SearchService, type PlayerIndexEntry } from './search-service';
export { PlayerService, type PlayerServiceDeps } from './player-service';
export { AuditViewerService, type AuditViewerDeps } from './audit-viewer-service';
export { DashboardService, type DashboardServiceDeps } from './dashboard-service';
export { HealthService, type HealthServiceDeps } from './health-service';
export { ReportingService, type ReportingServiceDeps } from './reporting-service';
export { OperationsService, type OperationsServiceDeps } from './operations-service';
export { walletReadPort, withdrawalReadPort, complianceReadPort } from './adapters';
export type { WalletReadPort, WithdrawalReadPort, ComplianceReadPort, LedgerReadPort, HealthProbe } from './ports';
