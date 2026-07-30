/**
 * Operations audit (Phase 6A, STEP 9).
 *
 * Append-only record of every operational action (and every denied attempt) taken
 * through the platform: who, what, target, correlation id, allow/deny, detail. This
 * is the operations-owned audit source surfaced by the unified Audit Viewer.
 */
import { type OperationsAuditRecord } from './types';

export class OperationsAudit {
  private readonly records: OperationsAuditRecord[] = [];

  record(rec: OperationsAuditRecord): void {
    this.records.push(rec);
  }

  all(): readonly OperationsAuditRecord[] {
    return this.records;
  }

  query(q: { actor?: string; action?: string; target?: string; from?: number; to?: number; limit?: number } = {}): OperationsAuditRecord[] {
    let out = this.records.filter((r) => {
      if (q.actor && r.actor !== q.actor) return false;
      if (q.action && r.action !== q.action) return false;
      if (q.target && r.target !== q.target) return false;
      if (q.from !== undefined && r.at < q.from) return false;
      if (q.to !== undefined && r.at > q.to) return false;
      return true;
    });
    out = out.sort((a, b) => b.at - a.at);
    return q.limit ? out.slice(0, q.limit) : out;
  }

  count(): number {
    return this.records.length;
  }
}
