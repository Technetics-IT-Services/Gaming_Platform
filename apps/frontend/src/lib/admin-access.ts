/**
 * Admin-console access decision (Phase 2C.17, P0-2).
 *
 * Kept as a pure, dependency-free module so it can be reasoned about and tested on its own — the
 * React guard in `components/auth/admin-guard.tsx` only renders what this decides.
 *
 * THIS IS NOT A SECURITY BOUNDARY ON ITS OWN. The backend is the authority: `JwtAuthGuard`,
 * `RolesGuard` and `PermissionsGuard` are global `APP_GUARD`s and every admin controller carries
 * `@RequirePermissions`. This function exists to stop the console being PAINTED for someone who is
 * not entitled to it (information disclosure + defence in depth), never to grant access to data.
 *
 * `roles` here are backend-resolved: `RbacService` flattens them from the database into the session
 * payload, so they are not client assertions — but they are still re-verified server-side on every
 * request.
 */

/** Role slugs entitled to the admin console. Mirrors `rbac.constants.ts` ROLE_DEFINITIONS. */
export const ADMIN_CONSOLE_ROLES = ['admin', 'super_admin'] as const;

/**
 * Default-deny: only an explicitly listed role passes. A demo session never passes — it has no
 * backend principal, so any role it appears to hold is client-side fiction.
 */
export function canAccessAdminConsole(
  user: { roles?: string[] } | null | undefined,
  isDemoSession: boolean,
): boolean {
  if (isDemoSession) return false;
  const roles = user?.roles ?? [];
  return ADMIN_CONSOLE_ROLES.some((r) => roles.includes(r));
}
