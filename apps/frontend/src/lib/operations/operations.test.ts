import { describe, expect, it } from 'vitest';

import { Ledger, TransactionType, WalletService } from '@/lib/ledger';
import { TreasuryEngine, WithdrawalService } from '@/lib/treasury';
import { ComplianceService, OperationType } from '@/lib/compliance';

import { AccessDeniedError, RBACService } from './rbac';
import { ReportingService } from './reporting-service';
import { OperationsService } from './operations-service';
import { AccountStatus, AuditSource, HealthStatus, NoteKind, Permission, Role } from './types';

/**
 * Operations & Administration platform (Phase 6A). Verifies RBAC (roles,
 * inheritance, deny-by-default, enforcement + audit-on-deny), player management,
 * account operations, support tools, the unified audit viewer, dashboards,
 * reporting and health — all read-only over the frozen services (no money moves).
 */

let CLK = 1_700_000_000_000;
const clock = () => (CLK += 1_000);

/** Wire the whole stack over the real frozen services, funded + with activity. */
function setup() {
  const ledger = new Ledger();
  const wallet = new WalletService(ledger, 'INR');
  const treasury = new TreasuryEngine(ledger);
  const compliance = ComplianceService.create({ clock });
  const withdrawals = new WithdrawalService(wallet, treasury, { async payout() { return { ok: true, reference: 'p' }; } }, {
    limits: { min: 100, perTransaction: 1_000_000, dailyMax: 5_000_000 },
    clock,
  });
  const ops = new OperationsService({ wallet, withdrawals, compliance, clock });

  // seed activity
  wallet.credit('p1', 100_000, { type: TransactionType.Deposit });
  wallet.credit('p2', 50_000, { type: TransactionType.Deposit });
  ops.registerPlayer({ playerId: 'p1', username: 'alice' });
  ops.registerPlayer({ playerId: 'p2', username: 'bob' });
  compliance.decide({ operation: OperationType.Withdrawal, playerId: 'p1', amount: 10_000 });

  return { ledger, wallet, treasury, compliance, withdrawals, ops };
}

const SUPER: { actor: string; roles: Role[] } = { actor: 'root', roles: [Role.SuperAdmin] };

describe('RBAC', () => {
  it('resolves inheritance and denies by default', () => {
    const rbac = new RBACService();
    // Support inherits nothing special; can view players, cannot suspend
    expect(rbac.can([Role.Support], Permission.PlayerView)).toBe(true);
    expect(rbac.can([Role.Support], Permission.AccountSuspend)).toBe(false);
    // SupportAdmin inherits Support + gains suspend
    expect(rbac.can([Role.SupportAdmin], Permission.PlayerView)).toBe(true);
    expect(rbac.can([Role.SupportAdmin], Permission.AccountSuspend)).toBe(true);
    // OperationsAdmin inherits SupportAdmin + ReadOnlyAuditor (transitive)
    expect(rbac.can([Role.OperationsAdmin], Permission.AuditViewFinancial)).toBe(true);
    expect(rbac.can([Role.OperationsAdmin], Permission.AccountExclude)).toBe(true);
    // ReadOnlyAuditor can view but never mutate
    expect(rbac.can([Role.ReadOnlyAuditor], Permission.DashboardView)).toBe(true);
    expect(rbac.can([Role.ReadOnlyAuditor], Permission.AccountSuspend)).toBe(false);
    // SuperAdmin has everything
    expect(rbac.can([Role.SuperAdmin], Permission.UserManage)).toBe(true);
  });

  it('an unknown/empty role set grants nothing', () => {
    const rbac = new RBACService();
    expect(rbac.can([], Permission.PlayerView)).toBe(false);
  });
});

