'use client';

/**
 * Operator KYC review queue (Phase 2D.12, AD-11).
 *
 * THE GAP THIS CLOSES. `admin/kyc` had list, detail and review endpoints — guarded by
 * `users:verify` and fully audited — but no screen. A compliance officer could not approve or
 * reject an identity check inside the product.
 *
 * NOTHING IS INVENTED. The decision set (take under review / approve / reject with a reason) is the
 * requirement itself; this page adds no threshold, no scoring and no automatic rule.
 *
 * THE DOCUMENT GAP IS SHOWN, NOT HIDDEN. Document *file bytes* cannot be stored — there is no
 * object storage — so the page states that plainly instead of rendering a broken image or implying
 * a reviewer has seen something they have not.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { adminKycApi, type KycDecision } from '@/lib/kyc-api';
import { useAuthStore } from '@/stores/auth-store';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};
const BTN = (bg: string, border: string): React.CSSProperties => ({
  ...FIELD, width: 'auto', minWidth: 108, fontSize: 12, fontWeight: 700,
  cursor: 'pointer', background: bg, border: `1px solid ${border}`,
});
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ccd2e0', whiteSpace: 'nowrap', color: '#515970',
};
const TD: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap',
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: '#8a5300', IN_REVIEW: '#1d4ed8', APPROVED: '#0f7a4a', REJECTED: '#b42318', EXPIRED: '#515970',
};
const STATUSES = ['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED'];

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export default function AdminKycPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  const mayReview = !isDemoSession && (user?.permissions ?? []).includes('users:verify');

  const [status, setStatus] = useState<string>('PENDING');
  const [notice, setNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);

  const queue = useQuery({
    queryKey: ['admin', 'kyc', status],
    queryFn: () => adminKycApi.list({ status: status || undefined, limit: 50 }),
  });

  const review = useMutation({
    mutationFn: (v: { id: string; decision: KycDecision; reason?: string }) =>
      adminKycApi.review(v.id, v.decision, v.reason),
    onSuccess: (_d, v) => {
      setNotice(`Application ${label(v.decision)}.`);
      setRejecting(null);
      qc.invalidateQueries({ queryKey: ['admin', 'kyc'] });
    },
    onError: () => setNotice(null),
  });

  const d = queue.data;

  return (
    <div
      data-testid="admin-kyc"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 1100, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Identity verification</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        {mayReview
          ? 'Every decision is recorded against your account.'
          : 'Read-only: reviewing identity checks requires the verify permission. The server refuses these decisions from this account.'}
      </p>

      <div style={{ ...PANEL, marginBottom: 14, minWidth: 0 }}>
        <label style={{ display: 'block', maxWidth: 260 }}>
          <span style={{ fontSize: 11, color: '#515970' }}>Status</span>
          <select data-testid="kyc-status-filter" value={status} onChange={(e) => setStatus(e.target.value)} style={FIELD}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
      </div>

      {queue.isLoading ? (
        <div data-testid="kyc-loading" style={{ ...PANEL, height: 100 }} />
      ) : queue.isError ? (
        <div data-testid="kyc-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load the verification queue.
        </div>
      ) : d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {notice ? (
            <span data-testid="kyc-notice" role="status" style={{ fontSize: 12, color: '#0f7a4a' }}>{notice}</span>
          ) : null}
          {review.isError ? (
            <span data-testid="kyc-action-error" role="alert" style={{ fontSize: 12, color: '#b42318' }}>
              That decision was refused by the server and was NOT applied.
            </span>
          ) : null}

          {d.items.length === 0 ? (
            <div data-testid="kyc-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
              No applications with this status.
            </div>
          ) : (
            <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
              <table data-testid="kyc-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760, fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Submitted', 'Level', 'Status', 'Documents', 'Reviewed',
                      ...(mayReview ? ['Decision'] : [])].map((h) => <th key={h} style={TH}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((row) => (
                    <tr key={row.id} data-testid={`kyc-row-${row.id}`}>
                      <td style={TD}>{row.submittedAt ? new Date(row.submittedAt).toLocaleString() : '—'}</td>
                      <td style={TD}>{label(row.level)}</td>
                      <td style={{ ...TD, color: STATUS_COLOR[row.status] ?? '#1b1f37' }}>{label(row.status)}</td>
                      <td style={TD}>{row.documentCount}</td>
                      <td style={TD}>{row.reviewedAt ? new Date(row.reviewedAt).toLocaleDateString() : '—'}</td>
                      {mayReview ? (
                        <td style={TD}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {row.status === 'PENDING' ? (
                              <button
                                data-testid={`kyc-take-${row.id}`}
                                disabled={review.isPending}
                                onClick={() => review.mutate({ id: row.id, decision: 'IN_REVIEW' })}
                                style={BTN('#e8efff', '#e8efff')}
                              >
                                Take
                              </button>
                            ) : null}
                            {row.status !== 'APPROVED' && row.status !== 'REJECTED' ? (
                              <>
                                <button
                                  data-testid={`kyc-approve-${row.id}`}
                                  disabled={review.isPending}
                                  onClick={() => review.mutate({ id: row.id, decision: 'APPROVED' })}
                                  style={BTN('#e6f6ee', '#86c9a6')}
                                >
                                  Approve
                                </button>
                                <button
                                  data-testid={`kyc-reject-${row.id}`}
                                  disabled={review.isPending}
                                  onClick={() => setRejecting({ id: row.id, reason: '' })}
                                  style={BTN('#fef2f2', '#f0b4b0')}
                                >
                                  Reject
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rejecting ? (
            <section data-testid="kyc-reject-panel" style={{ ...PANEL, borderColor: '#f0b4b0', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Reason for rejection</div>
              <p style={{ fontSize: 11, color: '#515970', margin: '0 0 10px', lineHeight: 1.5 }}>
                The player sees this, so state what they need to correct.
              </p>
              <input
                data-testid="kyc-reject-reason"
                value={rejecting.reason}
                onChange={(e) => setRejecting({ ...rejecting, reason: e.target.value })}
                placeholder="e.g. the document image was unreadable"
                style={FIELD}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  data-testid="kyc-reject-confirm"
                  disabled={rejecting.reason.trim().length < 3 || review.isPending}
                  onClick={() => review.mutate({ id: rejecting.id, decision: 'REJECTED', reason: rejecting.reason.trim() })}
                  style={{ ...BTN('#fef2f2', '#f0b4b0'), opacity: rejecting.reason.trim().length < 3 ? 0.6 : 1 }}
                >
                  Confirm rejection
                </button>
                <button data-testid="kyc-reject-cancel" onClick={() => setRejecting(null)} style={BTN('#ebeef5', '#b9c1d4')}>
                  Cancel
                </button>
              </div>
            </section>
          ) : null}

          {/* The honest gap, stated on the screen where it matters. */}
          <section data-testid="kyc-upload-unavailable" style={{ ...PANEL, borderColor: '#fff7e6', minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#8a5300', marginBottom: 6 }}>
              Document images are not stored on this platform
            </div>
            <p style={{ fontSize: 11, color: '#515970', margin: 0, lineHeight: 1.55 }}>
              No document storage is configured, so only the submission metadata is held here — the
              document count above is what the player declared. Inspect the documents through your
              existing compliance process before approving. This is stated rather than hidden,
              because approving on the basis of a record you have not seen would be worse than the
              gap itself.
            </p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
