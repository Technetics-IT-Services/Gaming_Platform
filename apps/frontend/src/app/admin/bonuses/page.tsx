'use client';

/**
 * Operator bonus administration (Phase 2D.10, AD-07).
 *
 * Every figure on a grant is typed by the operator. This page suggests no amount, computes no
 * eligibility and offers no "award automatically" control, because no rule defines any of those —
 * the server's reason is printed instead.
 *
 * A grant carries a mandatory reference (its idempotency anchor) and a mandatory reason, so a
 * replayed submission returns the first grant and every grant is attributable afterwards.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { bonusAdminApi } from '@/lib/bonus-admin-api';
import { useAuthStore } from '@/stores/auth-store';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ccd2e0', whiteSpace: 'nowrap', color: '#515970',
};
const TD: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap',
};

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: '#0f7a4a', SUSPENDED: '#8a5300', FROZEN: '#1d4ed8', CLOSED: '#515970',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT_RE = /^\d{1,12}(\.\d{1,8})?$/;

export default function AdminBonusesPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  // Granting promotional credit is the same authority as crediting a wallet, so it requires the
  // same permission. A demo session has no backend principal and never qualifies.
  const mayGrant = !isDemoSession && (user?.permissions ?? []).includes('wallets:adjust');

  const [form, setForm] = useState({
    userId: '', currencyCode: 'INR', amount: '', wageringRequirement: '', reference: '', reason: '',
  });
  const [notice, setNotice] = useState<string | null>(null);

  const list = useQuery({ queryKey: ['admin', 'bonuses'], queryFn: () => bonusAdminApi.list({ limit: 50 }) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'bonuses'] });

  const grant = useMutation({
    mutationFn: () => bonusAdminApi.grant({
      userId: form.userId.trim(),
      currencyCode: form.currencyCode.trim().toUpperCase(),
      amount: form.amount.trim(),
      wageringRequirement: form.wageringRequirement.trim() || undefined,
      reference: form.reference.trim(),
      reason: form.reason.trim(),
    }),
    onSuccess: (b) => {
      setNotice(`Granted ${b.balance} ${b.currency} to ${b.username}.`);
      setForm({ ...form, userId: '', amount: '', wageringRequirement: '', reference: '', reason: '' });
      invalidate();
    },
    onError: () => setNotice(null),
  });

  const expire = useMutation({
    mutationFn: (v: { id: string; reason: string }) => bonusAdminApi.expire(v.id, v.reason),
    onSuccess: () => { setNotice('Bonus expired.'); invalidate(); },
    onError: () => setNotice(null),
  });

  const valid = UUID_RE.test(form.userId.trim())
    && AMOUNT_RE.test(form.amount.trim())
    && form.reference.trim().length >= 6
    && form.reason.trim().length >= 3;

  const d = list.data;

  return (
    <div
      data-testid="admin-bonuses"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 1100, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Bonuses</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        {mayGrant
          ? 'You decide the amount and the wagering requirement. Both are recorded against your account.'
          : 'Read-only: granting a bonus requires wallet-adjust permission. The server refuses writes from this account.'}
      </p>

      {list.isLoading ? (
        <div data-testid="bonuses-loading" style={{ ...PANEL, height: 100 }} />
      ) : list.isError ? (
        <div data-testid="bonuses-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load bonuses.
        </div>
      ) : d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {mayGrant ? (
            <section data-testid="bonus-grant" style={{ ...PANEL, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>Grant a bonus</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                <label style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Player user id</span>
                  <input data-testid="bonus-user" value={form.userId}
                         onChange={(e) => setForm({ ...form, userId: e.target.value })}
                         placeholder="00000000-0000-0000-0000-000000000000" style={FIELD} />
                </label>
                <label style={{ flex: '0 1 110px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Currency</span>
                  <input data-testid="bonus-currency" value={form.currencyCode}
                         onChange={(e) => setForm({ ...form, currencyCode: e.target.value.toUpperCase() })}
                         maxLength={3} style={FIELD} />
                </label>
                <label style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Amount</span>
                  <input data-testid="bonus-amount" value={form.amount} inputMode="decimal"
                         onChange={(e) => setForm({ ...form, amount: e.target.value })}
                         placeholder="500.00" style={FIELD} />
                </label>
                <label style={{ flex: '1 1 160px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Wagering requirement</span>
                  <input data-testid="bonus-wagering" value={form.wageringRequirement} inputMode="decimal"
                         onChange={(e) => setForm({ ...form, wageringRequirement: e.target.value })}
                         placeholder="0" style={FIELD} />
                </label>
                <label style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Reference</span>
                  <input data-testid="bonus-reference" value={form.reference}
                         onChange={(e) => setForm({ ...form, reference: e.target.value })}
                         placeholder="goodwill-2026-09-07-01" style={FIELD} />
                </label>
                <label style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Reason</span>
                  <input data-testid="bonus-reason" value={form.reason}
                         onChange={(e) => setForm({ ...form, reason: e.target.value })}
                         placeholder="Goodwill after support ticket #123" style={FIELD} />
                </label>
              </div>
              <p style={{ fontSize: 11, color: '#626a7e', margin: '10px 0 0', lineHeight: 1.5 }}>
                The reference makes this grant idempotent — submitting it twice returns the first
                grant rather than granting again.
              </p>
              <button
                data-testid="bonus-submit"
                onClick={() => grant.mutate()}
                disabled={!valid || grant.isPending}
                style={{ ...FIELD, marginTop: 10, fontWeight: 700, cursor: 'pointer',
                         border: '1px solid #86c9a6', background: '#e6f6ee', opacity: valid ? 1 : 0.6 }}
              >
                {grant.isPending ? 'Granting…' : 'Grant bonus'}
              </button>
              {grant.isError ? (
                <p data-testid="bonus-grant-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: '8px 0 0' }}>
                  The grant was refused and was NOT applied. Check the player id, currency and amount.
                </p>
              ) : null}
            </section>
          ) : null}

          {notice ? (
            <span data-testid="bonuses-notice" role="status" style={{ fontSize: 12, color: '#0f7a4a' }}>{notice}</span>
          ) : null}
          {expire.isError ? (
            <span data-testid="bonuses-mutation-error" role="alert" style={{ fontSize: 12, color: '#b42318' }}>
              That change was refused by the server and was NOT applied.
            </span>
          ) : null}

          {d.items.length === 0 ? (
            <div data-testid="bonuses-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
              No bonuses have been granted.
            </div>
          ) : (
            <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
              <table data-testid="bonuses-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720, fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Granted', 'Player', 'Currency', 'Balance', 'Wagering', 'Status', ...(mayGrant ? [''] : [])].map((h, i) => (
                      <th key={h || `a${i}`} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((b) => (
                    <tr key={b.id} data-testid={`bonus-row-${b.id}`}>
                      <td style={TD}>{new Date(b.createdAt).toLocaleDateString()}</td>
                      <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 180 }}>{b.username}</td>
                      <td style={TD}>{b.currency}</td>
                      <td style={TD}>{b.balance}</td>
                      <td style={TD}>{b.wageringProgress} / {b.wageringRequirement}</td>
                      <td style={{ ...TD, color: STATUS_COLOR[b.status] ?? '#1b1f37' }}>{b.status.toLowerCase()}</td>
                      {mayGrant ? (
                        <td style={TD}>
                          {b.status === 'ACTIVE' ? (
                            <button
                              data-testid={`bonus-expire-${b.id}`}
                              onClick={() => expire.mutate({ id: b.id, reason: 'Expired by operator' })}
                              style={{ ...FIELD, width: 'auto', minWidth: 96, fontSize: 12,
                                       border: '1px solid #f0b4b0', background: '#fef2f2', cursor: 'pointer' }}
                            >
                              Expire
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {d.unavailable.length > 0 ? (
            <section data-testid="bonuses-unavailable" style={{ ...PANEL, borderColor: '#fff7e6', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#8a5300', marginBottom: 6 }}>
                Nothing is awarded automatically
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6, opacity: 0.8 }}>
                {d.unavailable.map((u) => (
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
