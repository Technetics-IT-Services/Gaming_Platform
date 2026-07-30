/**
 * Dashboards (Phase 6A, STEP 7).
 *
 * Read-only aggregation over the frozen services + operations state: player metrics,
 * deposits, withdrawals (incl. pending), risk-decision breakdown and system status.
 * Pure reads — no money movement, no writes to any source.
 */
import { type AccountService } from './account-service';
import { type HealthService } from './health-service';
import { type ComplianceReadPort, type WalletReadPort, type WithdrawalReadPort } from './ports';
import { type SearchService } from './search-service';
import { AccountStatus, type OperationsDashboard } from './types';

export interface DashboardServiceDeps {
  wallet: WalletReadPort;
  withdrawals: WithdrawalReadPort;
  compliance: ComplianceReadPort;
  accounts: AccountService;
  search: SearchService;
  health: HealthService;
  clock?: () => number;
}

export class DashboardService {
  private readonly clock: () => number;
  constructor(private readonly deps: DashboardServiceDeps) {
    this.clock = deps.clock ?? (() => Date.now());
  }

  /** Count of players in each operational status (active = not otherwise flagged). */
  private playerMetrics(): OperationsDashboard['players'] {
    const total = this.deps.search.size();
    let suspended = 0;
    let excluded = 0;
    for (const s of this.deps.accounts.all()) {
      if (s.status === AccountStatus.Suspended || s.status === AccountStatus.Locked) suspended += 1;
      else if (s.status === AccountStatus.SelfExcluded) excluded += 1;
    }
    return { total, active: Math.max(0, total - suspended - excluded), suspended, excluded };
  }

  private riskMetrics(): OperationsDashboard['risk'] {
    const decisions = this.deps.compliance.auditQuery({ limit: 100_000 });
    let holds = 0;
    let rejects = 0;
    let manualReviews = 0;
    for (const d of decisions) {
      if (d.action === 'hold') holds += 1;
      else if (d.action === 'reject') rejects += 1;
      else if (d.action === 'manual_review') manualReviews += 1;
    }
    return { decisions: decisions.length, holds, rejects, manualReviews };
  }

  overview(): OperationsDashboard {
    const pending = this.deps.withdrawals.pending();
    const settlement = this.deps.withdrawals.settlementSummary();
    const deposits = this.depositTotals();
    return {
      players: this.playerMetrics(),
      deposits,
      withdrawals: {
        pending: pending.length,
        pendingAmount: pending.reduce((s, w) => s + w.amount, 0),
        completed: settlement.count,
        completedAmount: settlement.amount,
      },
      risk: this.riskMetrics(),
      system: this.deps.health.statusSync(),
      generatedAt: this.clock(),
    };
  }

  /** Aggregate deposits across the (bounded) player directory via ledger reads. */
  private depositTotals(): OperationsDashboard['deposits'] {
    let count = 0;
    let total = 0;
    for (const playerId of this.deps.search.allIds()) {
      for (const t of this.deps.wallet.history(playerId, { limit: 10_000 }).items) {
        if (t.type === 'deposit') {
          count += 1;
          total += t.amount;
        }
      }
    }
    return { count, total };
  }

  /** Live pending-withdrawal queue for the ops dashboard. */
  pendingWithdrawals(): { id: string; playerId: string; amount: number; status: string }[] {
    return this.deps.withdrawals.pending();
  }
}
