/**
 * Partner read ports (Phase 6C).
 *
 * The narrow, READ-ONLY view of existing platform data the partner platform consumes
 * — player financial summaries sourced through Operations, and engagement/LTV signals
 * through CRM. The partner platform depends on these capabilities, never on service
 * internals, and can never reach a write/settlement path. No money movement.
 */
import { type OperationsService } from '@/lib/operations';

/** Per-player financial facts used for revenue-share / LTV (all read-only). */
export interface PlayerFinancialPort {
  financials(playerId: string): { depositTotal: number; withdrawalTotal: number; ngr: number };
}

/**
 * Build a `PlayerFinancialPort` from an `OperationsService`. Reads only the public
 * read-only `players` sub-service — Operations is not modified. NGR is a LOGICAL
 * figure (deposits − withdrawals) used for commission math, never a ledger value.
 */
export function operationsFinancialPort(ops: OperationsService): PlayerFinancialPort {
  return {
    financials: (playerId) => {
      const o = ops.players.overview(playerId);
      const depositTotal = o.deposits.total;
      const withdrawalTotal = o.withdrawals.completedAmount;
      return { depositTotal, withdrawalTotal, ngr: Math.max(0, depositTotal - withdrawalTotal) };
    },
  };
}
