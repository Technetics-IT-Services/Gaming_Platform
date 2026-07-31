/**
 * Analytics read ports (Phase 6D).
 *
 * The narrow, READ-ONLY view of the frozen platform the analytics layer aggregates:
 * treasury/settlement figures (Treasury), compliance decisions (Compliance) and
 * system health (Operations). Adapters call only public read methods — nothing is
 * modified and no write/settlement path is reachable.
 */
import { type ComplianceService } from '@/lib/compliance';
import { type OperationsService } from '@/lib/operations';
import { type WithdrawalService } from '@/lib/treasury';

export interface FinancialSnapshotPort {
  treasury(): { reservedTotal: number; pending: number; settlement: number; external: number; balanced: boolean; systemSum: number };
  settlement(): { count: number; amount: number };
}
export interface ComplianceAnalyticsPort {
  decisions(): { at: number; action: string; riskScore: number; reasons: { code: string }[] }[];
}
export interface HealthPort {
  status(): { overall: string; components: { name: string; status: string; detail?: string }[] };
}

export function treasuryFinancialPort(withdrawals: WithdrawalService): FinancialSnapshotPort {
  return {
    treasury: () => withdrawals.treasurySummary(),
    settlement: () => withdrawals.settlementSummary(),
  };
}

export function complianceAnalyticsPort(compliance: ComplianceService): ComplianceAnalyticsPort {
  return {
    decisions: () =>
      compliance.audit.query({ limit: 1_000_000 }).map((r) => ({
        at: r.at,
        action: r.action as string,
        riskScore: r.riskScore,
        reasons: r.reasons.map((x) => ({ code: x.code })),
      })),
  };
}

export function operationsHealthPort(ops: OperationsService): HealthPort {
  return {
    status: () => {
      const s = ops.health.statusSync();
      return { overall: s.overall as string, components: s.components.map((c) => ({ name: c.name, status: c.status as string, detail: c.detail })) };
    },
  };
}
