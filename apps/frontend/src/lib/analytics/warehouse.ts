/**
 * Data platform / warehouse (Phase 6D, STEP 8).
 *
 * Reporting APIs, warehouse export, ETL contracts, scheduled-report registration,
 * point-in-time snapshots, historical aggregation and read models. Everything is a
 * read model over the analytics/BI outputs — no source system is written to.
 */
import { type FinancialBI } from './financial-bi';
import { type KPIEngine } from './kpi-engine';
import {
  type ETLContract,
  Granularity,
  type Report,
  type ReportSchedule,
  type Snapshot,
} from './types';

function secureId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export class WarehouseService {
  private readonly snapshots: Snapshot[] = [];
  private readonly schedules = new Map<string, ReportSchedule>();

  constructor(
    private readonly kpis: KPIEngine,
    private readonly financial: FinancialBI,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Capture a point-in-time snapshot (historical aggregation source). */
  snapshot(opts: { tenantId?: string } = {}): Snapshot {
    const snap: Snapshot = { id: secureId('snap'), at: this.clock(), kpis: this.kpis.compute({ tenantId: opts.tenantId }), financial: this.financial.report({ tenantId: opts.tenantId }) };
    this.snapshots.push(snap);
    return snap;
  }
  history(): Snapshot[] {
    return [...this.snapshots];
  }

  /** KPI trend across captured snapshots (historical aggregation read model). */
  kpiTrend(metric: keyof Snapshot['kpis']): { at: number; value: number }[] {
    return this.snapshots.map((s) => ({ at: s.at, value: Number(s.kpis[metric]) }));
  }

  /* ------------------------------- scheduling ----------------------------- */

  scheduleReport(input: { name: string; report: string; cron: string }): ReportSchedule {
    const s: ReportSchedule = { id: secureId('sched'), name: input.name, report: input.report, cron: input.cron, enabled: true };
    this.schedules.set(s.id, s);
    return s;
  }
  listSchedules(): ReportSchedule[] {
    return [...this.schedules.values()];
  }

  /* --------------------------------- ETL ---------------------------------- */

  /** A typed extract contract a warehouse ETL job would consume. */
  etlContract(dataset: 'kpis' | 'financial'): ETLContract {
    if (dataset === 'kpis') {
      return {
        dataset: 'kpis',
        grain: Granularity.Day,
        columns: [
          { name: 'at', type: 'timestamp' },
          { name: 'revenue', type: 'number' },
          { name: 'dau', type: 'number' },
          { name: 'mau', type: 'number' },
          { name: 'ngr', type: 'number' },
        ],
      };
    }
    return {
      dataset: 'financial',
      grain: Granularity.Day,
      columns: [
        { name: 'at', type: 'timestamp' },
        { name: 'deposits', type: 'number' },
        { name: 'withdrawals', type: 'number' },
        { name: 'netCashflow', type: 'number' },
      ],
    };
  }

  /** Export snapshot history as a warehouse-ready tabular report. */
  export(): Report {
    return {
      name: 'kpi-warehouse-export',
      columns: ['at', 'revenue', 'ngr', 'dau', 'mau', 'retentionRate', 'arpu'],
      rows: this.snapshots.map((s) => [s.at, s.kpis.revenue, s.kpis.ngr, s.kpis.dau, s.kpis.mau, Math.round(s.kpis.retentionRate * 10_000) / 10_000, s.kpis.arpu]),
      generatedAt: this.clock(),
    };
  }

  static toCsv(report: Report): string {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [report.columns.join(','), ...report.rows.map((r) => r.map(esc).join(','))].join('\n');
  }
}
