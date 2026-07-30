/**
 * Read ports (Phase 6A).
 *
 * Narrow, READ-ONLY views of the frozen platform services the operations layer
 * consumes. The real `WalletService` / `WithdrawalService` / `ComplianceService`
 * satisfy these structurally (or via the thin adapters in `adapters.ts`), so
 * operations depends on capabilities — never on internals, and never on a write
 * path. Nothing here can move money or mutate a frozen service.
 */

export interface WalletReadPort {
  getBalance(playerId: string): { available: number; locked: number; total: number; currency: string };
  getVault(playerId: string): number;
  /** Ledger-backed transaction history for a player (typed rows). */
  history(playerId: string, query?: { limit?: number }): { items: { type: string; amount: number; at: number }[]; total: number };
}

export interface WithdrawalReadPort {
  history(query: { playerId?: string; limit?: number }): { items: { id: string; amount: number; status: string; createdAt: number }[]; total: number };
  pending(): { id: string; playerId: string; amount: number; status: string }[];
  completed(): { id: string; playerId: string; amount: number }[];
  treasurySummary(): { reservedTotal: number; pending: number; settlement: number; external: number; balanced: boolean; systemSum: number };
  settlementSummary(): { count: number; amount: number };
}

export interface ComplianceReadPort {
  auditQuery(q: { playerId?: string; correlationId?: string; from?: number; to?: number; limit?: number }): {
    at: number;
    playerId: string;
    action: string;
    riskScore: number;
    correlationId: string;
    reasons: { code: string }[];
  }[];
  auditCount(): number;
}

export interface LedgerReadPort {
  reconcile(): { balanced: boolean; systemSum: number };
}

/** Optional health probes for external subsystems (payment gateways, queues, cache). */
export interface HealthProbe {
  name: string;
  check(): { healthy: boolean; detail?: string } | Promise<{ healthy: boolean; detail?: string }>;
}
