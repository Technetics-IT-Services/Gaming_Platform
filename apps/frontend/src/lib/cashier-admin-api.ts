import { apiClient, unwrap } from './api-client';

/**
 * Operator cashier actions (Phase 2D.12) — the money decisions themselves.
 *
 * SEPARATE FROM READING THE QUEUE ON PURPOSE. `financeOpsApi.cashierQueue()` lists what is waiting
 * and needs only `transactions:read`; every call here moves or releases real money and requires
 * `wallets:adjust`. A finance reviewer can watch the queue without being able to act on it.
 *
 * The operator never supplies an amount. Each action names a request **id** — the figure comes from
 * the player's own request, so an operator decides yes/no, never how much.
 */

export const cashierAdminApi = {
  /** Credit the player's wallet through the ledger. The authoritative deposit money movement. */
  completeDeposit: (id: string) =>
    unwrap<unknown>(apiClient.post(`/admin/cashier/deposits/${id}/complete`, {})),

  /** Refuse a deposit. No money moves. */
  rejectDeposit: (id: string, reason: string) =>
    unwrap<unknown>(apiClient.post(`/admin/cashier/deposits/${id}/reject`, { reason })),

  /** Approve a held withdrawal. Funds were already held on request, so no money moves here. */
  approveWithdrawal: (id: string) =>
    unwrap<unknown>(apiClient.post(`/admin/cashier/withdrawals/${id}/approve`, {})),

  /** Mark a withdrawal paid. Funds were already debited when the player requested it. */
  completeWithdrawal: (id: string) =>
    unwrap<unknown>(apiClient.post(`/admin/cashier/withdrawals/${id}/complete`, {})),

  /** Refuse a held withdrawal and refund the held funds back to the player. */
  rejectWithdrawal: (id: string, reason: string) =>
    unwrap<unknown>(apiClient.post(`/admin/cashier/withdrawals/${id}/reject`, { reason })),
};
