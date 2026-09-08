import { apiClient, unwrap } from './api-client';

/**
 * Operator bonus administration client (Phase 2D.10, AD-07).
 *
 * A grant always names the recipient explicitly — there is no self-service variant and no
 * `userId`-less call, so a bonus can never be granted implicitly "to me".
 *
 * `amount` and `wageringRequirement` are decimal STRINGS supplied by the operator. The client
 * neither computes nor defaults them: no eligibility rule, no automatic award and no suggested
 * figure exists anywhere in this file.
 */

export type BonusStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | 'FROZEN';

export interface BonusView {
  id: string;
  userId: string;
  username: string;
  currency: string;
  balance: string;
  wageringRequirement: string;
  wageringProgress: string;
  status: BonusStatus;
  expiresAt: string | null;
  createdAt: string;
}

export interface BonusPage {
  items: BonusView[];
  total: number;
  page: number;
  limit: number;
  /** Why nothing is awarded automatically. Rendered, never a zero. */
  unavailable: { metric: string; reason: string }[];
}

export interface GrantBonusInput {
  userId: string;
  currencyCode: string;
  amount: string;
  wageringRequirement?: string;
  expiresAt?: string;
  /** The operator's idempotency anchor — replaying it returns the first grant, never a second. */
  reference: string;
  reason: string;
}

export const bonusAdminApi = {
  list: (params: { userId?: string; status?: BonusStatus; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, String(v)));
    const s = q.toString();
    return unwrap<BonusPage>(apiClient.get(`/admin/bonuses${s ? `?${s}` : ''}`));
  },

  grant: (input: GrantBonusInput) => unwrap<BonusView>(apiClient.post('/admin/bonuses', input)),

  expire: (id: string, reason: string) =>
    unwrap<BonusView>(apiClient.post(`/admin/bonuses/${id}/expire`, { reason })),
};
