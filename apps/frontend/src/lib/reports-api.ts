import { apiClient, unwrap } from './api-client';
import type { AnalyticsFilters, UnavailableMetric } from './analytics-api';

/**
 * Operator reports & CSV export client (Phase 2D.7).
 *
 * Every figure comes from `GET /analytics/reports`, which is built on the same `AnalyticsService`
 * that backs the dashboard — so a report can never disagree with the screen it was exported from.
 * Nothing is computed, re-aggregated, formatted-as-money or defaulted here.
 *
 * The export deliberately goes through `apiClient` rather than `window.open`/`<a href>`: the route
 * requires an `Authorization` header, which a plain navigation cannot send. The response is turned
 * into a Blob and saved via an object URL, so the download carries the caller's real credentials and
 * the CSV never becomes reachable to an unauthenticated request.
 */

export const REPORT_TYPES = [
  'financial',
  'gaming',
  'cashier',
  'operations',
  'users',
  'security-audit',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportMeta {
  reportType: ReportType;
  title: string;
  from: string;
  to: string;
  timezone: 'UTC';
  currency: string | null;
  gameKey: string | null;
  generatedAt: string;
  definitions: Record<string, string>;
  unavailable: UnavailableMetric[];
  rowCount: number;
  truncated: false;
}

export interface Report {
  meta: ReportMeta;
  columns: string[];
  /** `null` means "not available" — it is NEVER rendered as 0. */
  rows: (string | number | null)[][];
}

function qs(type: ReportType, params: AnalyticsFilters): string {
  const q = new URLSearchParams({ type });
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, String(v)));
  return `?${q.toString()}`;
}

/** Filename from the server's `Content-Disposition`, falling back to a safe generated name. */
function filenameFrom(header: unknown, type: ReportType): string {
  const match = typeof header === 'string' ? /filename="([^"]+)"/.exec(header) : null;
  return match?.[1] ?? `${type}-report.csv`;
}

export const reportsApi = {
  types: () => unwrap<{ types: ReportType[] }>(apiClient.get('/analytics/reports/types')),

  build: (type: ReportType, filters: AnalyticsFilters = {}) =>
    unwrap<Report>(apiClient.get(`/analytics/reports${qs(type, filters)}`)),

  /**
   * Download the CSV for `type` with the current filters.
   *
   * Returns the filename actually saved so the UI can confirm what happened, rather than assuming.
   */
  async exportCsv(type: ReportType, filters: AnalyticsFilters = {}): Promise<string> {
    const res = await apiClient.get(`/analytics/reports/export.csv${qs(type, filters)}`, {
      responseType: 'blob',
    });

    const name = filenameFrom(res.headers?.['content-disposition'], type);
    const url = URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'text/csv;charset=utf-8' }));
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Always release the object URL, even if the click path threw.
      URL.revokeObjectURL(url);
    }
    return name;
  },
};
