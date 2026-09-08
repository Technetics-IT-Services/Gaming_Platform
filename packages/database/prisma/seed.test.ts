import { hashPassword, verifyPassword } from '@gaming-platform/auth';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PERMISSIONS,
  ROLE_DEFINITIONS,
  runSeed,
  seedBootstrapAdmin,
  SUPER_ADMIN_SLUG,
  type SeedDb,
} from './seed';

/**
 * Phase 2A — production bootstrap seed. Pure tests always run; integration tests run only
 * when a reachable `DATABASE_URL` is configured (skip cleanly otherwise). No frozen module
 * is touched and no financial history is fabricated.
 */

/* --------------------------------- pure tests ------------------------------- */

describe('bootstrap seed — catalog & safety (no DB)', () => {
  it('defines the canonical role/permission catalog', () => {
    expect(ROLE_DEFINITIONS.map((r) => r.slug)).toEqual(['user', 'vip', 'moderator', 'admin', 'super_admin']);
    expect(PERMISSIONS).toHaveLength(24);
    const superAdmin = ROLE_DEFINITIONS.find((r) => r.slug === 'super_admin')!;
    expect(superAdmin.permissions).toHaveLength(PERMISSIONS.length); // super_admin holds everything
    const admin = ROLE_DEFINITIONS.find((r) => r.slug === 'admin')!;
    expect(admin.permissions).toContain('wallets:read'); // can reconcile
    expect(admin.permissions).not.toContain('wallets:adjust'); // adjust is super_admin-only
    expect(ROLE_DEFINITIONS.find((r) => r.slug === 'user')!.permissions).toHaveLength(0);
  });

  it('refuses to create a bootstrap admin without credentials (fails safe)', async () => {
    const noopDb = {} as SeedDb;
    await expect(seedBootstrapAdmin(noopDb, {})).rejects.toThrow(/Refusing to create an insecure bootstrap admin/);
    await expect(seedBootstrapAdmin(noopDb, { BOOTSTRAP_ADMIN_EMAIL: 'a@b.c' })).rejects.toThrow(/BOOTSTRAP_ADMIN_PASSWORD/);
  });

  it('hashes the admin password with the platform hasher (bcrypt, verifiable)', async () => {
    const hash = await hashPassword('S0me_Str0ng_Pw!');
    expect(hash.startsWith('$2')).toBe(true); // bcrypt
    expect(hash).not.toContain('S0me_Str0ng_Pw!'); // never plaintext
    expect(await verifyPassword('S0me_Str0ng_Pw!', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

/* ----------------------------- integration tests ---------------------------- */

const dbConfigured = Boolean(process.env.DATABASE_URL);
const itDb = dbConfigured ? it : it.skip;

describe('bootstrap seed — integration (DB-gated)', () => {
  const prisma = new PrismaClient();
  const TEST_EMAIL = 'seedtest_admin@casino.local';
  const TEST_ENV = { BOOTSTRAP_ADMIN_EMAIL: TEST_EMAIL, BOOTSTRAP_ADMIN_PASSWORD: 'SeedTest_Pw2026', BOOTSTRAP_ADMIN_USERNAME: 'seedtest_admin' };

  beforeAll(async () => {
    if (dbConfigured) await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  itDb('is idempotent: two runs yield stable reference-data counts (no duplicates)', async () => {
    await runSeed(prisma, TEST_ENV);
    const after1 = {
      currencies: await prisma.currency.count(),
      roles: await prisma.role.count(),
      permissions: await prisma.permission.count(),
    };
    await runSeed(prisma, TEST_ENV);
    const after2 = {
      currencies: await prisma.currency.count(),
      roles: await prisma.role.count(),
      permissions: await prisma.permission.count(),
    };
    expect(after2).toEqual(after1);
    expect(after2.roles).toBe(5);
    expect(after2.permissions).toBe(24);
    expect(after2.currencies).toBeGreaterThanOrEqual(2);
  });

  itDb('creates INR (primary) + USD currencies', async () => {
    const inr = await prisma.currency.findUnique({ where: { code: 'INR' } });
    const usd = await prisma.currency.findUnique({ where: { code: 'USD' } });
    expect(inr).toMatchObject({ code: 'INR', symbol: '₹', isActive: true });
    expect(usd?.code).toBe('USD');
  });

  itDb('creates roles + permissions and grants super_admin every permission', async () => {
    const superAdmin = await prisma.role.findUnique({ where: { slug: SUPER_ADMIN_SLUG }, include: { permissions: true } });
    expect(superAdmin?.level).toBe(50);
    expect(superAdmin?.permissions.length).toBe(PERMISSIONS.length);
    const admin = await prisma.role.findUnique({ where: { slug: 'admin' }, include: { permissions: { include: { permission: true } } } });
    const adminSlugs = admin?.permissions.map((rp) => rp.permission.slug) ?? [];
    expect(adminSlugs).toContain('wallets:read');
    expect(adminSlugs).not.toContain('wallets:adjust');
  });

  itDb('creates the bootstrap admin with a verifiable hash + super_admin assignment', async () => {
    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL }, include: { roles: { include: { role: true } } } });
    expect(user).toBeTruthy();
    expect(user!.status).toBe('ACTIVE');
    expect(user!.passwordHash).toBeTruthy();
    expect(await verifyPassword('SeedTest_Pw2026', user!.passwordHash!)).toBe(true); // login-compatible
    expect(user!.roles.some((r) => r.role.slug === 'super_admin')).toBe(true);
  });
});
