import { apiClient, unwrap } from './api-client';

/**
 * Responsible gaming API client.
 *
 * Every value here is SERVER state. Limits and restrictions are enforced by the backend before any
 * money or game action, so this client only reads and writes that state — it never enforces
 * anything itself, and the UI must never present a client-side check as protection.
 *
 * No route takes a user id: the server always scopes to the authenticated caller.
 */

export const LIMIT_TYPES = ['DEPOSIT', 'WAGER', 'LOSS'] as const;
export const LIMIT_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;

export type LimitType = (typeof LIMIT_TYPES)[number];
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];
export type RestrictionType = 'SELF_EXCLUSION' | 'COOLING_OFF';

export interface LimitUsage {
  type: LimitType;
  period: LimitPeriod;
  currency: string;
  /** Decimal strings — never floats, never converted between currencies. */
  limit: string;
  used: string;
  remaining: string;
  windowStart: string;
}

export interface Restriction {
  id: string;
  type: RestrictionType;
  status: 'ACTIVE' | 'EXPIRED' | 'LIFTED';
  startsAt: string;
  endsAt: string | null;
  reason: string | null;
}

export interface RgOverview {
  limits: LimitUsage[];
  restrictions: Restriction[];
}

export const responsibleGamingApi = {
  overview: () => unwrap<RgOverview>(apiClient.get('/responsible-gaming')),

  setLimit: (input: { type: LimitType; period: LimitPeriod; amount: string; currency: string }) =>
    unwrap<{ type: LimitType; period: LimitPeriod; amount: string; currency: string; effectiveFrom: string }>(
      apiClient.post('/responsible-gaming/limits', input),
    ),

  removeLimit: (input: { type: LimitType; period: LimitPeriod; currency: string }) =>
    unwrap<{ removed: boolean }>(
      apiClient.delete(
        `/responsible-gaming/limits?type=${input.type}&period=${input.period}&currency=${input.currency}`,
      ),
    ),

  /** Self-exclude (omit `endsAt` for indefinite) or start a cooling-off period. */
  createRestriction: (input: { type: RestrictionType; endsAt?: string; reason?: string }) =>
    unwrap<Restriction>(apiClient.post('/responsible-gaming/restrictions', input)),

  restrictions: () => unwrap<Restriction[]>(apiClient.get('/responsible-gaming/restrictions')),
};
