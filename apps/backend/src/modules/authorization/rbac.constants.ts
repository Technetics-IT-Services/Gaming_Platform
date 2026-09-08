import { UserRole } from '@gaming-platform/types';

/**
 * Canonical permission catalog (resource:action). This is the single source of
 * truth used by the idempotent RBAC bootstrap and by `@RequirePermissions`.
 */
export const PERMISSIONS = {
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  USERS_DELETE: 'users:delete',
  USERS_LOCK: 'users:lock',
  USERS_VERIFY: 'users:verify',
  ROLES_READ: 'roles:read',
  ROLES_WRITE: 'roles:write',
  ROLES_ASSIGN: 'roles:assign',
  PERMISSIONS_READ: 'permissions:read',
  PERMISSIONS_WRITE: 'permissions:write',
  SESSIONS_READ: 'sessions:read',
  SESSIONS_REVOKE: 'sessions:revoke',
  SECURITY_READ: 'security:read',
  AUDIT_READ: 'audit:read',
  GAMES_READ: 'games:read',
  GAMES_WRITE: 'games:write',
  WALLETS_READ: 'wallets:read',
  WALLETS_ADJUST: 'wallets:adjust',
  TRANSACTIONS_READ: 'transactions:read',
  ANALYTICS_READ: 'analytics:read',
  // Phase 2D.3: support ticketing. A support agent needs to read and answer tickets WITHOUT holding
  // user-write, wallet or role permissions, so these are their own narrow pair rather than a reuse
  // of `users:write` (which would over-grant) or `users:read` (which cannot express replying).
  SUPPORT_READ: 'support:read',
  SUPPORT_WRITE: 'support:write',
  // Phase 2D.4 — partner principal. Three narrow permissions, deliberately NOT admin:
  //  * read_own  — a partner reads only their OWN organisation
  //  * read      — an operator lists/reads partners
  //  * write     — create a partner and set its ownership %. SUPER-ADMIN ONLY, because the client
  //                enumeration lists "manage partners" and "change partner percentages" under
  //                SUPER ADMIN (PHASE_2C16_AUDIT.md §4.4).
  // Phase 2D.5 — finance expenses. Narrow and separate from wallet permissions: recording what the
  // business spent is not the same authority as moving player money, so `wallets:adjust` is NOT
  // reused and is NOT required.
  EXPENSES_READ: 'expenses:read',
  EXPENSES_WRITE: 'expenses:write',
  PARTNERS_READ_OWN: 'partners:read_own',
  PARTNERS_READ: 'partners:read',
  PARTNERS_WRITE: 'partners:write',
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
  FEATURE_FLAGS_READ: 'feature_flags:read',
  FEATURE_FLAGS_WRITE: 'feature_flags:write',
} as const;

export type PermissionSlug = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionSlug[] = Object.values(PERMISSIONS);

