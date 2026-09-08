import { apiClient } from './api-client';

/**
 * Cashier API client (Phase 2C.9) — server-authoritative deposits & withdrawals (`/cashier/*`). The
 * amount is the only money field the client sends; balance, status, netAmount, transactionId and
 * approval are ALL server-derived. Deposits are PENDING until an operator completes them (no fake
 * gateway); withdrawals hold funds immediately. This path does NOT use the demo wallet.
 */

export type DepositStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type WithdrawalStatus = 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED' | 'FAILED';

export interface CashierConfig {
  minDeposit: number;
  maxDeposit: number;
  minWithdrawal: number;
  maxWithdrawal: number;
  currencies: string[];
  depositFeePct: number;
  withdrawalFeePct: number;
}

export interface DepositRequestView {
  id: string;
  kind: 'deposit';
  reference: string;
  amount: string;
  fee: string;
  netAmount: string;
  currencyId: string;
  status: DepositStatus;
  transactionId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WithdrawalRequestView {
  id: string;
  kind: 'withdrawal';
  reference: string;
  amount: string;
  fee: string;
  netAmount: string;
  currencyId: string;
  status: WithdrawalStatus;
  transactionId: string | null;
  rejectionReason: string | null;
  createdAt: string;
  completedAt: string | null;
  balanceAfter?: string;
}

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

/** A cryptographically-random idempotency key (falls back if crypto is unavailable). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export async function getCashierConfig(): Promise<CashierConfig> {
  const res = await apiClient.get('/cashier/config');
  return res.data.data as CashierConfig;
}

export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}

/** Build a deposit/withdrawal request body — the client sends ONLY amount/currency (+ optional method). */
export function buildCashierRequest(amount: string, currency = 'INR', method?: string) {
  return { amount, currency, method, idempotencyKey: newIdempotencyKey() };
}

export async function createDeposit(body: Record<string, unknown>): Promise<DepositRequestView> {
  const res = await apiClient.post('/cashier/deposits', body);
  return res.data.data as DepositRequestView;
}
export async function listDeposits(limit = 20): Promise<DepositRequestView[]> {
  const res = await apiClient.get(`/cashier/deposits?limit=${limit}`);
  return res.data.data as DepositRequestView[];
}
export async function createWithdrawal(body: Record<string, unknown>): Promise<WithdrawalRequestView> {
  const res = await apiClient.post('/cashier/withdrawals', body);
  return res.data.data as WithdrawalRequestView;
}
export async function listWithdrawals(limit = 20): Promise<WithdrawalRequestView[]> {
  const res = await apiClient.get(`/cashier/withdrawals?limit=${limit}`);
  return res.data.data as WithdrawalRequestView[];
}
export async function cancelWithdrawal(id: string): Promise<WithdrawalRequestView> {
  const res = await apiClient.post(`/cashier/withdrawals/${id}/cancel`, {});
  return res.data.data as WithdrawalRequestView;
}
