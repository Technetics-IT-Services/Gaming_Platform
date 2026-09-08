import { apiClient, unwrap } from './api-client';

/**
 * Referral client (P-17) — ATTRIBUTION ONLY.
 *
 * Qualification and reward are blocked on missing business definitions, so this client has no
 * earnings, balance or reward field. The server sends an `unavailable[]` list with the reason, and
 * the UI shows that instead of a zero.
 *
 * No route takes a user id: the server scopes everything to the authenticated caller.
 */

export type ReferralStatus = 'PENDING' | 'QUALIFIED' | 'REWARDED' | 'EXPIRED' | 'CANCELLED';

export interface ReferralRow {
  id: string;
  referredUsername: string;
  status: ReferralStatus;
  createdAt: string;
  qualifiedAt: string | null;
  rewardedAt: string | null;
}

export interface MyReferralSummary {
  code: string | null;
  totalReferred: number;
  referrals: ReferralRow[];
  referredBy: { username: string; since: string } | null;
  unavailable: { metric: string; reason: string }[];
}

export const referralApi = {
  me: () => unwrap<MyReferralSummary>(apiClient.get('/referral')),
  claim: (code: string) =>
    unwrap<{ referredBy: string; status: ReferralStatus; alreadyClaimed: boolean }>(
      apiClient.post('/referral/claim', { code }),
    ),
};
