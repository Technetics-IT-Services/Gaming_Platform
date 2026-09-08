import { apiClient, unwrap } from './api-client';

/**
 * Operator oversight clients (Phase 2D.13) — the last three guarded surfaces without a frontend.
 *
 *   `adminAuditApi`            AD-12 — browse the audit trail
 *   `adminResponsibleGamingApi` P-10 — inspect a player's limits, lift a restriction
 *   `adminReferralsApi`         P-17 — read referral relationships
 *
 * All three are READ-first. The single mutation (lifting a restriction) is audited and attributed
 * server-side, and there is no route here that creates a limit on a player's behalf: a player sets
 * their own responsible-gaming limits, and an operator may only lift a restriction early — never
 * tighten or invent one.
 */

/* ------------------------------------------------------------- AD-12 audit */

export interface AuditRow {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: unknown;
  ipAddress?: string | null;
  createdAt: string;
}

export interface AuditPage {
  items: AuditRow[];
  meta?: { page: number; limit: number; total: number; totalPages: number };
  total?: number;
  page?: number;
  limit?: number;
}

const qs = (params: Record<string, unknown>): string => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const adminAuditApi = {
  /** Guarded by `audit:read`. Filterable by entity type and by the acting user. */
  list: (params: { page?: number; limit?: number; entityType?: string; userId?: string } = {}) =>
    unwrap<AuditPage>(apiClient.get(`/admin/audit${qs(params)}`)),
};

/* -------------------------------------------------- P-10 responsible gaming */

export interface RgLimit {
  id: string;
  type: string;
  period: string;
  /** Decimal string in the player's own currency. */
  amount: string;
  currency?: string;
  effectiveFrom?: string | null;
  createdAt: string;
}

export interface RgRestriction {
  id: string;
  type: string;
  status: string;
  reason?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  createdAt: string;
}

export interface RgPlayerView {
  limits: RgLimit[];
  restrictions: RgRestriction[];
  [key: string]: unknown;
}

export const adminResponsibleGamingApi = {
  /** Guarded by `users:lock`. Read-only view of one player's self-imposed limits. */
  forUser: (userId: string) =>
    unwrap<RgPlayerView>(apiClient.get(`/admin/responsible-gaming/users/${userId}`)),

  /**
   * Lift a restriction early. Audited and attributed to the operator.
   *
   * There is deliberately no "add restriction" or "raise limit" call: limits belong to the player,
   * and an operator relaxing protection is the only direction that needs an operator at all.
   */
  liftRestriction: (id: string, reason: string) =>
    unwrap<unknown>(apiClient.post(`/admin/responsible-gaming/restrictions/${id}/lift`, { reason })),
};

/* ------------------------------------------------------------ P-17 referrals */

export interface ReferralAdminRow {
  id: string;
  referrer: { userId: string; username: string };
  referred: { userId: string; username: string };
  status: string;
  createdAt: string;
}

export interface ReferralAdminPage {
  items: ReferralAdminRow[];
  total: number;
  page: number;
  limit: number;
  /** Reward figures remain blocked on a client decision; the reason is carried here. */
  unavailable?: { metric: string; reason: string }[];
}

export const adminReferralsApi = {
  /** Guarded by `users:read`. Read-only — no route awards or adjusts a referral. */
  list: (params: { status?: string; page?: number; limit?: number } = {}) =>
    unwrap<ReferralAdminPage>(apiClient.get(`/admin/referrals${qs(params)}`)),
};
