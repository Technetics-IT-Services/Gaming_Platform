/**
 * Operations service (Phase 6A, STEP 1 & 9) — the RBAC-enforced facade.
 *
 * The single entry point for internal staff. Every call carries an `AuthContext`,
 * is permission-checked BEFORE any work, and is written to the operations audit
 * (allow AND deny). It composes the sub-services and consumes the frozen platform
 * services through read ports — it never bypasses or mutates ledger/treasury/
 * compliance/payments/runtime. Also hosts staff (admin) user management.
 */
import { type WalletService } from '@/lib/ledger';
import { type WithdrawalService } from '@/lib/treasury';
import { type ComplianceService } from '@/lib/compliance';

import { AccountService } from './account-service';
import { complianceReadPort, walletReadPort, withdrawalReadPort } from './adapters';
import { AuditViewerService } from './audit-viewer-service';
import { DashboardService } from './dashboard-service';
import { HealthService } from './health-service';
import { OperationsAudit } from './operations-audit';
import { PlayerService } from './player-service';
import { type HealthProbe } from './ports';
import { AccessDeniedError, RBACService } from './rbac';
import { ReportingService } from './reporting-service';
import { SearchService, type PlayerIndexEntry } from './search-service';
import { SupportService } from './support-service';
import {
  type AdminUser,
  type AuditFilter,
  AuditSource,
  type AuthContext,
  type NoteKind,
  type OperationsDashboard,
  type Page,
  Permission,
  type PlayerOverview,
  type Report,
  type Role,
  type SupportNote,
  type SystemStatus,
  type TimelineEvent,
  type UnifiedAuditRecord,
} from './types';

export interface OperationsServiceDeps {
  wallet: WalletService;
  withdrawals: WithdrawalService;
  compliance: ComplianceService;
  rbac?: RBACService;
  clock?: () => number;
  healthProbes?: HealthProbe[];
}

export class OperationsService {
  readonly rbac: RBACService;
  readonly audit = new OperationsAudit();
  readonly accounts: AccountService;
  readonly support: SupportService;
  readonly search: SearchService;
  readonly players: PlayerService;
  readonly auditViewer: AuditViewerService;
  readonly dashboard: DashboardService;
  readonly health: HealthService;
  readonly reporting: ReportingService;

  private readonly adminUsers = new Map<string, AdminUser>();
  private readonly clock: () => number;

  constructor(deps: OperationsServiceDeps) {
    this.clock = deps.clock ?? (() => Date.now());
    this.rbac = deps.rbac ?? new RBACService();
    this.accounts = new AccountService(this.clock);
    this.support = new SupportService(this.clock);
    this.search = new SearchService();

    const walletPort = walletReadPort(deps.wallet);
    const withdrawalPort = withdrawalReadPort(deps.withdrawals);
    const compliancePort = complianceReadPort(deps.compliance);
    const ledgerPort = { reconcile: () => deps.wallet.reconcile() };

    this.players = new PlayerService({ wallet: walletPort, withdrawals: withdrawalPort, compliance: compliancePort, accounts: this.accounts, support: this.support });
    this.health = new HealthService({ ledger: ledgerPort, withdrawals: withdrawalPort, clock: this.clock, probes: deps.healthProbes });
    this.auditViewer = new AuditViewerService({ compliance: compliancePort, withdrawals: withdrawalPort, operations: this.audit });
    this.dashboard = new DashboardService({ wallet: walletPort, withdrawals: withdrawalPort, compliance: compliancePort, accounts: this.accounts, search: this.search, health: this.health, clock: this.clock });
    this.reporting = new ReportingService({ withdrawals: withdrawalPort, compliance: compliancePort, players: this.players, accounts: this.accounts, search: this.search, operations: this.audit, clock: this.clock });
  }

  /* ------------------------------ enforcement ----------------------------- */

