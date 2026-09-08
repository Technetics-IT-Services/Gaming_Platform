import { apiClient, unwrap } from './api-client';

/**
 * Operating expenses client (Phase 2D.12, F-03).
 *
 * The backend has been complete since Phase 2D.5 — Decimal amounts, per-currency, a
 * DRAFT → CONFIRMED → VOID lifecycle, duplicate-reference protection and full audit — but it had no
 * frontend, so finance staff could not record a single expense inside the product.
 *
 * TWO PROPERTIES THIS CLIENT PRESERVES:
 *
 *   1. **An expense is accounting data, not player money.** The service creates no ledger entry and
 *      touches no wallet. Recording what the business spent is not moving a player's funds.
 *   2. **Amounts are decimal STRINGS**, never JavaScript numbers, so precision cannot be lost in
 *      transport. The category chart of accounts is the client's own — codes and names are
 *      operator-entered, never invented here.
 *
 * `totals` deliberately returns expense sums only. Profit needs the revenue definition that remains
 * a client decision, and the server declares that rather than implying a figure.
 */

export type ExpenseStatus = 'DRAFT' | 'CONFIRMED' | 'VOID';

export const EXPENSE_STATUSES: ExpenseStatus[] = ['DRAFT', 'CONFIRMED', 'VOID'];

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
}

export interface Expense {
  id: string;
  categoryId: string;
  categoryName?: string;
  categoryCode?: string;
  description: string;
  /** Decimal string in its own currency. Never summed across currencies. */
  amount: string;
  currency: string;
  incurredOn: string;
  status: ExpenseStatus;
  reference?: string | null;
  createdAt: string;
}

export interface ExpensePage {
  items: Expense[];
  total: number;
  page: number;
  limit: number;
}

export interface ExpenseTotals {
  /** Per currency — there is no FX source, so these are never combined. */
  byCurrency: { currency: string; total: string; count: number }[];
  /** What the platform cannot produce, with the reason. Rendered instead of a fabricated profit. */
  unavailable: { metric: string; reason: string }[];
}

export interface CreateExpenseInput {
  categoryId: string;
  description: string;
  /** Decimal string, e.g. "1250.00". */
  amount: string;
  currency: string;
  /** YYYY-MM-DD. */
  incurredOn: string;
  reference?: string;
}

const qs = (params: Record<string, unknown>): string => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const expensesApi = {
  categories: () => unwrap<ExpenseCategory[]>(apiClient.get('/admin/finance/expenses/categories')),

  createCategory: (input: { code: string; name: string }) =>
    unwrap<ExpenseCategory>(apiClient.post('/admin/finance/expenses/categories', input)),

  list: (params: {
    status?: ExpenseStatus; categoryId?: string; currency?: string;
    from?: string; to?: string; page?: number; limit?: number;
  } = {}) => unwrap<ExpensePage>(apiClient.get(`/admin/finance/expenses${qs(params)}`)),

  totals: (params: { from?: string; to?: string } = {}) =>
    unwrap<ExpenseTotals>(apiClient.get(`/admin/finance/expenses/totals${qs(params)}`)),

  create: (input: CreateExpenseInput) =>
    unwrap<Expense>(apiClient.post('/admin/finance/expenses', input)),

  /** DRAFT → CONFIRMED. Only a confirmed expense counts toward the totals. */
  confirm: (id: string) => unwrap<Expense>(apiClient.post(`/admin/finance/expenses/${id}/confirm`, {})),

  /** Voiding requires a reason and is audited. */
  void: (id: string, reason: string) =>
    unwrap<Expense>(apiClient.post(`/admin/finance/expenses/${id}/void`, { reason })),
};
