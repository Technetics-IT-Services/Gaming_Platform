'use client';

/**
 * Operator partner administration.
 *
 * READ needs `partners:read` (admin + super-admin). Every WRITE needs `partners:write`, which only
 * super-admin holds — the client enumeration puts "manage partners" and "change partner percentages"
 * under SUPER ADMIN. Write controls are hidden without that permission **and** refused server-side
 * regardless, so hiding is convenience, not security.
 *
 * The allocation figures come from the SERVER's `allocation` object; this page never sums shares.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { canWritePartners } from '@/lib/partner-access';
import {
  adminPartnerApi,
  PARTNER_STATUSES,
  type PartnerStatus,
} from '@/lib/partner-api';
import { useAuthStore } from '@/stores/auth-store';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};

const STATUS_COLOR: Record<PartnerStatus, string> = {
  PENDING: '#8a5300', ACTIVE: '#0f7a4a', SUSPENDED: '#be185d', TERMINATED: '#515970',
};

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export default function AdminPartnersPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  const mayWrite = canWritePartners(user, isDemoSession);

  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [share, setShare] = useState('');
  const [memberUserId, setMemberUserId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const list = useQuery({ queryKey: ['admin', 'partners'], queryFn: () => adminPartnerApi.list({ limit: 100 }) });
  const members = useQuery({
    queryKey: ['admin', 'partners', openId, 'members'],
    queryFn: () => adminPartnerApi.members(openId!),
    enabled: !!openId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'partners'] });

  const create = useMutation({
    mutationFn: () => adminPartnerApi.create({ name, revenueSharePercent: share || undefined }),
    onSuccess: (p) => { setName(''); setShare(''); setNotice(`Created ${p.code} (${p.status}).`); invalidate(); },
    onError: () => setNotice(null),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: PartnerStatus }) => adminPartnerApi.setStatus(v.id, v.status),
    onSuccess: () => { setNotice('Status updated.'); invalidate(); },
    onError: () => setNotice(null),
  });
  const setShareMut = useMutation({
    mutationFn: (v: { id: string; percent: string }) => adminPartnerApi.setShare(v.id, v.percent),
    onSuccess: () => { setNotice('Revenue share updated.'); invalidate(); },
    onError: () => setNotice(null),
  });
  const addMember = useMutation({
    mutationFn: () => adminPartnerApi.addMember(openId!, memberUserId),
    onSuccess: () => {
      setMemberUserId(''); setNotice('Member linked and granted the partner role.');
      qc.invalidateQueries({ queryKey: ['admin', 'partners'] });
    },
    onError: () => setNotice(null),
  });

  const d = list.data;

  return (
    <div
      data-testid="admin-partners"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 1100, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Partners</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px' }}>
        {mayWrite
          ? 'Ownership percentages are configuration, not money. The server enforces that active shares never exceed 100%.'
          : 'Read-only: changing partners requires super-admin. The server refuses writes from this account.'}
      </p>

      {list.isLoading ? (
        <div data-testid="partners-loading" style={{ ...PANEL, height: 100 }} />
      ) : list.isError ? (
        <div data-testid="partners-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load partners.
        </div>
      ) : d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {/* --------------------------------------------------- allocation */}
          <section data-testid="partners-allocation" style={{ ...PANEL, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Revenue-share allocation</div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
              <span>Allocated: <strong data-testid="allocated-percent">{d.allocation.allocatedPercent}%</strong></span>
              <span>Unallocated: <strong data-testid="unallocated-percent">{d.allocation.unallocatedPercent}%</strong></span>
            </div>
            <p style={{ fontSize: 11, color: '#626a7e', margin: '8px 0 0', lineHeight: 1.5 }}>
              {d.allocation.note}
            </p>
          </section>

          {/* ------------------------------------------------------- create */}
          {mayWrite ? (
            <section data-testid="partner-create" style={{ ...PANEL, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>New partner</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                <label style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Organisation name</span>
                  <input data-testid="partner-name-input" value={name} onChange={(e) => setName(e.target.value)}
                         placeholder="Acme Holdings" style={FIELD} />
                </label>
                <label style={{ flex: '1 1 130px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Share % (optional)</span>
                  <input data-testid="partner-share-input" inputMode="decimal" value={share}
                         onChange={(e) => setShare(e.target.value)} placeholder="10" style={FIELD} />
                </label>
              </div>
              <button
                data-testid="partner-create-submit"
                onClick={() => create.mutate()}
                disabled={name.trim().length < 2 || create.isPending}
                style={{ ...FIELD, marginTop: 10, fontWeight: 700, cursor: 'pointer',
                         border: '1px solid #86c9a6', background: '#e6f6ee',
                         opacity: name.trim().length < 2 ? 0.6 : 1 }}
              >
                {create.isPending ? 'Creating…' : 'Create partner'}
              </button>
              <p style={{ fontSize: 11, color: '#626a7e', margin: '8px 0 0' }}>
                Created as <strong>pending</strong>. The code is generated by the server.
              </p>
              {create.isError ? (
                <p data-testid="partner-create-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: '8px 0 0' }}>
                  Could not create. Nothing was saved — the share may exceed the remaining allocation.
                </p>
              ) : null}
            </section>
          ) : null}

          {notice ? (
            <span data-testid="partners-notice" role="status" style={{ fontSize: 12, color: '#0f7a4a' }}>{notice}</span>
          ) : null}
          {(setStatus.isError || setShareMut.isError || addMember.isError) ? (
            <span data-testid="partners-mutation-error" role="alert" style={{ fontSize: 12, color: '#b42318' }}>
              That change was refused by the server and was NOT applied.
            </span>
          ) : null}

          {/* --------------------------------------------------------- list */}
          {d.items.length === 0 ? (
            <div data-testid="partners-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
              No partners yet.
            </div>
          ) : (
            <section style={{ minWidth: 0 }}>
              {/* Wide table scrolls inside THIS container, never the page. */}
              <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
                <table data-testid="partners-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520, fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['Code', 'Name', 'Status', 'Share %', 'Members', ...(mayWrite ? ['Actions'] : [])].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ccd2e0', whiteSpace: 'nowrap', color: '#515970' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((p) => (
                      <tr key={p.id} data-testid={`partner-row-${p.code}`}>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>
                          <button onClick={() => setOpenId(openId === p.id ? null : p.id)}
                                  style={{ background: 'none', border: 'none', color: '#1d4ed8', cursor: 'pointer', padding: 0, minHeight: 44, fontSize: 12 }}>
                            {p.code}
                          </button>
                        </td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', overflowWrap: 'anywhere', maxWidth: 220 }}>{p.name}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap', color: STATUS_COLOR[p.status] }}>{label(p.status)}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>{p.revenueSharePercent}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>{p.memberCount}</td>
                        {mayWrite ? (
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>
                            <select
                              data-testid={`partner-status-${p.code}`}
                              value={p.status}
                              onChange={(e) => setStatus.mutate({ id: p.id, status: e.target.value as PartnerStatus })}
                              style={{ ...FIELD, width: 'auto', minWidth: 130, fontSize: 12 }}
                            >
                              {PARTNER_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
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

          {/* ------------------------------------------------------ detail */}
          {openId ? (
            <section data-testid="partner-detail" style={{ ...PANEL, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>Members</div>
              {members.isLoading ? (
                <div style={{ height: 40, opacity: 0.4 }} />
              ) : members.isError ? (
                <div role="alert" style={{ fontSize: 12, color: '#b42318' }}>Could not load members.</div>
              ) : members.data && members.data.length > 0 ? (
                <ul data-testid="partner-members" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {members.data.map((m) => (
                    <li key={m.userId} style={{ fontSize: 12, opacity: 0.85, overflowWrap: 'anywhere' }}>
                      {m.username}{m.isPrimary ? ' · primary' : ''} · {label(m.status)} · joined {new Date(m.joinedAt).toLocaleDateString()}
                    </li>
                  ))}
                </ul>
              ) : (
                <div data-testid="partner-members-empty" style={{ fontSize: 12, color: '#515970' }}>
                  No users linked yet.
                </div>
              )}

              {mayWrite ? (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                  <label style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: '#515970' }}>Link an existing user (user id)</span>
                    <input data-testid="partner-member-input" value={memberUserId}
                           onChange={(e) => setMemberUserId(e.target.value)}
                           placeholder="00000000-0000-0000-0000-000000000000" style={FIELD} />
                  </label>
                  <button
                    data-testid="partner-member-add"
                    onClick={() => addMember.mutate()}
                    disabled={memberUserId.trim().length < 10 || addMember.isPending}
                    style={{ ...FIELD, flex: '0 0 auto', width: 'auto', padding: '0 16px', cursor: 'pointer',
                             alignSelf: 'flex-end', opacity: memberUserId.trim().length < 10 ? 0.6 : 1 }}
                  >
                    {addMember.isPending ? 'Linking…' : 'Link user'}
                  </button>
                </div>
              ) : null}

              {mayWrite ? (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                  <label style={{ flex: '1 1 160px', minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: '#515970' }}>Set revenue share %</span>
                    <input data-testid="partner-setshare-input" inputMode="decimal" value={share}
                           onChange={(e) => setShare(e.target.value)} placeholder="25" style={FIELD} />
                  </label>
                  <button
                    data-testid="partner-setshare-submit"
                    onClick={() => setShareMut.mutate({ id: openId, percent: share })}
                    disabled={!share.trim() || setShareMut.isPending}
                    style={{ ...FIELD, flex: '0 0 auto', width: 'auto', padding: '0 16px', cursor: 'pointer',
                             alignSelf: 'flex-end', opacity: !share.trim() ? 0.6 : 1 }}
                  >
                    {setShareMut.isPending ? 'Saving…' : 'Set share'}
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
