import { apiClient, unwrap } from './api-client';

/**
 * Operator user administration client (Phase 2D.12, AD-02).
 *
 * Ten guarded backend routes existed with no frontend at all, so an operator could not lock an
 * abusive account, assign a role or revoke a stolen session inside the product.
 *
 * PERMISSIONS ARE SPLIT, and the UI mirrors that split rather than assuming one "admin" level:
 *   `users:read`   — list, detail, sessions, security events
 *   `users:lock`   — lock / unlock
 *   `users:verify` — manually verify an email
 *   `roles:assign` — grant / revoke a role
 *
 * No route accepts a status, role name or verification flag as free text: a role is addressed by
 * its id, and lock/unlock/verify are distinct endpoints rather than a client-supplied state.
 */

export interface AdminUserSummary {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  status: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  roles: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface AdminUserPage {
  items: AdminUserSummary[];
  meta: PaginationMeta;
}

export interface SessionSummary {
  id: string;
  createdAt?: string;
  lastActivityAt?: string | null;
  ipAddress?: string | null;
  [key: string]: unknown;
}

export interface SecurityEventSummary {
  id: string;
  type?: string;
  createdAt?: string;
  [key: string]: unknown;
}

const qs = (params: Record<string, unknown>): string => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const adminUsersApi = {
  list: (params: { page?: number; limit?: number; search?: string } = {}) =>
    unwrap<AdminUserPage>(apiClient.get(`/admin/users${qs(params)}`)),

  get: (id: string) => unwrap<Record<string, unknown>>(apiClient.get(`/admin/users/${id}`)),

  /** Suspend an account. The reason is recorded in the security log. */
  lock: (id: string, reason?: string) =>
    unwrap<unknown>(apiClient.post(`/admin/users/${id}/lock`, reason ? { reason } : {})),

  unlock: (id: string) => unwrap<unknown>(apiClient.post(`/admin/users/${id}/unlock`, {})),

  /** Manually mark an email verified — needed while no SMTP provider is configured. */
  verifyEmail: (id: string) => unwrap<unknown>(apiClient.post(`/admin/users/${id}/verify`, {})),

  /** A role is addressed by ID, never by a client-supplied name. */
  assignRole: (id: string, roleId: string) =>
    unwrap<unknown>(apiClient.post(`/admin/users/${id}/roles`, { roleId })),

  removeRole: (id: string, roleId: string) =>
    unwrap<unknown>(apiClient.delete(`/admin/users/${id}/roles/${roleId}`)),

  sessions: (id: string) => unwrap<SessionSummary[]>(apiClient.get(`/admin/users/${id}/sessions`)),

  /** Revoke every session for this user — the response to a compromised account. */
  revokeSessions: (id: string) => unwrap<unknown>(apiClient.delete(`/admin/users/${id}/sessions`)),

  securityEvents: (id: string) =>
    unwrap<SecurityEventSummary[]>(apiClient.get(`/admin/users/${id}/security-events`)),
};
