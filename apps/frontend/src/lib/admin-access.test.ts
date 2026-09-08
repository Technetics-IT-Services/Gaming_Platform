import { describe, expect, it } from 'vitest';

import { ADMIN_CONSOLE_ROLES, canAccessAdminConsole } from './admin-access';

/**
 * Phase 2C.17 — P0-2. `/admin/*` was wrapped in `AuthGuard` alone, which only proves AUTHENTICATION,
 * so any signed-in player could load the admin console shell. `canAccessAdminConsole` is the pure
 * decision the guard renders on; the backend permission guards remain the authority for every request
 * the console makes, and nothing here can grant access to data.
 *
 * Role slugs mirror `apps/backend/src/modules/authorization/rbac.constants.ts` ROLE_DEFINITIONS:
 * user, vip, moderator, admin, super_admin. There is deliberately no `partner`/`finance` role yet —
 * those cases are covered by default-deny below and must be re-tested when the roles exist.
 */

const user = (roles: string[]) => ({ roles });

describe('admin console access decision', () => {
  it('ADMIN is allowed', () => {
    expect(canAccessAdminConsole(user(['admin']), false)).toBe(true);
  });

  it('SUPER_ADMIN is allowed', () => {
    expect(canAccessAdminConsole(user(['super_admin']), false)).toBe(true);
  });

  it('a plain PLAYER is denied', () => {
    expect(canAccessAdminConsole(user(['user']), false)).toBe(false);
  });

  it('VIP and MODERATOR are denied the admin console', () => {
    expect(canAccessAdminConsole(user(['vip']), false)).toBe(false);
    expect(canAccessAdminConsole(user(['moderator']), false)).toBe(false);
  });

  it('an unknown/future role (e.g. partner, finance) is denied by DEFAULT-DENY', () => {
    expect(canAccessAdminConsole(user(['partner']), false)).toBe(false);
    expect(canAccessAdminConsole(user(['finance']), false)).toBe(false);
    expect(canAccessAdminConsole(user(['partner', 'vip']), false)).toBe(false);
  });

  it('an unauthenticated / unknown user is denied', () => {
    expect(canAccessAdminConsole(null, false)).toBe(false);
    expect(canAccessAdminConsole(user([]), false)).toBe(false);
    expect(canAccessAdminConsole({}, false)).toBe(false);
  });

  it('a DEMO session is denied even if it somehow claims an admin role', () => {
    // A demo session has no backend principal; its claims are client-side fiction.
    expect(canAccessAdminConsole(user(['admin']), true)).toBe(false);
    expect(canAccessAdminConsole(user(['super_admin']), true)).toBe(false);
  });

  it('a user holding admin among several roles is allowed', () => {
    expect(canAccessAdminConsole(user(['user', 'vip', 'admin']), false)).toBe(true);
  });

  it('only admin and super_admin are console roles', () => {
    expect([...ADMIN_CONSOLE_ROLES]).toEqual(['admin', 'super_admin']);
  });
});