describe('permission enforcement + audit', () => {
  it('blocks an unauthorized action and records the denial', () => {
    const { ops } = setup();
    const support = { actor: 'sup', roles: [Role.Support] };
    expect(() => ops.suspendPlayer(support, 'p1', 'nope')).toThrow(AccessDeniedError);
    const denials = ops.audit.query({ actor: 'sup' }).filter((r) => !r.allowed);
    expect(denials.length).toBe(1);
    expect(denials[0]!.detail).toContain('account.suspend');
  });

  it('allows an authorized action and records it', () => {
    const { ops } = setup();
    const admin = { actor: 'ops1', roles: [Role.OperationsAdmin] };
    const state = ops.suspendPlayer(admin, 'p1', 'chargeback risk');
    expect(state.status).toBe(AccountStatus.Suspended);
    const allowed = ops.audit.query({ actor: 'ops1', action: 'account.suspend' });
    expect(allowed[0]!.allowed).toBe(true);
  });
});

describe('player management', () => {
  it('builds an aggregated overview from the frozen services (read-only)', () => {
    const { ops, wallet } = setup();
    const before = wallet.getBalance('p1').available;
    const o = ops.getPlayerOverview(SUPER, 'p1');
    expect(o.wallet.available).toBe(100_000);
    expect(o.deposits).toEqual({ count: 1, total: 100_000 });
    expect(o.risk.decisions).toBe(1);
    expect(o.account.status).toBe(AccountStatus.Active);
    // overview did not move money
    expect(wallet.getBalance('p1').available).toBe(before);
  });

  it('searches the player directory with pagination', () => {
    const { ops } = setup();
    expect(ops.searchPlayers(SUPER, { text: 'ali' }).total).toBe(1);
    const page = ops.searchPlayers(SUPER, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
  });

  it('produces a merged player timeline', () => {
    const { ops } = setup();
    ops.addNote(SUPER, { playerId: 'p1', body: 'called in', kind: NoteKind.Case });
    ops.suspendPlayer(SUPER, 'p1', 'review');
    const tl = ops.getPlayerTimeline(SUPER, 'p1');
    expect(tl.map((e) => e.source)).toEqual(expect.arrayContaining(['support', 'compliance', 'account']));
    // newest first
    expect(tl[0]!.at).toBeGreaterThanOrEqual(tl[tl.length - 1]!.at);
  });
});

describe('account operations', () => {
  it('suspend/unsuspend/lock/unlock/exclude with reason + expiry', () => {
    const { ops } = setup();
    expect(ops.suspendPlayer(SUPER, 'p1', 'r1').status).toBe(AccountStatus.Suspended);
    expect(ops.unsuspendPlayer(SUPER, 'p1').status).toBe(AccountStatus.Active);
    ops.lockPlayer(SUPER, 'p1', 'temp', CLK + 5_000);
    expect(ops.accounts.get('p1').status).toBe(AccountStatus.Locked);
    expect(ops.unlockPlayer(SUPER, 'p1').status).toBe(AccountStatus.Active);
    expect(ops.excludePlayer(SUPER, 'p1', 'RG', CLK + 100_000).status).toBe(AccountStatus.SelfExcluded);
  });

  it('auto-clears an expired temporary lock', () => {
    const { ops } = setup();
    ops.lockPlayer(SUPER, 'p1', 'temp', 1_000); // already in the past vs CLK
    expect(ops.accounts.effectiveStatus('p1', CLK + 10_000)).toBe(AccountStatus.Active);
  });
});

describe('support tools', () => {
  it('creates notes with tags/escalation and searches them', () => {
    const { ops } = setup();
    ops.addNote(SUPER, { playerId: 'p1', body: 'fraud suspicion', tags: ['fraud'], escalation: 'escalated' });
    ops.addNote(SUPER, { playerId: 'p1', body: 'ordinary note' });
    expect(ops.listNotes(SUPER, 'p1')).toHaveLength(2);
    expect(ops.searchNotes(SUPER, { text: 'fraud' })).toHaveLength(1);
    expect(ops.searchNotes(SUPER, { escalation: 'escalated' })).toHaveLength(1);
  });
});

describe('audit viewer', () => {
  it('merges compliance + operations + financial sources with filtering', () => {
    const { ops } = setup();
    ops.suspendPlayer(SUPER, 'p1', 'x'); // operations audit
    const all = ops.auditSearch(SUPER, {});
    const sources = new Set(all.items.map((r) => r.source));
    expect(sources.has(AuditSource.Compliance)).toBe(true);
    expect(sources.has(AuditSource.Operations)).toBe(true);
    // per-source RBAC: a finance-only auditor cannot read compliance audit
    const finance = { actor: 'fin', roles: [Role.FinanceAdmin] };
    expect(() => ops.auditSearch(finance, { sources: [AuditSource.Compliance] })).toThrow(AccessDeniedError);
    expect(() => ops.auditSearch(finance, { sources: [AuditSource.Financial] })).not.toThrow();
  });

  it('exports an audit report as columns/rows', () => {
    const { ops } = setup();
    ops.suspendPlayer(SUPER, 'p1', 'x');
    const report = ops.exportAudit(SUPER, { sources: [AuditSource.Operations] });
    expect(report.columns).toContain('correlationId');
    expect(report.rows.length).toBeGreaterThan(0);
  });
});

describe('dashboards', () => {
  it('aggregates players, deposits, withdrawals, risk and system status', () => {
    const { ops } = setup();
    ops.suspendPlayer(SUPER, 'p2', 'x');
    const d = ops.getDashboard(SUPER);
    expect(d.players.total).toBe(2);
    expect(d.players.suspended).toBe(1);
    expect(d.deposits).toEqual({ count: 2, total: 150_000 });
    expect(d.risk.decisions).toBeGreaterThanOrEqual(1);
    expect(d.system.overall).toBe(HealthStatus.Healthy);
  });
});

describe('reporting', () => {
  it('produces finance/risk/player reports and serializes CSV', () => {
    const { ops } = setup();
    const fin = ops.financeReport(SUPER);
    expect(fin.columns).toEqual(['metric', 'value']);
    expect(fin.rows.find((r) => r[0] === 'balanced')![1]).toBe(1);
    const player = ops.playerReport(SUPER);
    expect(player.rows.length).toBe(2);
    const csv = ReportingService.toCsv(fin);
    expect(csv.split('\n')[0]).toBe('metric,value');
  });

  it('enforces reporting permissions', () => {
    const { ops } = setup();
    const support = { actor: 'sup', roles: [Role.Support] };
    expect(() => ops.financeReport(support)).toThrow(AccessDeniedError);
  });
});

describe('system health', () => {
  it('reports healthy when ledger + treasury reconcile', async () => {
    const { ops } = setup();
    const health = await ops.getHealth(SUPER);
    expect(health.overall).toBe(HealthStatus.Healthy);
    expect(health.components.find((c) => c.name === 'ledger')!.status).toBe(HealthStatus.Healthy);
    expect(health.components.find((c) => c.name === 'runtime')!.detail).toBe('frozen');
  });

  it('surfaces a failing external probe as degraded', async () => {
    const ledger = new Ledger();
    const wallet = new WalletService(ledger, 'INR');
    const treasury = new TreasuryEngine(ledger);
    const compliance = ComplianceService.create({ clock });
    const withdrawals = new WithdrawalService(wallet, treasury, { async payout() { return { ok: true }; } }, { limits: { min: 1, perTransaction: 1e9, dailyMax: 1e9 }, clock });
    const ops = new OperationsService({ wallet, withdrawals, compliance, clock, healthProbes: [{ name: 'razorpay', check: () => ({ healthy: false, detail: 'timeout' }) }] });
    const health = await ops.getHealth(SUPER);
    expect(health.overall).toBe(HealthStatus.Degraded);
  });
});

describe('staff user management', () => {
  it('creates admin users and assigns roles (UserManage only)', () => {
    const { ops } = setup();
    const u = ops.createAdminUser(SUPER, { username: 'newop', roles: [Role.Support] });
    expect(u.active).toBe(true);
    ops.assignRoles(SUPER, u.id, [Role.SupportAdmin]);
    expect(ops.listAdminUsers(SUPER).find((x) => x.id === u.id)!.roles).toEqual([Role.SupportAdmin]);
    const support = { actor: 'sup', roles: [Role.Support] };
    expect(() => ops.createAdminUser(support, { username: 'x', roles: [] })).toThrow(AccessDeniedError);
  });
});
