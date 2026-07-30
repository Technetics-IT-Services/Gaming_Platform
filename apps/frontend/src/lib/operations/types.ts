/**
 * Operations & Administration platform contracts (Phase 6A).
 *
 * An enterprise back-office layer for internal staff. It **consumes** the frozen
 * platform services (ledger/wallet, treasury/withdrawals, compliance) through narrow
 * READ ports and exposes administrative capabilities — it never bypasses or mutates
 * those services, gameplay, or financial correctness. Framework-agnostic (no React).
 */

/* --------------------------------- RBAC ----------------------------------- */

export enum Role {
  SuperAdmin = 'super_admin',
  OperationsAdmin = 'operations_admin',
  FinanceAdmin = 'finance_admin',
  SupportAdmin = 'support_admin',
  ComplianceAdmin = 'compliance_admin',
  ReadOnlyAuditor = 'read_only_auditor',
  Support = 'support',
}

/** Granular feature permissions. Roles are composed from these (+ inheritance). */
export enum Permission {
  PlayerSearch = 'player.search',
  PlayerView = 'player.view',
  AccountSuspend = 'account.suspend',
  AccountUnsuspend = 'account.unsuspend',
  AccountLock = 'account.lock',
  AccountUnlock = 'account.unlock',
  AccountExclude = 'account.exclude',
  AccountNote = 'account.note',
  SupportNoteView = 'support.note.view',
  SupportNoteCreate = 'support.note.create',
  SupportCaseManage = 'support.case.manage',
  SupportTimelineView = 'support.timeline.view',
  AuditViewFinancial = 'audit.view.financial',
  AuditViewCompliance = 'audit.view.compliance',
  AuditViewOperations = 'audit.view.operations',
  DashboardView = 'dashboard.view',
  FinanceView = 'finance.view',
  RiskView = 'risk.view',
  ComplianceView = 'compliance.view',
  HealthView = 'health.view',
  ReportingPlayer = 'reporting.player',
  ReportingOperational = 'reporting.operational',
  ReportingFinance = 'reporting.finance',
  ReportingRisk = 'reporting.risk',
  ReportingCompliance = 'reporting.compliance',
  UserManage = 'user.manage',
}

/** Reusable permission bundles (STEP 2 — permission groups). */
export const PermissionGroups = {
  AuditView: [Permission.AuditViewFinancial, Permission.AuditViewCompliance, Permission.AuditViewOperations],
  Support: [Permission.SupportNoteView, Permission.SupportNoteCreate, Permission.SupportCaseManage, Permission.SupportTimelineView],
  Account: [Permission.AccountSuspend, Permission.AccountUnsuspend, Permission.AccountLock, Permission.AccountUnlock, Permission.AccountExclude, Permission.AccountNote],
  Reporting: [Permission.ReportingPlayer, Permission.ReportingOperational, Permission.ReportingFinance, Permission.ReportingRisk, Permission.ReportingCompliance],
  Player: [Permission.PlayerSearch, Permission.PlayerView],
} as const satisfies Record<string, Permission[]>;

export interface AdminUser {
  id: string;
  username: string;
  roles: Role[];
  active: boolean;
  createdAt: number;
}

/** The caller identity carried on every operations call (STEP 9). */
export interface AuthContext {
  actor: string;
  roles: Role[];
  sessionId?: string;
  correlationId?: string;
}

/* ---------------------------- account operations -------------------------- */

export enum AccountStatus {
  Active = 'active',
  Suspended = 'suspended',
  Locked = 'locked',
  SelfExcluded = 'self_excluded',
}

export interface AccountState {
  playerId: string;
  status: AccountStatus;
  /** Set when a temporary lock/exclusion has an expiry (epoch ms). */
  until?: number;
  reason?: string;
  updatedBy?: string;
  updatedAt: number;
}

/* ------------------------------ support tools ----------------------------- */

export enum NoteKind {
  Internal = 'internal',
  Case = 'case',
  OperatorComment = 'operator_comment',
}

export interface SupportNote {
  id: string;
  playerId: string;
  kind: NoteKind;
  body: string;
  author: string;
  tags: string[];
  /** Escalation tag hooks, e.g. `escalated`, `vip`, `fraud-review`. */
  escalation?: string;
  /** Attachment reference hooks (ids/URLs resolved elsewhere — never inlined). */
  attachments?: string[];
  createdAt: number;
}

export interface TimelineEvent {
  at: number;
  source: string;
  type: string;
  detail: string;
  correlationId?: string;
}

/* --------------------------- player management ---------------------------- */

export interface WalletSummary {
  available: number;
  locked: number;
  total: number;
  vault: number;
  currency: string;
}
export interface WithdrawalSummary {
  pending: number;
  pendingAmount: number;
  completed: number;
  completedAmount: number;
}
export interface DepositSummary {
  count: number;
  total: number;
}
export interface RiskSummary {
  decisions: number;
  lastAction?: string;
  lastRiskScore?: number;
  flags: string[];
}
export interface PlayerOverview {
  playerId: string;
  account: AccountState;
  wallet: WalletSummary;
  deposits: DepositSummary;
  withdrawals: WithdrawalSummary;
  risk: RiskSummary;
  supportNotes: number;
}

/* -------------------------------- paging ---------------------------------- */

export interface Page<T> {
  items: T[];
  total: number;
  nextCursor?: string;
}

/* ------------------------------ audit viewer ------------------------------ */

export enum AuditSource {
  Financial = 'financial',
  Compliance = 'compliance',
  Operations = 'operations',
}
export interface UnifiedAuditRecord {
  source: AuditSource;
  at: number;
  actor?: string;
  action: string;
  playerId?: string;
  correlationId?: string;
  detail?: string;
}
export interface AuditFilter {
  sources?: AuditSource[];
  playerId?: string;
  actor?: string;
  correlationId?: string;
  from?: number;
  to?: number;
  search?: string;
  limit?: number;
  cursor?: string;
}

/* -------------------------------- dashboards ------------------------------ */

export interface OperationsDashboard {
  players: { total: number; active: number; suspended: number; excluded: number };
  deposits: DepositSummary;
  withdrawals: { pending: number; pendingAmount: number; completed: number; completedAmount: number };
  risk: { decisions: number; holds: number; rejects: number; manualReviews: number };
  system: SystemStatus;
  generatedAt: number;
}

/* ------------------------------ system health ----------------------------- */

export enum HealthStatus {
  Healthy = 'healthy',
  Degraded = 'degraded',
  Down = 'down',
  Unknown = 'unknown',
}
export interface ComponentHealth {
  name: string;
  status: HealthStatus;
  detail?: string;
  checkedAt: number;
}
export interface SystemStatus {
  overall: HealthStatus;
  components: ComponentHealth[];
}

/* ------------------------------- reporting -------------------------------- */

/** An export-ready tabular report (CSV/JSON downstream). */
export interface Report {
  name: string;
  columns: string[];
  rows: (string | number)[][];
  generatedAt: number;
}

/* --------------------------------- audit ---------------------------------- */

export interface OperationsAuditRecord {
  at: number;
  actor: string;
  action: string;
  target?: string;
  correlationId?: string;
  allowed: boolean;
  detail?: string;
}
