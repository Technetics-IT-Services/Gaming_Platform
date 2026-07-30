/**
 * Unified audit viewer (Phase 6A, STEP 6).
 *
 * Merges the three read-only audit streams — financial (withdrawal/ledger),
 * compliance and operations — into one searchable, filterable, paginated view keyed
 * by correlation id, with export-ready rows. Read-only: it never writes to any audit
 * source, it only reads them.
 */
import { type OperationsAudit } from './operations-audit';
import { type ComplianceReadPort, type WithdrawalReadPort } from './ports';
import { AuditSource, type AuditFilter, type Page, type Report, type UnifiedAuditRecord } from './types';

export interface AuditViewerDeps {
  compliance: ComplianceReadPort;
  withdrawals: WithdrawalReadPort;
  operations: OperationsAudit;
  /** Optional extra financial-audit rows (e.g. a payment audit stream). */
  financial?: () => UnifiedAuditRecord[];
}

export class AuditViewerService {
  constructor(private readonly deps: AuditViewerDeps) {}

  private collect(filter: AuditFilter): UnifiedAuditRecord[] {
    const sources = new Set(filter.sources ?? [AuditSource.Financial, AuditSource.Compliance, AuditSource.Operations]);
    const rows: UnifiedAuditRecord[] = [];

    if (sources.has(AuditSource.Compliance)) {
      for (const r of this.deps.compliance.auditQuery({ playerId: filter.playerId, correlationId: filter.correlationId, from: filter.from, to: filter.to })) {
        rows.push({ source: AuditSource.Compliance, at: r.at, action: r.action, playerId: r.playerId, correlationId: r.correlationId, detail: `risk ${r.riskScore}` });
      }
    }
    if (sources.has(AuditSource.Operations)) {
      for (const r of this.deps.operations.query({ actor: filter.actor, from: filter.from, to: filter.to })) {
        rows.push({ source: AuditSource.Operations, at: r.at, actor: r.actor, action: r.action, playerId: r.target, correlationId: r.correlationId, detail: r.detail });
      }
    }
    if (sources.has(AuditSource.Financial)) {
      const witems = this.deps.withdrawals.history({ playerId: filter.playerId }).items;
      for (const w of witems) rows.push({ source: AuditSource.Financial, at: w.createdAt, action: `withdrawal.${w.status}`, playerId: filter.playerId, detail: `${w.amount}` });
      if (this.deps.financial) rows.push(...this.deps.financial());
    }
    return rows;
  }

  /** Search/filter/paginate the merged stream (newest first). */
  search(filter: AuditFilter = {}): Page<UnifiedAuditRecord> {
    const text = filter.search?.trim().toLowerCase();
    let rows = this.collect(filter).filter((r) => {
      if (filter.actor && r.actor !== filter.actor) return false;
      if (filter.correlationId && r.correlationId !== filter.correlationId) return false;
      if (filter.playerId && r.playerId !== filter.playerId) return false;
      if (filter.from !== undefined && r.at < filter.from) return false;
      if (filter.to !== undefined && r.at > filter.to) return false;
      if (text && !`${r.action} ${r.detail ?? ''} ${r.actor ?? ''}`.toLowerCase().includes(text)) return false;
      return true;
    });
    rows = rows.sort((a, b) => b.at - a.at);
    const limit = filter.limit ?? 50;
    let start = 0;
    if (filter.cursor) {
      const idx = Number(filter.cursor);
      if (Number.isFinite(idx) && idx > 0) start = idx;
    }
    const items = rows.slice(start, start + limit);
    const nextIndex = start + limit;
    return { items, total: rows.length, nextCursor: nextIndex < rows.length ? String(nextIndex) : undefined };
  }

  /** Export-ready tabular form of a filtered audit search (CSV/JSON downstream). */
  export(filter: AuditFilter = {}): Report {
    const rows = this.search({ ...filter, limit: filter.limit ?? 10_000 }).items;
    return {
      name: 'audit-export',
      columns: ['source', 'at', 'actor', 'action', 'playerId', 'correlationId', 'detail'],
      rows: rows.map((r) => [r.source, r.at, r.actor ?? '', r.action, r.playerId ?? '', r.correlationId ?? '', r.detail ?? '']),
      generatedAt: rows[0]?.at ?? 0,
    };
  }
}
