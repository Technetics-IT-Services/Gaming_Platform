'use client';

/**
 * Operator reports & CSV export (Phase 2D.7) — 100% server-backed, mobile-first.
 *
 * Every row rendered here comes from `GET /analytics/reports`, which is built on the same
 * `AnalyticsService` that backs the dashboard. Nothing is computed, re-aggregated or defaulted on
 * the client, and there is no demo data path of any kind.
 *
 * THE RULES THIS PAGE ENFORCES:
 *   - a `null` cell renders as "Not available", NEVER as 0;
 *   - the metric definitions and the "unavailable" list ship WITH the report and are shown, so an
 *     operator can see what a number means and what the platform cannot produce;
 *   - money stays per-currency — nothing is combined, because there is no FX source;
 *   - export sends the CURRENT filters, so the file always matches what is on screen.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useRealSession } from '@/hooks/use-real-session';
import type { AnalyticsFilters } from '@/lib/analytics-api';
import { REPORT_TYPES, reportsApi, type ReportType } from '@/lib/reports-api';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};

const LABELS: Record<ReportType, string> = {
  financial: 'Financial (ledger)',
  gaming: 'Gaming (game-level)',
  cashier: 'Cashier',
  operations: 'Operations',
  users: 'Users',
  'security-audit': 'Security & audit',
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function AdminReportsPage() {
  const realSession = useRealSession();
  const [type, setType] = useState<ReportType>('financial');
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const filters: AnalyticsFilters = {
    from: `${from}T00:00:00.000Z`,
    to: `${to}T23:59:59.999Z`,
    ...(currency ? { currency } : {}),
  };

  const report = useQuery({
    queryKey: ['report', type, filters.from, filters.to, currency],
    queryFn: () => reportsApi.build(type, filters),
    enabled: realSession,
  });

  const download = useMutation({
    mutationFn: () => reportsApi.exportCsv(type, filters),
    onSuccess: (name) => setNotice(`Exported ${name}`),
    onError: () => setNotice(null),
  });

  const d = report.data;

  return (
    <div
      data-testid="admin-reports"
      // `minWidth: 0` + `width: 100%`: this sits in the admin flex shell, whose column carries
      // `min-w-0` (Phase 2D.6). Both halves are needed for a wide table to scroll inside its own
      // container instead of dragging the page sideways.
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 1100, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Reports</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px' }}>
        Server-generated from platform data. All times UTC. Amounts stay per currency and are never combined.
      </p>

      {/* report picker — wraps to a single column on a phone */}
      <div role="tablist" aria-label="Report type" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, minWidth: 0 }}>
        {REPORT_TYPES.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === type}
            data-testid={`report-tab-${t}`}
            onClick={() => { setType(t); setNotice(null); }}
            style={{
              minHeight: 44, padding: '0 14px', borderRadius: 10, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${t === type ? '#1d4ed8' : '#b9c1d4'}`,
              background: t === type ? '#e8efff' : '#ebeef5',
              color: '#1b1f37', fontWeight: t === type ? 700 : 500,
            }}
          >
            {LABELS[t]}
          </button>
        ))}
      </div>

      {/* filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14, minWidth: 0 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 150px' }}>
          <span style={{ fontSize: 11, color: '#515970' }}>From (UTC)</span>
          <input
            data-testid="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            style={{ minHeight: 44, padding: '0 10px', borderRadius: 10, border: '1px solid #b9c1d4', background: '#ebeef5', color: '#1b1f37', fontSize: 14 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 150px' }}>
          <span style={{ fontSize: 11, color: '#515970' }}>To (UTC)</span>
          <input
            data-testid="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)}
            style={{ minHeight: 44, padding: '0 10px', borderRadius: 10, border: '1px solid #b9c1d4', background: '#ebeef5', color: '#1b1f37', fontSize: 14 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 120px' }}>
          <span style={{ fontSize: 11, color: '#515970' }}>Currency (optional)</span>
          <input
            data-testid="report-currency" placeholder="All" value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            style={{ minHeight: 44, padding: '0 10px', borderRadius: 10, border: '1px solid #b9c1d4', background: '#ebeef5', color: '#1b1f37', fontSize: 14 }}
          />
        </label>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16, minWidth: 0 }}>
        <button
          data-testid="report-export"
          onClick={() => download.mutate()}
          disabled={!realSession || report.isLoading || download.isPending || !d}
          style={{
            minHeight: 44, padding: '0 18px', borderRadius: 10, fontSize: 14, fontWeight: 700,
            border: '1px solid #86c9a6', background: download.isPending ? '#86c9a6' : '#e6f6ee',
            color: '#1b1f37', cursor: download.isPending ? 'progress' : 'pointer',
            opacity: !d || download.isPending ? 0.75 : 1,
          }}
        >
          {download.isPending ? 'Exporting…' : 'Export CSV'}
        </button>
        {notice ? (
          <span data-testid="report-export-notice" role="status" style={{ fontSize: 12, color: '#0f7a4a' }}>{notice}</span>
        ) : null}
        {download.isError ? (
          <span data-testid="report-export-error" role="alert" style={{ fontSize: 12, color: '#b42318' }}>
            Export failed. The range may be invalid or too large.
          </span>
        ) : null}
      </div>

      {!realSession ? (
        <div style={PANEL}>Reports require a real signed-in operator account.</div>
      ) : report.isLoading ? (
        <div data-testid="report-loading" style={{ ...PANEL, height: 120 }} />
      ) : report.isError ? (
        <div data-testid="report-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not build this report. The range may be invalid or above the configured maximum.
        </div>
      ) : d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <section style={{ ...PANEL, minWidth: 0 }} data-testid="report-meta">
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{d.meta.title}</div>
            <div style={{ fontSize: 12, color: '#515970', lineHeight: 1.6 }}>
              <div>Range: {d.meta.from} → {d.meta.to} ({d.meta.timezone})</div>
              <div>Currency filter: {d.meta.currency ?? 'All (rows stay per-currency)'}</div>
              <div>Generated: {d.meta.generatedAt}</div>
              <div>Rows: {d.meta.rowCount}</div>
            </div>
          </section>

          {d.rows.length === 0 ? (
            <div data-testid="report-empty" style={PANEL}>
              No rows in this range. That is an empty result, not a zero measurement.
            </div>
          ) : (
            <section style={{ minWidth: 0 }}>
              {/* Wide tables scroll inside THIS container, never the page. */}
              <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
                <table data-testid="report-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420, fontSize: 12 }}>
                  <thead>
                    <tr>
                      {d.columns.map((c) => (
                        <th key={c} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ccd2e0', whiteSpace: 'nowrap', color: '#515970' }}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} style={{ padding: '9px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>
                            {cell === null || cell === undefined
                              ? <span style={{ color: '#626a7e' }}>Not available</span>
                              : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section style={{ ...PANEL, minWidth: 0 }} data-testid="report-definitions">
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>What these numbers mean</div>
            <dl style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
              {Object.entries(d.meta.definitions).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 6 }}>
                  <dt style={{ fontWeight: 700, opacity: 0.85 }}>{k}</dt>
                  <dd style={{ margin: '0 0 0 10px', color: '#515970' }}>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          {d.meta.unavailable.length > 0 ? (
            <section style={{ ...PANEL, minWidth: 0, borderColor: '#fff7e6' }} data-testid="report-unavailable">
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8, color: '#8a5300' }}>
                Not available in this report
              </div>
              <p style={{ fontSize: 11, color: '#515970', margin: '0 0 8px' }}>
                These are deliberately not displayed as zero. Each names the source the platform does not have.
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
                {d.meta.unavailable.map((u) => (
                  <li key={u.metric}><strong>{u.metric}</strong> — {u.reason}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
