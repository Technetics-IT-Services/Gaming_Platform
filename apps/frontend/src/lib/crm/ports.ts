/**
 * CRM read ports (Phase 6B).
 *
 * The narrow, READ-ONLY view of existing platform data the CRM consumes — sourced
 * through the Operations layer (which itself wraps the frozen financial services).
 * The CRM depends on this capability, not on any service internals, and can never
 * reach a write/settlement path through it.
 */
import { type OperationsService } from '@/lib/operations';

/** Financial/account facts the CRM needs for segmentation & profiles. */
export interface PlayerInsightPort {
  snapshot(playerId: string): {
    depositTotal: number;
    withdrawalTotal: number;
    balance: number;
    accountStatus: string;
    riskFlags: string[];
    registeredAt?: number;
  };
}

/**
 * Build a `PlayerInsightPort` from an `OperationsService` instance. Reads only the
 * public read-only sub-services (`players`, `search`) — Operations is not modified.
 */
export function operationsInsightPort(ops: OperationsService): PlayerInsightPort {
  return {
    snapshot: (playerId) => {
      const o = ops.players.overview(playerId);
      const dir = ops.search.search({ text: playerId, limit: 1 }).items.find((e) => e.playerId === playerId);
      return {
        depositTotal: o.deposits.total,
        withdrawalTotal: o.withdrawals.completedAmount,
        balance: o.wallet.total,
        accountStatus: o.account.status,
        riskFlags: o.risk.flags,
        registeredAt: dir?.registeredAt,
      };
    },
  };
}
