import { apiClient, unwrap } from './api-client';

/**
 * Promotions client (AD-08) — CONFIGURATION ONLY.
 *
 * A promotion here is a published offer. Awarding is blocked on a missing business rule, so there is
 * no award amount, no claim call and no earned state. The server states that in `unavailable[]`.
 */

export type PromotionStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'ENDED';
export type PromotionType =
  | 'DEPOSIT_BONUS' | 'NO_DEPOSIT_BONUS' | 'FREE_SPINS' | 'CASHBACK'
  | 'RELOAD' | 'REFERRAL' | 'LOYALTY' | 'TOURNAMENT';

export const PROMOTION_STATUSES: PromotionStatus[] = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'ENDED'];
export const PROMOTION_TYPES: PromotionType[] = [
  'DEPOSIT_BONUS', 'NO_DEPOSIT_BONUS', 'FREE_SPINS', 'CASHBACK', 'RELOAD', 'REFERRAL', 'LOYALTY', 'TOURNAMENT',
];

export interface Promotion {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: PromotionType;
  status: PromotionStatus;
  priority: number;
  maxRedemptions: number | null;
  currentRedemptions: number;
  startsAt: string | null;
  endsAt: string | null;
  terms: unknown;
  createdAt: string;
}

export interface PromotionPage {
  items: Promotion[];
  total: number;
  page: number;
  limit: number;
  unavailable: { metric: string; reason: string }[];
}

export const promotionsApi = {
  /** Genuinely active, in-window offers. Never a hardcoded list. */
  active: () => unwrap<{ items: Promotion[]; unavailable: { metric: string; reason: string }[] }>(
    apiClient.get('/promotions'),
  ),
};

export const adminPromotionsApi = {
  list: (params: { status?: PromotionStatus; type?: PromotionType; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && q.set(k, String(v)));
    const s = q.toString();
    return unwrap<PromotionPage>(apiClient.get(`/admin/promotions${s ? `?${s}` : ''}`));
  },
  create: (input: {
    code: string; name: string; type: PromotionType;
    description?: string; startsAt?: string; endsAt?: string; maxRedemptions?: number;
  }) => unwrap<Promotion>(apiClient.post('/admin/promotions', input)),
  setStatus: (id: string, status: PromotionStatus) =>
    unwrap<Promotion>(apiClient.post(`/admin/promotions/${id}/status`, { status })),
  update: (id: string, input: { name?: string; description?: string; maxRedemptions?: number }) =>
    unwrap<Promotion>(apiClient.post(`/admin/promotions/${id}/update`, input)),
};
