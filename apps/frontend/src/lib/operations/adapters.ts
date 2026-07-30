/**
 * Service adapters (Phase 6A).
 *
 * Thin factories that expose the frozen platform services through the operations
 * READ ports. They call only public read methods — no service is modified, and no
 * write/settlement path is reachable from here. This is the seam that lets the
 * operations layer "consume existing services" without importing their internals.
 */
import { type WalletService } from '@/lib/ledger';
import { type WithdrawalService } from '@/lib/treasury';
import { type ComplianceService } from '@/lib/compliance';

import { type ComplianceReadPort, type WalletReadPort, type WithdrawalReadPort } from './ports';

/** Wrap a `WalletService` (+ its ledger via history) as a read port. */
export function walletReadPort(wallet: WalletService): WalletReadPort {
  return {
    getBalance: (playerId) => wallet.getBalance(playerId),
    getVault: (playerId) => wallet.getVault(playerId),
    history: (playerId, query) => {
      const page = wallet.history(playerId, { limit: query?.limit });
      const account = wallet.wallet(playerId);
      const items = page.items.map((tx) => {
        // The player-facing magnitude is the entry that touched their wallet account.
        const entry = tx.entries.find((e) => e.account === account);
        return { type: tx.type as string, amount: entry?.amount ?? 0, at: tx.at };
      });
      return { items, total: page.total };
    },
  };
}

/** Wrap a `WithdrawalService` as a read port (reporting/summaries only). */
export function withdrawalReadPort(withdrawals: WithdrawalService): WithdrawalReadPort {
  return {
    history: (query) => {
      const page = withdrawals.history({ playerId: query.playerId, limit: query.limit });
      return { items: page.items.map((w) => ({ id: w.id, amount: w.amount, status: w.status as string, createdAt: w.createdAt })), total: page.total };
    },
    pending: () => withdrawals.pending().map((w) => ({ id: w.id, playerId: w.playerId, amount: w.amount, status: w.status as string })),
    completed: () => withdrawals.completed().map((w) => ({ id: w.id, playerId: w.playerId, amount: w.amount })),
    treasurySummary: () => withdrawals.treasurySummary(),
    settlementSummary: () => withdrawals.settlementSummary(),
  };
}

/** Wrap a `ComplianceService`'s audit as a read port (decisions/risk view). */
export function complianceReadPort(compliance: ComplianceService): ComplianceReadPort {
  return {
    auditQuery: (q) =>
      compliance.audit.query(q).map((r) => ({
        at: r.at,
        playerId: r.playerId,
        action: r.action as string,
        riskScore: r.riskScore,
        correlationId: r.correlationId,
        reasons: r.reasons.map((x) => ({ code: x.code })),
      })),
    auditCount: () => compliance.audit.count(),
  };
}