/** Canonical role slugs. */
export const ROLE_SLUGS = {
  USER: 'user',
  VIP: 'vip',
  PARTNER: 'partner',
  // Phase 2D.10 (F-01): a finance operator. Reviews the money that has already moved and records
  // what the business spent. Deliberately holds NO wallet-adjust, NO user-write and NO role
  // permission — reviewing is not the same authority as moving money or changing an account.
  FINANCE: 'finance',
  MODERATOR: 'moderator',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const;

export type RoleSlug = (typeof ROLE_SLUGS)[keyof typeof ROLE_SLUGS];

export interface RoleDefinition {
  slug: RoleSlug;
  name: string;
  level: number;
  permissions: PermissionSlug[];
}

const MODERATOR_PERMS: PermissionSlug[] = [
  PERMISSIONS.USERS_READ,
  PERMISSIONS.SESSIONS_READ,
  PERMISSIONS.SECURITY_READ,
  PERMISSIONS.AUDIT_READ,
  // Moderators ARE the support agents: they answer tickets. They still hold no user-write,
  // wallet, role or analytics permission.
  PERMISSIONS.SUPPORT_READ,
  PERMISSIONS.SUPPORT_WRITE,
];

/**
 * Finance operator permissions (Phase 2D.10, F-01).
 *
 * Read-only over money, plus ownership of the expense ledger. `wallets:adjust` is deliberately
 * ABSENT: this role inspects and records, it does not credit, debit, approve or pay.
 */
const FINANCE_PERMS: PermissionSlug[] = [
  PERMISSIONS.TRANSACTIONS_READ,
  PERMISSIONS.WALLETS_READ,
  PERMISSIONS.ANALYTICS_READ,
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.EXPENSES_READ,
  PERMISSIONS.EXPENSES_WRITE,
];

const ADMIN_PERMS: PermissionSlug[] = [
  ...MODERATOR_PERMS,
  PERMISSIONS.USERS_WRITE,
  PERMISSIONS.USERS_LOCK,
  PERMISSIONS.USERS_VERIFY,
  PERMISSIONS.ROLES_READ,
  PERMISSIONS.ROLES_ASSIGN,
  PERMISSIONS.PERMISSIONS_READ,
  PERMISSIONS.SESSIONS_REVOKE,
  PERMISSIONS.GAMES_READ,
  PERMISSIONS.GAMES_WRITE,
  PERMISSIONS.WALLETS_READ,
  PERMISSIONS.TRANSACTIONS_READ,
  PERMISSIONS.ANALYTICS_READ,
  PERMISSIONS.PARTNERS_READ,
  PERMISSIONS.EXPENSES_READ,
  PERMISSIONS.EXPENSES_WRITE,
  PERMISSIONS.SETTINGS_READ,
  PERMISSIONS.FEATURE_FLAGS_READ,
];

/** System roles, seeded idempotently at boot. `super_admin` holds everything. */
export const ROLE_DEFINITIONS: RoleDefinition[] = [
  { slug: ROLE_SLUGS.USER, name: 'User', level: 10, permissions: [] },
  { slug: ROLE_SLUGS.VIP, name: 'VIP', level: 20, permissions: [] },
  // A partner is NOT an operator. It holds exactly one permission — read your own organisation —
  // and no admin, wallet, analytics, user or game permission of any kind.
  { slug: ROLE_SLUGS.PARTNER, name: 'Partner', level: 25, permissions: [PERMISSIONS.PARTNERS_READ_OWN] },
  // A finance operator: read the money, read the audit, own the expense ledger. Nothing here can
  // move a rupee — deposit and withdrawal DECISIONS remain on the operator cashier surface, which
  // requires `wallets:adjust` that this role does not hold.
  { slug: ROLE_SLUGS.FINANCE, name: 'Finance', level: 30, permissions: FINANCE_PERMS },
  { slug: ROLE_SLUGS.MODERATOR, name: 'Moderator', level: 30, permissions: MODERATOR_PERMS },
  { slug: ROLE_SLUGS.ADMIN, name: 'Administrator', level: 40, permissions: ADMIN_PERMS },
  { slug: ROLE_SLUGS.SUPER_ADMIN, name: 'Super Admin', level: 50, permissions: ALL_PERMISSIONS },
];

/** Map a role slug to the coarse `UserRole` enum carried in tokens. */
export const ROLE_SLUG_TO_ENUM: Record<RoleSlug, UserRole> = {
  [ROLE_SLUGS.USER]: UserRole.USER,
  [ROLE_SLUGS.VIP]: UserRole.VIP,
  // A partner's COARSE token role stays USER on purpose. `UserRole` is the legacy coarse enum;
  // real authorization is by permission. Mapping partner to anything operator-shaped would make a
  // partner look elevated to any code still reading the coarse role.
  [ROLE_SLUGS.PARTNER]: UserRole.USER,
  // Like `partner`, a finance operator's COARSE token role stays USER on purpose. `UserRole` is the
  // legacy coarse enum; real authorization is by permission. Mapping finance to ADMIN would make it
  // look elevated to any code still reading the coarse role, and would silently pull it into the
  // admin 2FA-required set for reasons unrelated to its actual permissions.
  [ROLE_SLUGS.FINANCE]: UserRole.USER,
  [ROLE_SLUGS.MODERATOR]: UserRole.MODERATOR,
  [ROLE_SLUGS.ADMIN]: UserRole.ADMIN,
  [ROLE_SLUGS.SUPER_ADMIN]: UserRole.SUPER_ADMIN,
};

export const DEFAULT_USER_ROLE: RoleSlug = ROLE_SLUGS.USER;
