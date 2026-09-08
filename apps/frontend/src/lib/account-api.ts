import { apiClient } from './api-client';

/**
 * Account API client (Phase 2C.10). Read-only player verification status — REAL backend state
 * (email/phone flags + latest KYC record). Profile/security/session data reuse the existing `authApi`;
 * this module adds only the verification read. No demo/mock state; identity is the authenticated
 * session.
 */

export interface VerificationStatus {
  email: { verified: boolean };
  phone: { hasPhone: boolean; verified: boolean };
  identity: { available: boolean; status: string; level: string | null; submittedAt: string | null; reviewedAt: string | null };
}

export async function getVerification(): Promise<VerificationStatus> {
  const res = await apiClient.get('/users/me/verification');
  return res.data.data as VerificationStatus;
}

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

/** The authenticated user's MAIN wallet balance (server-authoritative). */
export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}