  private secureId(prefix: string): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  /** Assert a permission, run the action, and audit the outcome (allow AND deny). */
  private enforce<T>(auth: AuthContext, permission: Permission, action: string, target: string | undefined, fn: () => T, detail?: string): T {
    const correlationId = auth.correlationId ?? this.secureId('corr');
    try {
      this.rbac.assert(auth.actor, auth.roles, permission);
    } catch (e) {
      if (e instanceof AccessDeniedError) {
        this.audit.record({ at: this.clock(), actor: auth.actor, action, target, correlationId, allowed: false, detail: `denied: ${permission}` });
      }
      throw e;
    }
    const result = fn();
    this.audit.record({ at: this.clock(), actor: auth.actor, action, target, correlationId, allowed: true, detail });
    return result;
  }

  /* -------------------------- player management --------------------------- */

  registerPlayer(entry: PlayerIndexEntry): void {
    this.search.register(entry);
  }

  searchPlayers(auth: AuthContext, query: { text?: string; limit?: number; cursor?: string }): Page<PlayerIndexEntry> {
    return this.enforce(auth, Permission.PlayerSearch, 'player.search', undefined, () => this.search.search(query));
  }
  getPlayerOverview(auth: AuthContext, playerId: string): PlayerOverview {
    return this.enforce(auth, Permission.PlayerView, 'player.view', playerId, () => this.players.overview(playerId));
  }
  getPlayerTimeline(auth: AuthContext, playerId: string): TimelineEvent[] {
    return this.enforce(auth, Permission.SupportTimelineView, 'player.timeline', playerId, () => this.players.timeline(playerId));
  }

  /* --------------------------- account operations ------------------------- */

  suspendPlayer(auth: AuthContext, playerId: string, reason: string) {
    return this.enforce(auth, Permission.AccountSuspend, 'account.suspend', playerId, () => this.accounts.suspend(playerId, auth.actor, reason), reason);
  }
  unsuspendPlayer(auth: AuthContext, playerId: string, reason?: string) {
    return this.enforce(auth, Permission.AccountUnsuspend, 'account.unsuspend', playerId, () => this.accounts.unsuspend(playerId, auth.actor, reason), reason);
  }
  lockPlayer(auth: AuthContext, playerId: string, reason: string, until?: number) {
    return this.enforce(auth, Permission.AccountLock, 'account.lock', playerId, () => this.accounts.lock(playerId, auth.actor, reason, until), reason);
  }
  unlockPlayer(auth: AuthContext, playerId: string, reason?: string) {
    return this.enforce(auth, Permission.AccountUnlock, 'account.unlock', playerId, () => this.accounts.unlock(playerId, auth.actor, reason), reason);
  }
  excludePlayer(auth: AuthContext, playerId: string, reason: string, until?: number) {
    return this.enforce(auth, Permission.AccountExclude, 'account.exclude', playerId, () => this.accounts.exclude(playerId, auth.actor, reason, until), reason);
  }

  /* ------------------------------ support tools --------------------------- */

  addNote(auth: AuthContext, input: { playerId: string; kind?: NoteKind; body: string; tags?: string[]; escalation?: string; attachments?: string[] }): SupportNote {
    return this.enforce(auth, Permission.SupportNoteCreate, 'support.note.create', input.playerId, () => this.support.addNote({ ...input, author: auth.actor }));
  }
  listNotes(auth: AuthContext, playerId: string): SupportNote[] {
    return this.enforce(auth, Permission.SupportNoteView, 'support.note.view', playerId, () => this.support.listNotes(playerId));
  }
  searchNotes(auth: AuthContext, query: { playerId?: string; text?: string; escalation?: string; limit?: number }): SupportNote[] {
    return this.enforce(auth, Permission.SupportNoteView, 'support.note.search', query.playerId, () => this.support.search(query));
  }

  /* ------------------------------ audit viewer ---------------------------- */

