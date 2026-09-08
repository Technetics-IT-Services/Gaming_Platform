/**
 * Partner-portal access, for the CLIENT SHELL ONLY.
 *
 * This decides whether to paint the partner interface. It never grants access to data: every
 * partner request is independently re-authorized by the backend, which was verified live (a player,
 * a moderator and a partner reaching another partner's resources all receive 403).
 *
 * Keyed on the PERMISSION rather than the role, unlike `canAccessAdminConsole`, because
 * `partners:read_own` is exactly what the backend controller requires. Checking the same fact the
 * server checks means the shell and the API can never disagree about who is a partner.
 *
 * `roles` / `permissions` here are backend-resolved (RbacService flattens them from the database
 * into the session payload) — they are not client assertions.
 */

export const PARTNER_READ_OWN = 'partners:read_own';
export const PARTNERS_READ = 'partners:read';
export const PARTNERS_WRITE = 'partners:write';

function has(user: { permissions?: string[] } | null | undefined, permission: string): boolean {
  return (user?.permissions ?? []).includes(permission);
}

/** May this principal open the partner portal (`/partner`)? */
export function canAccessPartnerPortal(
  user: { permissions?: string[] } | null | undefined,
  isDemoSession: boolean,
): boolean {
  // A demo session has no backend principal at all, so it is never a partner.
  if (isDemoSession) return false;
  return has(user, PARTNER_READ_OWN);
}

/** May this principal open the operator partner administration screen? */
export function canReadPartnerAdmin(
  user: { permissions?: string[] } | null | undefined,
  isDemoSession: boolean,
): boolean {
  if (isDemoSession) return false;
  return has(user, PARTNERS_READ);
}

/**
 * May this principal MUTATE partners (create, set share, set status, add members)?
 *
 * Held by `super_admin` only. An `admin` gets read-only, and the server refuses their writes
 * regardless of what the UI shows.
 */
export function canWritePartners(
  user: { permissions?: string[] } | null | undefined,
  isDemoSession: boolean,
): boolean {
  if (isDemoSession) return false;
  return has(user, PARTNERS_WRITE);
}
