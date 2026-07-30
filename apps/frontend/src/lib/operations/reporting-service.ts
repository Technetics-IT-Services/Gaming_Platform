/**
 * Reporting (Phase 6A, STEP 10).
 *
 * Export-ready tabular reports (CSV/JSON downstream) built from read-only views:
 * player, operational, finance, risk and compliance summaries. Every report is a
 * `{ columns, rows }` contract with a `toCsv` helper — pure reads, no side effects.
 */
import { type AccountService } from './account-service';
import { type PlayerService } from './player-service';
import { type ComplianceReadPort, type WithdrawalReadPort } from './ports';
import { type SearchService } from './search-service';
import { type OperationsAudit } from './operations-audit';
import { type Report } from './types';

export interface ReportingServiceDeps {
  withdrawals: WithdrawalReadPort;
  compliance: ComplianceReadPort;
  players: PlayerService;
  accounts: AccountService;
  search: SearchService;
  operations: OperationsAudit;
  clock?: () => number;
}

export class ReportingService {
  private readonly clock: () => number;
  constructor(private readonly deps: ReportingServiceDeps) {
    this.clock = deps.clock ?? (() => Date.now());
  }

  /** Per-player financial snapshot across the directory. */
  playerReport(): Report {
    const rows = this.deps.search.allIds().map((id) => {
      const o = this.deps.players.overview(id);
      return [id, o.account.status, o.wallet.available, o.wallet.locked, o.deposits.total, o.withdrawals.completedAmount, o.risk.decisions] as (string | number)[];
    });
    return { name: 'player-report', columns: ['playerId', 'status', 'available', 'locked', 'depositTotal', 'withdrawnTotal', 'riskDecisions'], rows, generatedAt: this.clock() };
  }

  operationalReport(): Report {
    const rows = this.deps.operations.all().map((r) => [r.at, r.actor, r.action, r.target ?? '', r.allowed ? 'allow' : 'deny', r.detail ?? ''] as (string | number)[]);
    return { name: 'operational-report', columns: ['at', 'actor', 'action', 'target', 'result', 'detail'], rows, generatedAt: this.clock() };
  }

  financeReport(): Report {
    const t = this.deps.withdrawals.treasurySummary();
    const s = this.deps.withdrawals.settlementSummary();
    const rows: (string | number)[][] = [
      ['reservedTotal', t.reservedTotal],
      ['pending', t.pending],
      ['settlement', t.settlement],
      ['external', t.external],
      ['completedCount', s.count],
      ['completedAmount', s.amount],
      ['balanced', t.balanced ? 1 : 0],
    ];
    return { name: 'finance-summary', columns: ['metric', 'value'], rows, generatedAt: this.clock() };
  }

  riskReport(): Report {
    const decisions = this.deps.compliance.auditQuery({ limit: 100_000 });
    const byAction = new Map<string, number>();
    for (const d of decisions) byAction.set(d.action, (byAction.get(d.action) ?? 0) + 1);
    const rows = [...byAction.entries()].map(([action, count]) => [action, count] as (string | number)[]);
    return { name: 'risk-summary', columns: ['action', 'count'], rows, generatedAt: this.clock() };
  }

  complianceReport(): Report {
    const decisions = this.deps.compliance.auditQuery({ limit: 100_000 });
    const byFlag = new Map<string, number>();
    for (const d of decisions) for (const r of d.reasons) byFlag.set(r.code, (byFlag.get(r.code) ?? 0) + 1);
    const rows = [...byFlag.entries()].map(([code, count]) => [code, count] as (string | number)[]);
    return { name: 'compliance-summary', columns: ['reasonCode', 'count'], rows, generatedAt: this.clock() };
  }

  /** Serialize any report to CSV (RFC-4180-ish quoting). */
  static toCsv(report: Report): string {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [report.columns.join(','), ...report.rows.map((r) => r.map(esc).join(','))].join('\n');
  }
}
