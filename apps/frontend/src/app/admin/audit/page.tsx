'use client';

/**
 * Audit trail viewer (Phase 2D.13, AD-12).
 *
 * THE GAP THIS CLOSES. `GET /admin/audit` is guarded by `audit:read` and has been writing since
 * Phase 2D.2 — 17 entity types plus the blanket admin-action interceptor — but nothing rendered it.
 * An auditor could not read the audit trail inside the product.
 *
 * READ-ONLY BY CONSTRUCTION. There is no mutation call on this page and no route to edit or delete
 * a record: an audit trail that an operator can alter is not an audit trail.
 *
 * The `changes` payload is rendered as text, never as HTML — an audit record contains operator-
 * supplied reasons, and injecting those into the DOM would turn the log into an attack surface.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { adminAuditApi } from '@/lib/admin-oversight-api';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};
const BTN: React.CSSProperties = {
  ...FIELD, width: 'auto', minWidth: 104, fontSize: 12, fontWeight: 700,
  cursor: 'pointer', background: '#ebeef5', border: '1px solid #b9c1d4',
};
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ccd2e0', whiteSpace: 'nowrap', color: '#515970',
};
const TD: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap', verticalAlign: 'top',
};

const ACTION_COLOR: Record<string, string> = {
  CREATE: '#0f7a4a', UPDATE: '#1d4ed8', DELETE: '#b42318',
  APPROVE: '#0f7a4a', REJECT: '#b42318', EXECUTE: '#8a5300', LOGIN: '#515970',
};

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

/** A compact, SAFE rendering of the change set — text only, never markup. */
function summarise(changes: unknown): string {
  if (changes === null || changes === undefined) return '—';
  if (typeof changes !== 'object') return String(changes);
  const entries = Object.entries(changes as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined)
    .slice(0, 6)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? '{…}' : String(v)}`);
  return entries.length > 0 ? entries.join(' · ') : '—';
}

export default function AdminAuditPage() {
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 25;

  const audit = useQuery({
    queryKey: ['admin', 'audit', entityType, page],
    queryFn: () => adminAuditApi.list({ entityType: entityType || undefined, page, limit: LIMIT }),
  });

  const d = audit.data;
  const rows = d?.items ?? [];
  const total = d?.meta?.total ?? d?.total ?? 0;
  const totalPages = d?.meta?.totalPages ?? Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div
      data-testid="admin-audit"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 1200, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Audit trail</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        Every recorded change, with who made it. Read-only — records cannot be edited or removed
        from here, by design.
      </p>

      <div style={{ ...PANEL, marginBottom: 14, minWidth: 0 }}>
        <label style={{ display: 'block', maxWidth: 300 }}>
          <span style={{ fontSize: 11, color: '#515970' }}>Entity type</span>
          <input
            data-testid="audit-entity-filter"
            value={entityType}
            onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
            placeholder="e.g. partner, admin_action, kyc_verification"
            style={FIELD}
          />
        </label>
      </div>

      {audit.isLoading ? (
        <div data-testid="audit-loading" style={{ ...PANEL, height: 120 }} />
      ) : audit.isError ? (
        <div data-testid="audit-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load the audit trail.
        </div>
      ) : rows.length === 0 ? (
        <div data-testid="audit-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
          No audit records match this filter.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: '#515970' }}>
            {total} records · page {page} of {totalPages}
          </div>

          <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
            <table data-testid="audit-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 860, fontSize: 12 }}>
              <thead>
                <tr>
                  {['When', 'Action', 'Entity', 'Actor', 'Change', 'IP'].map((h) => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`audit-row-${r.id}`}>
                    <td style={TD}>{new Date(r.createdAt).toLocaleString()}</td>
                    <td style={{ ...TD, color: ACTION_COLOR[r.action] ?? '#1b1f37' }}>{label(r.action)}</td>
                    <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 170 }}>
                      {label(r.entityType)}
                    </td>
                    <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 150, color: '#515970' }}>
                      {r.userId ? `${r.userId.slice(0, 8)}…` : 'system'}
                    </td>
                    {/* Text only — an audit record carries operator-supplied reasons. */}
                    <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 320, opacity: 0.85 }}>
                      {summarise(r.changes)}
                    </td>
                    <td style={{ ...TD, color: '#515970' }}>{r.ipAddress ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div data-testid="audit-paging" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                data-testid="audit-prev"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{ ...BTN, opacity: page <= 1 ? 0.5 : 1 }}
              >
                Previous
              </button>
              <span style={{ fontSize: 11, color: '#515970' }}>page {page} of {totalPages}</span>
              <button
                data-testid="audit-next"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                style={{ ...BTN, opacity: page >= totalPages ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