  private assertAuditSources(auth: AuthContext, filter: AuditFilter): void {
    const sources = new Set(filter.sources ?? [AuditSource.Financial, AuditSource.Compliance, AuditSource.Operations]);
    if (sources.has(AuditSource.Financial)) this.rbac.assert(auth.actor, auth.roles, Permission.AuditViewFinancial);
    if (sources.has(AuditSource.Compliance)) this.rbac.assert(auth.actor, auth.roles, Permission.AuditViewCompliance);
    if (sources.has(AuditSource.Operations)) this.rbac.assert(auth.actor, auth.roles, Permission.AuditViewOperations);
  }
  auditSearch(auth: AuthContext, filter: AuditFilter = {}): Page<UnifiedAuditRecord> {
    this.assertAuditSources(auth, filter);
    const result = this.auditViewer.search(filter);
    this.audit.record({ at: this.clock(), actor: auth.actor, action: 'audit.search', correlationId: auth.correlationId ?? this.secureId('corr'), allowed: true });
    return result;
  }
  exportAudit(auth: AuthContext, filter: AuditFilter = {}): Report {
    this.assertAuditSources(auth, filter);
    return this.auditViewer.export(filter);
  }

  /* -------------------------------- dashboards ---------------------------- */

  getDashboard(auth: AuthContext): OperationsDashboard {
    return this.enforce(auth, Permission.DashboardView, 'dashboard.view', undefined, () => this.dashboard.overview());
  }
  getPendingWithdrawals(auth: AuthContext) {
    return this.enforce(auth, Permission.DashboardView, 'dashboard.pending_withdrawals', undefined, () => this.dashboard.pendingWithdrawals());
  }

  /* ------------------------------ system health --------------------------- */

  async getHealth(auth: AuthContext): Promise<SystemStatus> {
    this.rbac.assert(auth.actor, auth.roles, Permission.HealthView);
    return this.health.status();
  }

  /* -------------------------------- reporting ----------------------------- */

  playerReport(auth: AuthContext): Report {
    return this.enforce(auth, Permission.ReportingPlayer, 'report.player', undefined, () => this.reporting.playerReport());
  }
  operationalReport(auth: AuthContext): Report {
    return this.enforce(auth, Permission.ReportingOperational, 'report.operational', undefined, () => this.reporting.operationalReport());
  }
  financeReport(auth: AuthContext): Report {
    return this.enforce(auth, Permission.ReportingFinance, 'report.finance', undefined, () => this.reporting.financeReport());
  }
  riskReport(auth: AuthContext): Report {
    return this.enforce(auth, Permission.ReportingRisk, 'report.risk', undefined, () => this.reporting.riskReport());
  }
  complianceReport(auth: AuthContext): Report {
    return this.enforce(auth, Permission.ReportingCompliance, 'report.compliance', undefined, () => this.reporting.complianceReport());
  }

  /* --------------------------- staff user management ---------------------- */

  createAdminUser(auth: AuthContext, input: { username: string; roles: Role[] }): AdminUser {
    return this.enforce(auth, Permission.UserManage, 'user.create', input.username, () => {
      const user: AdminUser = { id: this.secureId('adm'), username: input.username, roles: input.roles, active: true, createdAt: this.clock() };
      this.adminUsers.set(user.id, user);
      return user;
    });
  }
  assignRoles(auth: AuthContext, userId: string, roles: Role[]): AdminUser {
    return this.enforce(auth, Permission.UserManage, 'user.assign_roles', userId, () => {
      const user = this.adminUsers.get(userId);
      if (!user) throw new Error('No such admin user');
      user.roles = roles;
      return user;
    });
  }
  deactivateAdminUser(auth: AuthContext, userId: string): AdminUser {
    return this.enforce(auth, Permission.UserManage, 'user.deactivate', userId, () => {
      const user = this.adminUsers.get(userId);
      if (!user) throw new Error('No such admin user');
      user.active = false;
      return user;
    });
  }
  listAdminUsers(auth: AuthContext): AdminUser[] {
    return this.enforce(auth, Permission.UserManage, 'user.list', undefined, () => [...this.adminUsers.values()]);
  }
}
