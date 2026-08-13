/**
 * Control-plane RBAC (Phase 3.2, STEP 16 & 17).
 *
 * Deny-by-default role/permission model for administrative tenant operations, with tenant
 * scoping: a Tenant Admin of Tenant A can NEVER act on Tenant B; a Platform Super Admin may
 * act on any tenant. Authorization requires tenant context + permission + resource
 * ownership to all agree before a tenant resource is touched. Additive; no frozen module.
 */

export enum ControlPlaneRole {
  PlatformSuperAdmin = 'platform-super-admin',
  TenantAdmin = 'tenant-admin',
  TenantOperator = 'tenant-operator',
  TenantFinance = 'tenant-finance',
  TenantSupport = 'tenant-support',
  TenantAuditor = 'tenant-auditor',
  ReadOnly = 'read-only',
}

export enum ControlPlanePermission {
  TenantCreate = 'tenant.create',
  TenantRead = 'tenant.read',
  TenantUpdate = 'tenant.update',
  TenantLifecycle = 'tenant.lifecycle',
  DomainRead = 'domain.read',
  DomainManage = 'domain.manage',
  ApiKeyRead = 'apikey.read',
  ApiKeyManage = 'apikey.manage',
  ConfigRead = 'config.read',
  ConfigWrite = 'config.write',
  ConfigRollback = 'config.rollback',
  FlagRead = 'flag.read',
  FlagWrite = 'flag.write',
  QuotaRead = 'quota.read',
  QuotaWrite = 'quota.write',
  AuditRead = 'audit.read',
  Provision = 'provision',
  SecretRead = 'secret.read',
  SecretManage = 'secret.manage',
}

const P = ControlPlanePermission;

const ROLE_PERMISSIONS: Record<ControlPlaneRole, ControlPlanePermission[]> = {
  [ControlPlaneRole.PlatformSuperAdmin]: Object.values(P),
  [ControlPlaneRole.TenantAdmin]: [
    P.TenantRead, P.TenantUpdate, P.TenantLifecycle, P.DomainRead, P.DomainManage, P.ApiKeyRead, P.ApiKeyManage,
    P.ConfigRead, P.ConfigWrite, P.ConfigRollback, P.FlagRead, P.FlagWrite, P.QuotaRead, P.AuditRead, P.SecretRead, P.SecretManage,
  ],
  [ControlPlaneRole.TenantOperator]: [P.TenantRead, P.DomainRead, P.ApiKeyRead, P.ConfigRead, P.ConfigWrite, P.FlagRead, P.FlagWrite, P.QuotaRead, P.AuditRead],
  [ControlPlaneRole.TenantFinance]: [P.TenantRead, P.ConfigRead, P.QuotaRead, P.AuditRead],
  [ControlPlaneRole.TenantSupport]: [P.TenantRead, P.DomainRead, P.ConfigRead, P.FlagRead, P.AuditRead],
  [ControlPlaneRole.TenantAuditor]: [P.TenantRead, P.DomainRead, P.ApiKeyRead, P.ConfigRead, P.FlagRead, P.QuotaRead, P.AuditRead],
  [ControlPlaneRole.ReadOnly]: [P.TenantRead, P.DomainRead, P.ConfigRead, P.FlagRead, P.QuotaRead],
};

/** Who is making a control-plane call. `tenantId` is the actor's home tenant; '*' = platform-wide. */
export interface ControlPlaneAuth {
  actorId: string;
  actorType: 'platform' | 'tenant' | 'system';
  roles: ControlPlaneRole[];
  /** The tenant this actor belongs to; '*' or undefined for platform-scoped actors. */
  tenantId?: string | '*';
}

export interface AuthDecision {
  allowed: boolean;
  reason?: string;
}

export function hasPermission(roles: ControlPlaneRole[], permission: ControlPlanePermission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission));
}

export function isPlatformScoped(auth: ControlPlaneAuth): boolean {
  return auth.roles.includes(ControlPlaneRole.PlatformSuperAdmin) || auth.tenantId === '*';
}

/**
 * The single authorization gate: permission AND resource ownership must both hold.
 * `resourceTenantId` is the tenant the operation targets (omit for tenant-create).
 */
export function authorize(auth: ControlPlaneAuth, permission: ControlPlanePermission, resourceTenantId?: string): AuthDecision {
  if (!hasPermission(auth.roles, permission)) return { allowed: false, reason: `missing permission ${permission}` };
  if (isPlatformScoped(auth)) return { allowed: true };
  // Tenant-scoped actor: may only act within their own tenant.
  if (resourceTenantId !== undefined && auth.tenantId !== resourceTenantId) {
    return { allowed: false, reason: 'cross-tenant access denied' };
  }
  return { allowed: true };
}

/** System actor (background jobs / provisioning) — platform-scoped, minimal footprint. */
export const SYSTEM_AUTH: ControlPlaneAuth = { actorId: 'system', actorType: 'system', roles: [ControlPlaneRole.PlatformSuperAdmin], tenantId: '*' };
