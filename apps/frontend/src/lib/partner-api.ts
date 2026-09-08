import { apiClient, unwrap } from './api-client';

/**
 * Partner API client (Phase 2D.4, PA-01).
 *
 * Types are derived from the REAL backend DTOs, deliberately **not** from `src/lib/partners/` — that
 * orphaned library encodes invented commission models (CPA / RevShare / Hybrid / Tiered) that no
 * requirement specifies, and reusing even its types would smuggle those semantics in.
 *
 * `revenueSharePercent` is a decimal STRING and a **share, not an amount** — it has no currency. It
 * is rendered exactly as received; the client never parses or computes it.
 */

export type PartnerStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';

export const PARTNER_STATUSES: PartnerStatus[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED'];

export interface PartnerView {
  id: string;
  code: string;
  name: string;
  status: PartnerStatus;
  /** Decimal string, 0–100. A share, NOT money. */
  revenueSharePercent: string;
  memberCount: number;
  createdAt: string;
}

/** A figure the platform cannot produce, with the reason. Rendered instead of a number. */
export interface UnavailableMetric {
  metric: string;
  reason: string;
}

export interface PartnerDashboard {
  partner: PartnerView;
  unavailable: UnavailableMetric[];
}

export interface PartnerMember {
  userId: string;
  username: string;
  status: string;
  isPrimary: boolean;
  joinedAt: string;
}

export interface PartnerList {
  items: PartnerView[];
  total: number;
  page: number;
  limit: number;
  /** Server-computed. The client never sums shares itself. */
  allocation: {
    allocatedPercent: string;
    unallocatedPercent: string;
    note: string;
  };
}

/**
 * A partner's own activity report (PA-07).
 *
 * Recorded changes to the partner's OWN organisation. There is deliberately no monetary column:
 * partner revenue, profit and balance stay blocked on the missing revenue definition, and the
 * server repeats those reasons in `unavailable`.
 *
 * The acting operator's identity is withheld by the server — a partner learns WHAT changed, not
 * which staff account did it.
 */
export interface PartnerActivityReport {
  partner: PartnerView;
  from: string;
  to: string;
  events: { at: string; action: string; changed: string[]; summary: string }[];
  /** True when more rows exist than were returned — stated, never silently dropped. */
  truncated: boolean;
  unavailable: UnavailableMetric[];
}

/** A partner's own view. No route takes a partner id — the server resolves it from the session. */
export const partnerApi = {
  me: () => unwrap<PartnerView>(apiClient.get('/partner')),
  dashboard: () => unwrap<PartnerDashboard>(apiClient.get('/partner/dashboard')),
  /** The caller's own colleagues. Usernames only — the server returns no user ids. */
  members: () => unwrap<{ username: string; isPrimary: boolean; joinedAt: string }[]>(
    apiClient.get('/partner/members'),
  ),
  report: (params: { from?: string; to?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && q.set(k, String(v)));
    const s = q.toString();
    return unwrap<PartnerActivityReport>(apiClient.get(`/partner/report${s ? `?${s}` : ''}`));
  },
};

/** Operator administration. Read needs `partners:read`; every write needs `partners:write`. */
export const adminPartnerApi = {
  list: (params: { status?: PartnerStatus; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && q.set(k, String(v)));
    const s = q.toString();
    return unwrap<PartnerList>(apiClient.get(`/admin/partners${s ? `?${s}` : ''}`));
  },

  get: (id: string) => unwrap<PartnerView>(apiClient.get(`/admin/partners/${id}`)),

  members: (id: string) => unwrap<PartnerMember[]>(apiClient.get(`/admin/partners/${id}/members`)),

  /** The server generates the code and forces PENDING; neither may be sent. */
  create: (input: { name: string; revenueSharePercent?: string; notes?: string }) =>
    unwrap<PartnerView>(apiClient.post('/admin/partners', input)),

  setShare: (id: string, percent: string) =>
    unwrap<PartnerView>(apiClient.post(`/admin/partners/${id}/share`, { percent })),

  setStatus: (id: string, status: PartnerStatus) =>
    unwrap<PartnerView>(apiClient.post(`/admin/partners/${id}/status`, { status })),

  addMember: (id: string, userId: string, isPrimary = false) =>
    unwrap<PartnerView>(
      apiClient.post(`/admin/partners/${id}/members`, { userId, isPrimary: isPrimary ? 'true' : 'false' }),
    ),
};
