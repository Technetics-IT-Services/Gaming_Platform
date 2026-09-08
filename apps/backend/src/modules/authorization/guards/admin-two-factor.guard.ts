import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@gaming-platform/types';
import type { Request } from 'express';

import { PrismaService } from '../../database/prisma.service';

/**
 * Server-enforced two-factor authentication for privileged accounts (Phase 2D.2, Phase C).
 *
 * THE GAP THIS CLOSES. `TwoFactorService` is fully real (otplib TOTP, hashed single-use recovery
 * codes, Redis-backed single-use login challenge), and `AuthService.login` already forces the TOTP
 * challenge whenever `user.twoFactorEnabled` is true. But 2FA was entirely OPT-IN: an `admin` or
 * `super_admin` with `twoFactorEnabled = false` signed in with a password alone.
 *
 * HOW ENFORCEMENT WORKS, AND WHY IT IS REAL. This guard refuses every admin-scoped API request while
 * the calling account does not have 2FA enabled. Because the login flow already forces the challenge
 * for 2FA-enabled accounts, the consequence is that **every successful admin API call is backed by a
 * session that provably passed a second factor**. There is no client-controlled flag anywhere in this
 * decision: `twoFactorEnabled` is read fresh from the database on the server.
 *
 * WHY NOT REFUSE ADMIN LOGIN OUTRIGHT. That would instantly lock out every existing admin — including
 * the bootstrap super-admin — with no recovery path. Refusing at the API boundary instead leaves
 * `/auth/2fa/setup|enable` reachable so an admin can self-enrol, then immediately regain access.
 *
 * PLAYERS ARE UNAFFECTED. The guard only acts on principals holding an elevated role; every other
 * caller passes straight through. The client requirement asks for ADMIN 2FA, and forcing players
 * would be inventing policy.
 *
 * This runs AFTER `JwtAuthGuard` and alongside `PermissionsGuard` — it adds a requirement, it never
 * grants access. Backend permission guards remain the authority.
 */

/** Roles for which a second factor is mandatory. Mirrors `rbac.constants.ts` ROLE_DEFINITIONS. */
export const TWO_FACTOR_REQUIRED_ROLES = ['admin', 'super_admin'] as const;

/** True when this request targets the admin API boundary. */
export function isAdminRoute(req: { path?: string; originalUrl?: string; url?: string }): boolean {
  const path = req.path ?? req.originalUrl ?? req.url ?? '';
  return /(^|\/)admin(\/|$)/.test(path.split('?')[0] ?? '');
}

/** Pure decision, so it is directly unit-testable without a request context. */
export function requiresTwoFactor(roles: string[] | undefined): boolean {
  const held = roles ?? [];
  return TWO_FACTOR_REQUIRED_ROLES.some((r) => held.includes(r));
}

@Injectable()
export class AdminTwoFactorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = req.user;

    // Unauthenticated / public routes are JwtAuthGuard's business, not this guard's.
    if (!user?.id) return true;

    // Not privileged ⇒ no second-factor requirement. Players are never affected.
    if (!requiresTwoFactor(user.roles)) return true;

    // Scoped to ADMIN FUNCTIONS only. An administrator using ordinary player surfaces (their own
    // wallet, a game, /auth/2fa/setup to enrol) is not blocked — only the admin API boundary is.
    // Path-scoping rather than per-controller decoration means a future admin controller CANNOT
    // forget the requirement: this fails closed for anything under the admin prefix.
    if (!isAdminRoute(req)) return true;

    // Read the authoritative flag from the database — never from the token or the request.
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabled: true },
    });

    if (!row?.twoFactorEnabled) {
      throw new ForbiddenException(
        'Two-factor authentication is required for administrator accounts. ' +
          'Enable it at /auth/2fa/setup before using admin functions.',
      );
    }
    return true;
  }
}
