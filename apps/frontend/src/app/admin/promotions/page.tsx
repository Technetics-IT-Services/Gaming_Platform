'use client';

/**
 * Promotion administration (AD-08) — configuration only.
 *
 * Every row is a real `Promotion` record. There is no award amount field anywhere, because no
 * business rule defines what a promotion pays; the server states that and this page shows it.
 * Creating never publishes: a promotion always starts DRAFT and must be activated deliberately.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  adminPromotionsApi,
  PROMOTION_STATUSES,
  PROMOTION_TYPES,
  type PromotionStatus,
  type PromotionType,
} from '@/lib/promotions-api';
import { useAuthStore } from '@/stores/auth-store';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};

const STATUS_COLOR: Record<PromotionStatus, string> = {
  DRAFT: '#515970', SCHEDULED: '#1d4ed8', ACTIVE: '#0f7a4a',
  PAUSED: '#8a5300', EXPIRED: '#be185d', ENDED: '#515970',
};

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export default function AdminPromotionsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  // `settings:write` is held by super-admin only; an admin gets read-only and the server refuses
  // their writes regardless of what this shell paints. A demo session has no backend principal.
  const mayWrite = !isDemoSession && (user?.permissions ?? []).includes('settings:write');

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<PromotionType>('DEPOSIT_BONUS');
  const [notice, setNotice] = useState<string | null>(null);

  const list = useQuery({ queryKey: ['admin', 'promotions'], queryFn: () => adminPromotionsApi.list({ limit: 100 }) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'promotions'] });

  const create = useMutation({
    mutationFn: () => adminPromotionsApi.create({ code: code.trim(), name: name.trim(), type }),
    onSuccess: (p) => { setCode(''); setName(''); setNotice(`Created ${p.code} as ${p.status}.`); invalidate(); },
    onError: () => setNotice(null),
  });

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: PromotionStatus }) => adminPromotionsApi.setStatus(v.id, v.status),
    onSuccess: () => { setNotice('Status updated.'); invalidate(); },
    onError: () => setNotice(null),
  });

  const d = list.data;

  return (
    <div
      data-testid="admin-promotions"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 1100, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Promotions</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px' }}>
        {mayWrite
          ? 'Promotions are published offers. New ones start as drafts and must be activated.'
          : 'Read-only: changing promotions requires super-admin. The server refuses writes from this account.'}
      </p>

      {list.isLoading ? (
        <div data-testid="promotions-loading" style={{ ...PANEL, height: 100 }} />
      ) : list.isError ? (
        <div data-testid="promotions-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load promotions.
        </div>
      ) : d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {mayWrite ? (
            <section data-testid="promotion-create" style={{ ...PANEL, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>New promotion</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                <label style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Code</span>
                  <input data-testid="promotion-code-input" value={code}
                         onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELCOME25" style={FIELD} />
                </label>
                <label style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Name</span>
                  <input data-testid="promotion-name-input" value={name}
                         onChange={(e) => setName(e.target.value)} placeholder="Welcome offer" style={FIELD} />
                </label>
                <label style={{ flex: '1 1 160px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Type</span>
                  <select data-testid="promotion-type-input" value={type}
                          onChange={(e) => setType(e.target.value as PromotionType)} style={FIELD}>
                    {PROMOTION_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                  </select>
                </label>
              </div>
              <button
                data-testid="promotion-create-submit"
                onClick={() => create.mutate()}
                disabled={code.trim().length < 3 || name.trim().length < 2 || create.isPending}
                style={{ ...FIELD, marginTop: 10, fontWeight: 700, cursor: 'pointer',
                         border: '1px solid #86c9a6', background: '#e6f6ee',
                         opacity: code.trim().length < 3 || name.trim().length < 2 ? 0.6 : 1 }}
              >
                {create.isPending ? 'Creating…' : 'Create draft'}
              </button>
              {create.isError ? (
                <p data-testid="promotion-create-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: '8px 0 0' }}>
                  Could not create. Nothing was saved — the code may already exist.
                </p>
              ) : null}
            </section>
          ) : null}

          {notice ? (
            <span data-testid="promotions-notice" role="status" style={{ fontSize: 12, color: '#0f7a4a' }}>{notice}</span>
          ) : null}
          {setStatus.isError ? (
            <span data-testid="promotions-mutation-error" role="alert" style={{ fontSize: 12, color: '#b42318' }}>
              That change was refused by the server and was NOT applied.
            </span>
          ) : null}

          {d.items.length === 0 ? (
            <div data-testid="promotions-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
              No promotions yet.
            </div>
          ) : (
            <section style={{ minWidth: 0 }}>
              <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
                <table data-testid="promotions-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560, fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['Code', 'Name', 'Type', 'Status', 'Redemptions', ...(mayWrite ? ['Change status'] : [])].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ccd2e0', whiteSpace: 'nowrap', color: '#515970' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((p) => (
                      <tr key={p.id} data-testid={`promotion-row-${p.code}`}>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>{p.code}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', overflowWrap: 'anywhere', maxWidth: 200 }}>{p.name}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>{label(p.type)}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap', color: STATUS_COLOR[p.status] }}>{label(p.status)}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>
                          {p.currentRedemptions}{p.maxRedemptions !== null ? ` / ${p.maxRedemptions}` : ''}
                        </td>
                        {mayWrite ? (
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>
                            <select
                              data-testid={`promotion-status-${p.code}`}
                              value={p.status}
                              onChange={(e) => setStatus.mutate({ id: p.id, status: e.target.value as PromotionStatus })}
                              style={{ ...FIELD, width: 'auto', minWidth: 130, fontSize: 12 }}
                            >
                              {PROMOTION_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                            </select>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {d.unavailable.length > 0 ? (
            <section data-testid="promotions-unavailable" style={{ ...PANEL, borderColor: '#fff7e6', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#8a5300', marginBottom: 6 }}>
                Awarding is not available
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
