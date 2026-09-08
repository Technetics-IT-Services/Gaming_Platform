import { ForbiddenException } from '@nestjs/common';

import { AdminTwoFactorGuard, isAdminRoute, requiresTwoFactor } from './admin-two-factor.guard';

/**
 * Phase 2D.2 — server-enforced admin 2FA.
 *
 * The decision must be made from the DATABASE, never from the token or the request, and must not
 * touch players. These tests pin both halves plus the admin-route scoping that makes the guard
 * fail closed for any future admin controller.
 */

function ctx(user: unknown, path: string) {
  const req = { user, path };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

function guard(twoFactorEnabled: boolean | null) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(twoFactorEnabled === null ? null : { twoFactorEnabled }),
    },
  };
  return { g: new AdminTwoFactorGuard(prisma as never), prisma };
}

describe('requiresTwoFactor — which roles are privileged', () => {
  it('admin and super_admin require a second factor', () => {
    expect(requiresTwoFactor(['admin'])).toBe(true);
    expect(requiresTwoFactor(['super_admin'])).toBe(true);
    expect(requiresTwoFactor(['user', 'admin'])).toBe(true);
  });

  it('players, VIPs and moderators are NOT forced into 2FA', () => {
    expect(requiresTwoFactor(['user'])).toBe(false);
    expect(requiresTwoFactor(['vip'])).toBe(false);
    expect(requiresTwoFactor(['moderator'])).toBe(false);
    expect(requiresTwoFactor([])).toBe(false);
    expect(requiresTwoFactor(undefined)).toBe(false);
  });
});

describe('isAdminRoute — the enforcement boundary', () => {
  it.each([
    '/api/v1/admin/users',
    '/api/v1/admin/cashier/withdrawals/x/approve',
    '/admin/audit',
  ])('%s is an admin route', (p) => expect(isAdminRoute({ path: p })).toBe(true));

  it.each([
    '/api/v1/auth/2fa/setup',
    '/api/v1/auth/2fa/enable',
    '/api/v1/wallet-engine/balances',
    '/api/v1/games/dice/play',
    '/api/v1/notifications',
    '/api/v1/administration-notes',
  ])('%s is NOT an admin route', (p) => expect(isAdminRoute({ path: p })).toBe(false));
});

describe('AdminTwoFactorGuard', () => {
  it('BLOCKS an admin without 2FA from an admin route', async () => {
    const { g } = guard(false);
    await expect(g.canActivate(ctx({ id: 'a1', roles: ['admin'] }, '/api/v1/admin/users')))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('BLOCKS a super_admin without 2FA', async () => {
    const { g } = guard(false);
    await expect(g.canActivate(ctx({ id: 's1', roles: ['super_admin'] }, '/api/v1/admin/audit')))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ALLOWS an admin WITH 2FA enabled', async () => {
    const { g } = guard(true);
    await expect(g.canActivate(ctx({ id: 'a1', roles: ['admin'] }, '/api/v1/admin/users'))).resolves.toBe(true);
  });

  it('reads the flag from the DATABASE, not from the token', async () => {
    const { g, prisma } = guard(true);
    // The token lies — it claims 2FA is on. The guard must not consult it.
    await g.canActivate(ctx({ id: 'a1', roles: ['admin'], twoFactorEnabled: true }, '/api/v1/admin/users'));
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'a1' },
      select: { twoFactorEnabled: true },
    });
  });

  it('a spoofed twoFactorEnabled claim cannot bypass the guard', async () => {
    const { g } = guard(false); // the database says NO
    await expect(
      g.canActivate(ctx({ id: 'a1', roles: ['admin'], twoFactorEnabled: true }, '/api/v1/admin/users')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a PLAYER is never blocked, with or without 2FA', async () => {
    const { g, prisma } = guard(false);
    await expect(g.canActivate(ctx({ id: 'p1', roles: ['user'] }, '/api/v1/wallet-engine/balances'))).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled(); // not even a lookup for players
  });

  it('an admin without 2FA can still reach the ENROLMENT route (self-remedy path)', async () => {
    const { g } = guard(false);
    await expect(g.canActivate(ctx({ id: 'a1', roles: ['admin'] }, '/api/v1/auth/2fa/setup'))).resolves.toBe(true);
    await expect(g.canActivate(ctx({ id: 'a1', roles: ['admin'] }, '/api/v1/auth/2fa/enable'))).resolves.toBe(true);
  });

  it('an admin without 2FA can still use ordinary player surfaces', async () => {
    const { g } = guard(false);
    await expect(g.canActivate(ctx({ id: 'a1', roles: ['admin'] }, '/api/v1/notifications'))).resolves.toBe(true);
  });

  it('an unauthenticated request is left to JwtAuthGuard', async () => {
    const { g } = guard(false);
    await expect(g.canActivate(ctx(undefined, '/api/v1/admin/users'))).resolves.toBe(true);
  });

  it('a missing user row is treated as NOT having 2FA (fails closed)', async () => {
    const { g } = guard(null);
    await expect(g.canActivate(ctx({ id: 'ghost', roles: ['admin'] }, '/api/v1/admin/users')))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
