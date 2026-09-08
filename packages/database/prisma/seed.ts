/* eslint-disable no-console */
import { hashPassword } from '@gaming-platform/auth';
import { PrismaClient } from '@prisma/client';

/** The Prisma surface the seed touches — lets tests inject a client. */
export type SeedDb = Pick<
  PrismaClient,
  'currency' | 'permission' | 'role' | 'rolePermission' | 'user' | 'userRole' | '$connect' | '$disconnect'
>;

/**
 * Production bootstrap seed (Phase 2A).
 *
 * Idempotent reference-data provisioning that makes the existing wallet/ledger and admin
 * APIs legitimately exercisable — WITHOUT modifying any frozen module and WITHOUT
 * fabricating financial history:
 *   • base currencies (INR primary + USD)
 *   • the canonical RBAC catalog (permissions, roles, grants) — the SAME slugs/levels the
 *     backend's RbacBootstrapService uses, so seed-then-boot converge with no duplicates
 *   • a deterministic bootstrap super-admin from environment credentials (bcrypt-hashed via
 *     the platform's own hashPassword; never stored/printed in plaintext)
 *
 * Re-running is safe (upserts only). It NEVER deletes data, truncates, resets, creates
 * wallets, or writes ledger entries. Run: `pnpm --filter @gaming-platform/database db:seed`.
 */

/** Minimum currency reference set. INR is the primary (India-market) dev/reference currency. */
export const CURRENCIES = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
] as const;

/* --- Canonical RBAC catalog (slugs mirror apps/backend RbacBootstrapService exactly) ----- */
export const PERMISSIONS = [
  'users:read', 'users:write', 'users:delete', 'users:lock', 'users:verify',
  'roles:read', 'roles:write', 'roles:assign', 'permissions:read', 'permissions:write',
  'sessions:read', 'sessions:revoke', 'security:read', 'audit:read',
  'games:read', 'games:write', 'wallets:read', 'wallets:adjust', 'transactions:read',
  'analytics:read', 'settings:read', 'settings:write', 'feature_flags:read', 'feature_flags:write',
] as const;

const MODERATOR_PERMS = ['users:read', 'sessions:read', 'security:read', 'audit:read'];
const ADMIN_PERMS = [
  ...MODERATOR_PERMS,
  'users:write', 'users:lock', 'users:verify', 'roles:read', 'roles:assign', 'permissions:read',
  'sessions:revoke', 'games:read', 'games:write', 'wallets:read', 'transactions:read',
  'analytics:read', 'settings:read', 'feature_flags:read',
];

export const ROLE_DEFINITIONS = [
  { slug: 'user', name: 'User', level: 10, permissions: [] as string[] },
  { slug: 'vip', name: 'VIP', level: 20, permissions: [] as string[] },
  { slug: 'moderator', name: 'Moderator', level: 30, permissions: MODERATOR_PERMS },
  { slug: 'admin', name: 'Administrator', level: 40, permissions: ADMIN_PERMS },
  { slug: 'super_admin', name: 'Super Admin', level: 50, permissions: [...PERMISSIONS] },
];
export const SUPER_ADMIN_SLUG = 'super_admin';

export async function seedCurrencies(db: SeedDb): Promise<void> {
  for (const c of CURRENCIES) {
    await db.currency.upsert({
      where: { code: c.code },
      update: { name: c.name, symbol: c.symbol, decimals: c.decimals, isActive: true },
      create: { code: c.code, name: c.name, symbol: c.symbol, decimals: c.decimals, isActive: true },
    });
  }
  console.info(`✅  Currencies ensured: ${CURRENCIES.map((c) => c.code).join(', ')} (primary: INR)`);
}

/** Idempotent permissions → roles → grants (converges with RbacBootstrapService). */
export async function seedRbac(db: SeedDb): Promise<void> {
  for (const slug of PERMISSIONS) {
    const [resource, action] = slug.split(':');
    await db.permission.upsert({
      where: { slug },
      update: { name: slug, resource: resource ?? slug, action: action ?? 'access' },
      create: { name: slug, slug, resource: resource ?? slug, action: action ?? 'access' },
    });
  }

  const permissions = await db.permission.findMany({ select: { id: true, slug: true } });
  const permissionIdBySlug = new Map(permissions.map((p) => [p.slug, p.id]));

  for (const def of ROLE_DEFINITIONS) {
    const role = await db.role.upsert({
      where: { slug: def.slug },
      update: { name: def.name, level: def.level, isSystem: true },
      create: { name: def.name, slug: def.slug, level: def.level, isSystem: true },
    });

    const existing = await db.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionId: true } });
    const existingIds = new Set(existing.map((e) => e.permissionId));
    const desiredIds = def.permissions.map((p) => permissionIdBySlug.get(p)).filter((id): id is string => Boolean(id));
    const toCreate = desiredIds.filter((id) => !existingIds.has(id));
    if (toCreate.length > 0) {
      await db.rolePermission.createMany({ data: toCreate.map((permissionId) => ({ roleId: role.id, permissionId })), skipDuplicates: true });
    }
  }
  console.info(`✅  RBAC ensured: ${ROLE_DEFINITIONS.length} roles, ${PERMISSIONS.length} permissions, grants applied`);
}

/** Deterministic bootstrap super-admin from environment credentials (fails safe if missing). */
export async function seedBootstrapAdmin(db: SeedDb, env: Record<string, string | undefined> = process.env): Promise<void> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  const username = env.BOOTSTRAP_ADMIN_USERNAME?.trim() || 'root_admin';

  if (!email || !password) {
    throw new Error(
      'Refusing to create an insecure bootstrap admin: set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD ' +
        '(and optionally BOOTSTRAP_ADMIN_USERNAME) before seeding.',
    );
  }

  const passwordHash = await hashPassword(password); // bcrypt via @gaming-platform/auth — never stored/logged in plaintext

  const user = await db.user.upsert({
    where: { email },
    update: { passwordHash, status: 'ACTIVE', emailVerified: true }, // re-seed rotates the admin password to the env value
    create: { email, username, passwordHash, status: 'ACTIVE', emailVerified: true, authProvider: 'LOCAL' },
  });

  const superAdmin = await db.role.findUnique({ where: { slug: SUPER_ADMIN_SLUG } });
  if (!superAdmin) throw new Error('super_admin role missing — RBAC seed did not run');

  await db.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: superAdmin.id } },
    update: {},
    create: { userId: user.id, roleId: superAdmin.id },
  });

  console.info(`✅  Bootstrap admin ensured: ${email} (role: super_admin)`); // no password printed
}

/** Full idempotent bootstrap. */
export async function runSeed(db: SeedDb, env: Record<string, string | undefined> = process.env): Promise<void> {
  console.info('🌱  Seeding production bootstrap reference data…');
  await db.$connect();
  await seedCurrencies(db);
  await seedRbac(db);
  await seedBootstrapAdmin(db, env);
  console.info('✅  Bootstrap seed complete (idempotent; no wallets or ledger entries created).');
}

// Auto-run only when executed directly (e.g. `tsx prisma/seed.ts`), not when imported by tests.
const invokedDirectly = Boolean(process.argv[1] && /seed\.(ts|js|mjs|cjs)$/.test(process.argv[1]));
if (invokedDirectly) {
  const prisma = new PrismaClient();
  runSeed(prisma)
    .catch((error) => {
      console.error('❌  Seed failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
