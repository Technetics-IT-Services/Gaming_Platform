/**
 * Enterprise RBAC (Phase 6A, STEP 2 & 9).
 *
 * Role → permission resolution with inheritance, permission groups and optional
 * scoped/feature permissions. `RBACService` is the single enforcement point: every
 * operations call resolves the caller's effective permissions and asserts before
 * any work runs. Deny-by-default — an unknown role grants nothing.
 */
import { Permission, PermissionGroups, Role } from './types';

export class AccessDeniedError extends Error {
  constructor(
    readonly actor: string,
    readonly permission: Permission,
    readonly scope?: string,
  ) {
    super(`Access denied: ${actor} lacks ${permission}${scope ? ` for scope ${scope}` : ''}`);
    this.name = 'AccessDeniedError';
  }
}

interface RoleDefinition {
  /** Roles whose permissions are also granted (resolved transitively). */
  inherits?: Role[];
  permissions: Permission[];
  /** Optional per-permission scope restriction (absent ⇒ unscoped/global). */
  scopes?: Partial<Record<Permission, string[]>>;
}

const G = PermissionGroups;

/** The default enterprise role model. Configurable — pass overrides to the ctor. */
const DEFAULT_ROLES: Record<Role, RoleDefinition> = {
  [Role.Support]: {
    permissions: [...G.Player, Permission.SupportNoteView, Permission.SupportNoteCreate, Permission.SupportTimelineView, Permission.AccountNote],
  },
  [Role.SupportAdmin]: {
    inherits: [Role.Support],
    permissions: [...G.Support, Permission.AccountSuspend, Permission.AccountUnsuspend, Permission.AccountLock, Permission.AccountUnlock, Permission.DashboardView],
  },
  [Role.ComplianceAdmin]: {
    inherits: [Role.Support],
    permissions: [Permission.ComplianceView, Permission.RiskView, Permission.AuditViewCompliance, Permission.AccountExclude, Permission.AccountSuspend, Permission.ReportingCompliance, Permission.ReportingRisk, Permission.DashboardView],
  },
  [Role.FinanceAdmin]: {
    inherits: [Role.Support],
    permissions: [Permission.FinanceView, Permission.AuditViewFinancial, Permission.ReportingFinance, Permission.DashboardView],
  },
  [Role.ReadOnlyAuditor]: {
    // Read everything, change nothing. Scoped to view/report permissions only.
    permissions: [...G.Player, ...G.AuditView, ...G.Reporting, Permission.DashboardView, Permission.FinanceView, Permission.RiskView, Permission.ComplianceView, Permission.HealthView, Permission.SupportNoteView, Permission.SupportTimelineView],
  },
  [Role.OperationsAdmin]: {
    inherits: [Role.SupportAdmin, Role.ReadOnlyAuditor],
    permissions: [...G.Account, Permission.HealthView, Permission.AccountExclude],
  },
  [Role.SuperAdmin]: {
    // Everything, including staff user management.
    permissions: Object.values(Permission),
  },
};

export class RBACService {
  private readonly roles: Record<Role, RoleDefinition>;
  /** Memoized effective permission sets per role. */
  private readonly cache = new Map<Role, Set<Permission>>();

  constructor(roles: Partial<Record<Role, RoleDefinition>> = {}) {
    this.roles = { ...DEFAULT_ROLES, ...roles } as Record<Role, RoleDefinition>;
  }

  /** Resolve a role's effective permissions (inheritance flattened + cached). */
  private resolve(role: Role, seen = new Set<Role>()): Set<Permission> {
    const cached = this.cache.get(role);
    if (cached) return cached;
    const def = this.roles[role];
    const out = new Set<Permission>();
    if (def) {
      seen.add(role);
      for (const parent of def.inherits ?? []) {
        if (!seen.has(parent)) for (const p of this.resolve(parent, seen)) out.add(p);
      }
      for (const p of def.permissions) out.add(p);
    }
    if (seen.size <= 1) this.cache.set(role, out); // only cache fully-resolved top calls
    return out;
  }

  /** Effective permissions across all of a caller's roles. */
  permissionsOf(roles: Role[]): Set<Permission> {
    const out = new Set<Permission>();
    for (const r of roles) for (const p of this.resolve(r)) out.add(p);
    return out;
  }

  /** Does any of the caller's roles grant this permission (respecting scope)? */
  can(roles: Role[], permission: Permission, scope?: string): boolean {
    for (const role of roles) {
      const def = this.roles[role];
      if (!def) continue;
      if (!this.resolve(role).has(permission)) continue;
      const allowedScopes = def.scopes?.[permission];
      if (!allowedScopes) return true; // unscoped grant
      if (scope !== undefined && allowedScopes.includes(scope)) return true;
    }
    return false;
  }

  /** Throw unless permitted (the enforcement primitive used platform-wide). */
  assert(actor: string, roles: Role[], permission: Permission, scope?: string): void {
    if (!this.can(roles, permission, scope)) throw new AccessDeniedError(actor, permission, scope);
  }
}
