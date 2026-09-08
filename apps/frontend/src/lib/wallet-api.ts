import { apiClient, unwrap } from './api-client';

export interface WalletView {
  id: string;
  userId: string;
  currencyId: string;
  type: string;
  status: string;
  available: string;
  locked: string;
  pending: string;
  total: string;
  version: number;
}

export interface BalanceSummary {
  wallets: WalletView[];
  totalsByCurrency: Record<string, string>;
}

export interface TransactionView {
  id: string;
  reference: string;
  type: string;
  status: string;
  amount: string;
  balanceAfter: string;
  description: string | null;
  createdAt: string;
}

export interface TransactionPage {
  items: TransactionView[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface BonusWallet {
  id: string;
  currencyId: string;
  balance: string;
  wageringRequirement: string;
  wageringProgress: string;
  status: string;
  expiresAt: string | null;
}

export interface RewardWallet {
  id: string;
  pointsBalance: string;
  tierMultiplier: string;
  status: string;
}

/** A server-authoritative wallet-history row. balanceBefore/After are STORED values, never derived. */
export interface WalletHistoryItem {
  id: string;
  type: string;
  status: string;
  amount: string;
  fee: string;
  balanceBefore: string;
  balanceAfter: string;
  currency: string;
  reference: string;
  description: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface WalletHistoryPage {
  items: WalletHistoryItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface WalletHistoryFilters {
  page?: number;
  limit?: number;
  type?: string;
  status?: string;
  currency?: string;
  from?: string;
  to?: string;
}

export const walletApi = {
  balances: () => unwrap<BalanceSummary>(apiClient.get('/wallet-engine/balances')),
  transactions: (params: { page?: number; limit?: number; type?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, String(v)));
    const qs = q.toString();
    return unwrap<TransactionPage>(apiClient.get(`/wallet-engine/transactions${qs ? `?${qs}` : ''}`));
  },
  /** Server-authoritative wallet transaction history (Phase 2C.4). userId comes from the JWT. */
  history: (params: WalletHistoryFilters = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, String(v)));
    const qs = q.toString();
    return unwrap<WalletHistoryPage>(apiClient.get(`/wallet/history${qs ? `?${qs}` : ''}`));
  },
  transfer: (data: { currencyId: string; fromType: string; toType: string; amount: string }) =>
    unwrap<{ from: WalletView; to: WalletView }>(apiClient.post('/wallet-engine/transfer', data)),
  bonus: () => unwrap<BonusWallet[]>(apiClient.get('/wallet-engine/bonus')),
  convertBonus: (id: string) =>
    unwrap<{ converted: string; wallet: WalletView }>(apiClient.post(`/wallet-engine/bonus/${id}/convert`, {})),
  reward: () => unwrap<RewardWallet>(apiClient.get('/wallet-engine/reward')),
  redeem: (points: string) =>
    unwrap<RewardWallet>(apiClient.post('/wallet-engine/reward/redeem', { points })),
};

// ---- Admin -----------------------------------------------------------------

export interface WalletStatistics {
  wallets: number;
  available: string;
  locked: string;
  pending: string;
  total: string;
}

export interface RevenueReport {
  windowHours: number;
  bets: string;
  wins: string;
  deposits: string;
  withdrawals: string;
  bonuses: string;
  houseProfit: string;
  playerProfit: string;
  rtp: string;
  cashFlow: string;
}

export const adminWalletApi = {
  statistics: () => unwrap<WalletStatistics>(apiClient.get('/admin/wallet/statistics')),
  overview: (hours = 24) => unwrap<RevenueReport>(apiClient.get(`/admin/wallet/reports/overview?hours=${hours}`)),
  reconcile: () =>
    unwrap<{ debit: string; credit: string; balanced: boolean; difference: string }>(
      apiClient.get('/admin/wallet/reconcile'),
    ),
  userWallets: (userId: string) => unwrap<WalletView[]>(apiClient.get(`/admin/wallet/users/${userId}/wallets`)),
  userTransactions: (userId: string) =>
    unwrap<TransactionPage>(apiClient.get(`/admin/wallet/users/${userId}/transactions`)),
  credit: (data: { userId: string; currencyId: string; amount: string; reason?: string }) =>
    unwrap<unknown>(apiClient.post('/admin/wallet/credit', data)),
  debit: (data: { userId: string; currencyId: string; amount: string; reason?: string }) =>
    unwrap<unknown>(apiClient.post('/admin/wallet/debit', data)),
  freeze: (walletId: string) => unwrap<unknown>(apiClient.post('/admin/wallet/freeze', { walletId })),
  unfreeze: (walletId: string) => unwrap<unknown>(apiClient.post('/admin/wallet/unfreeze', { walletId })),
  rollback: (transactionId: string) =>
    unwrap<unknown>(apiClient.post('/admin/wallet/rollback', { transactionId })),
};
