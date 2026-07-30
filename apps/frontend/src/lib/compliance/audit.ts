/**
 * Compliance audit (Phase 5D, STEP 9).
 *
 * An append-only record of every decision, capturing the action, reasons, rule
 * codes, risk score and each engine's status (KYC/AML/fraud/device/geo) with a
 * timestamp, actor and correlation id. Queryable for review; never mutated.
 */
import {
  type ComplianceAuditRecord,
  type CorrelationId,
  type DecisionAction,
  type OperationType,
} from './types';

export interface AuditQuery {
  playerId?: string;
  correlationId?: CorrelationId;
  action?: DecisionAction;
  operation?: OperationType;
  from?: number;
  to?: number;
  limit?: number;
}

export class ComplianceAudit {
  private readonly records: ComplianceAuditRecord[] = [];

  record(rec: ComplianceAuditRecord): void {
    this.records.push(rec);
  }

  all(): readonly ComplianceAuditRecord[] {
    return this.records;
  }

  query(q: AuditQuery = {}): ComplianceAuditRecord[] {
    let out = this.records.filter((r) => {
      if (q.playerId && r.playerId !== q.playerId) return false;
      if (q.correlationId && r.correlationId !== q.correlationId) return false;
      if (q.action && r.action !== q.action) return false;
      if (q.operation && r.operation !== q.operation) return false;
      if (q.from !== undefined && r.at < q.from) return false;
      if (q.to !== undefined && r.at > q.to) return false;
      return true;
    });
    out = out.sort((a, b) => b.at - a.at);
    return q.limit ? out.slice(0, q.limit) : out;
  }

  /** Proof of 100% audit coverage against a decision count. */
  count(): number {
    return this.records.length;
  }
}
