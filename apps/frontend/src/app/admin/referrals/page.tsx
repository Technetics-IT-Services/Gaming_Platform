'use client';

/**
 * Referral oversight (Phase 2D.13, P-17).
 *
 * THE GAP THIS CLOSES. `GET /admin/referrals` is guarded by `users:read` and returns real
 * attribution data, but nothing rendered it.
 *
 * READ-ONLY, AND DELIBERATELY SO. There is no route here to award, adjust or reverse a referral —
 * the qualification rule and reward amount are undefined business decisions (D-04), so this console
 * shows **who introduced whom** and nothing more. Where a reward figure would sit, the server's
 * reason is printed. A zero would imply a reward had been calculated and found to be nothing.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { adminReferralsApi } from '@/lib/admin-oversight-api';

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
  padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap',
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: '#8a5300', QUALIFIED: '#1d4ed8', REWARDED: '#0f7a4a',
  EXPIRED: '#515970', CANCELLED: '#515970',
};
const STATUSES = ['PENDING', 'QUALIFIED', 'REWARDED', 'EXPIRED', 'CANCELLED'];
const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export default function AdminReferralsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 25;

  const list = useQuery({
    queryKey: ['admin', 'referrals', status, page],
    queryFn: () => adminReferralsApi.list({ status: status || undefined, page, limit: LIMIT }),
  });

  const d = list.data;
  const totalPages = Math.max(1, Math.ceil((d?.total ?? 0) / LIMIT));

  return (
    <div
      data-testid="admin-referrals"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 1100, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Referrals</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        Who introduced whom. Read-only — no reward is calculated or paid from this platform.
      </p>

      <div style={{ ...PANEL, marginBottom: 14, minWidth: 0 }}>
        <label style={{ display: 'block', maxWidth: 260 }}>
          <span style={{ fontSize: 11, color: '#515970' }}>Status</span>
          <select
            data-testid="referrals-status-filter"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            style={FIELD}
          >
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
      </div>

      {list.isLoading ? (
        <div data-testid="referrals-loading" style={{ ...PANEL, height: 120 }} />
      ) : list.isError ? (
        <div data-testid="referrals-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load referrals.
        </div>
      ) : d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {d.items.length === 0 ? (
            <div data-testid="referrals-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
              No referral relationships with this status.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: '#515970' }}>
                {d.total} relationships · page {d.page} of {totalPages}
              </div>
              <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
                <table data-testid="referrals-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640, fontSize: 12 }}>
                  <thead>
                    <tr>{['Referrer', 'Referred', 'Status', 'When'].map((h) => (
                      <th key={h} style={TH}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {d.items.map((r) => (
                      <tr key={r.id} data-testid={`referral-row-${r.id}`}>
                        <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 200 }}>
                          {r.referrer.username}
                        </td>
                        <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 200 }}>
                          {r.referred.username}
                        </td>
                        <td style={{ ...TD, color: STATUS_COLOR[r.status] ?? '#1b1f37' }}>{label(r.status)}</td>
                        <td style={TD}>{new Date(r.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 ? (
                <div data-testid="referrals-paging" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button data-testid="referrals-prev" disabled={page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          style={{ ...BTN, opacity: page <= 1 ? 0.5 : 1 }}>Previous</button>
                  <span style={{ fontSize: 11, color: '#515970' }}>page {page} of {totalPages}</span>
                  <button data-testid="referrals-next" disabled={page >= totalPages}
                          onClick={() => setPage((p) => p + 1)}
                          style={{ ...BTN, opacity: page >= totalPages ? 0.5 : 1 }}>Next</button>
                </div>
              ) : null}
            </>
          )}

          {/* Where a reward column would be. The reason, not a zero. */}
          {(d.unavailable ?? []).length > 0 ? (
            <section data-testid="referrals-unavailable" style={{ ...PANEL, borderColor: '#fff7e6', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#8a5300', marginBottom: 6 }}>
                No reward is calculated
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6, opacity: 0.8 }}>
                {(d.unavailable ?? []).map((u) => (
                  <li key={u.metric} style={{ overflowWrap: 'anywhere' }}>{u.reason}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
