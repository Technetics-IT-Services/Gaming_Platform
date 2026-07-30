/**
 * Player management (Phase 6A, STEP 3).
 *
 * Aggregates a read-only player overview from the frozen services via read ports:
 * account status, wallet summary, deposit/withdrawal summaries, risk summary and
 * support-history count. It only reads — it never mutates wallet, ledger, treasury
 * or compliance state.
 */
import { type AccountService } from './account-service';
import { type ComplianceReadPort, type WalletReadPort, type WithdrawalReadPort } from './ports';
import { type SupportService } from './support-service';
import {
  type DepositSummary,
  type PlayerOverview,
  type RiskSummary,
  type TimelineEvent,
  type WalletSummary,
  type WithdrawalSummary,
} from './types';

export interface PlayerServiceDeps {
  wallet: WalletReadPort;
  withdrawals: WithdrawalReadPort;
  compliance: ComplianceReadPort;
  accounts: AccountService;
  support: SupportService;
}

export class PlayerService {
  constructor(private readonly deps: PlayerServiceDeps) {}

  walletSummary(playerId: string): WalletSummary {
    const b = this.deps.wallet.getBalance(playerId);
    return { available: b.available, locked: b.locked, total: b.total, vault: this.deps.wallet.getVault(playerId), currency: b.currency };
  }

  depositSummary(playerId: string): DepositSummary {
    const rows = this.deps.wallet.history(playerId, { limit: 10_000 }).items.filter((t) => t.type === 'deposit');
    return { count: rows.length, total: rows.reduce((s, t) => s + t.amount, 0) };
  }

  withdrawalSummary(playerId: string): WithdrawalSummary {
    const pending = this.deps.withdrawals.pending().filter((w) => w.playerId === playerId);
    const completed = this.deps.withdrawals.completed().filter((w) => w.playerId === playerId);
    return {
      pending: pending.length,
      pendingAmount: pending.reduce((s, w) => s + w.amount, 0),
      completed: completed.length,
      completedAmount: completed.reduce((s, w) => s + w.amount, 0),
    };
  }

  riskSummary(playerId: string): RiskSummary {
    const decisions = this.deps.compliance.auditQuery({ playerId });
    const latest = decisions[0];
    const flags = [...new Set(decisions.flatMap((d) => d.reasons.map((r) => r.code)))];
    return { decisions: decisions.length, lastAction: latest?.action, lastRiskScore: latest?.riskScore, flags };
  }

  overview(playerId: string): PlayerOverview {
    return {
      playerId,
      account: this.deps.accounts.get(playerId),
      wallet: this.walletSummary(playerId),
      deposits: this.depositSummary(playerId),
      withdrawals: this.withdrawalSummary(playerId),
      risk: this.riskSummary(playerId),
      supportNotes: this.deps.support.countNotes(playerId),
    };
  }

  /** Unified player timeline: support notes + risk decisions + account change. */
  timeline(playerId: string): TimelineEvent[] {
    const events: TimelineEvent[] = this.deps.support.timeline(playerId);
    for (const d of this.deps.compliance.auditQuery({ playerId })) {
      events.push({ at: d.at, source: 'compliance', type: d.action, detail: `risk ${d.riskScore}`, correlationId: d.correlationId });
    }
    const account = this.deps.accounts.get(playerId);
    if (account.updatedAt > 0) events.push({ at: account.updatedAt, source: 'account', type: account.status, detail: account.reason ?? '' });
    return events.sort((a, b) => b.at - a.at);
  }
}
