import { apiClient, unwrap } from './api-client';

/**
 * Finance operations client (Phase 2D.10) — F-01 queues, F-06 cash flow, F-07 search and failures.
 *
 * READ-ONLY. There is no mutation call here at all: reviewing money is not the same authority as
 * moving it, and deposit/withdrawal decisions stay on the operator cashier surface.
 *
 * Every monetary figure is PER CURRENCY. There is no consolidated total field anywhere, because
 * there is no FX source — and no `revenue` or `profit` field, because neither is defined.
 */

export interface UnavailableMetric {
  metric: string;
  reason: string;
}

export interface ReviewQueues {
  pendingDeposits: number;
  pendingWithdrawals: number;
  withdrawalsUnderReview: number;
  withdrawalsApprovedAwaitingPayment: number;
  note: string;
}

export interface CurrencyMovement {
  currency: string;
  /** Decimal strings. Never floats, never summed across currencies. */
  moneyIn: string;
  moneyOut: string;
  netMovement: string;
  depositCount: number;
  withdrawalCount: number;
}

export interface CashFlow {
  from: string;
  to: string;
  /** The server's own statement of what these figures mean. Rendered, never paraphrased. */
  definition: string;
  byCurrency: CurrencyMovement[];
  unavailable: UnavailableMetric[];
}

export interface TransactionRow {
  id: string;
  userId: string;
  username: string;
  type: string;
  status: string;
  currency: string;
  amount: string;
  balanceAfter: string | null;
  reference: string | null;
  description: string | null;
  createdAt: string;
}

export interface TransactionPage {
  items: TransactionRow[];
  total: number;
  page: number;
  limit: number;
  unavailable: UnavailableMetric[];
}

export interface FailureReport {
  from: string;
  to: string;
  failedDeposits: { id: string; username: string; currency: string; amount: string; status: string; reference: string | null; createdAt: string }[];
  failedWithdrawals: { id: string; username: string; currency: string; amount: string; status: string; reference: string | null; createdAt: string }[];
  failedRounds: { status: string; gameKey: string; count: number }[];
  /** Why `wallet_transactions` is not the source of this view. Shown to the operator. */
  ledgerNote: string;
}

export interface CashierQueueItem {
  id: string;
  userId: string;
  username: string;
  currency: string;
  /** Decimal strings, per request, in that request's own currency. Never summed. */
  amount: string;
  netAmount: string;
  status: string;
  reference: string;
  requestedAt: string;
  rejectionReason?: string | null;
  approvedAt?: string | null;
}

export interface CashierQueue {
  kind: 'deposits' | 'withdrawals';
  statuses: string[];
  /** Always returned so the console can show how much work exists beyond this page. */
  total: number;
  page: number;
  limit: number;
  items: CashierQueueItem[];
  /** The server's own statement of what acting on an entry does. Rendered, never paraphrased. */
  note: string;
}

export interface TransactionFilters {
  userId?: string;
  typeCode?: string;
  statusCode?: string;
  currencyCode?: string;
  reference?: string;
  minAmount?: string;
  maxAmount?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

const qs = (params: Record<string, unknown> | TransactionFilters | { from?: string; to?: string; limit?: number }): string => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const financeOpsApi = {
  queues: () => unwrap<ReviewQueues>(apiClient.get('/admin/finance/queues')),
  /** The work queue. Reading needs `transactions:read`; acting needs `wallets:adjust`. */
  cashierQueue: (f: { kind?: 'deposits' | 'withdrawals'; status?: string; page?: number; limit?: number } = {}) =>
    unwrap<CashierQueue>(apiClient.get(`/admin/finance/cashier/queue${qs(f)}`)),
  cashFlow: (f: { from?: string; to?: string } = {}) =>
    unwrap<CashFlow>(apiClient.get(`/admin/finance/cash-flow${qs(f)}`)),
  transactions: (f: TransactionFilters = {}) =>
    unwrap<TransactionPage>(apiClient.get(`/admin/finance/transactions${qs(f)}`)),
  failures: (f: { from?: string; to?: string; limit?: number } = {}) =>
    unwrap<FailureReport>(apiClient.get(`/admin/finance/failures${qs(f)}`)),
};
