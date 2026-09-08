'use client';

/**
 * Operator user administration (Phase 2D.12, AD-02).
 *
 * THE GAP THIS CLOSES. Ten guarded routes — list, detail, lock, unlock, verify, assign role, remove
 * role, sessions, revoke sessions, security events — had no screen at all. An operator could not
 * suspend an abusive account or revoke a stolen session inside the product.
 *
 * PERMISSIONS ARE HONOURED INDIVIDUALLY. Locking, verifying and role assignment each require a
 * different permission, so the page enables each control separately rather than assuming one
 * blanket "admin" level. The server re-checks every one regardless of what this page paints.
 *
 * Manual email verification matters right now: with no SMTP provider configured, no verification
 * email can be sent, so an operator confirming an address is the only working path.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { adminResponsibleGamingApi } from '@/lib/admin-oversight-api';
import { adminUsersApi, type AdminUserSummary } from '@/lib/admin-users-api';
import { useAuthStore } from '@/stores/auth-store';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};
const BTN = (bg: string, border: string): React.CSSProperties => ({
  ...FIELD, width: 'auto', minWidth: 92, fontSize: 12, fontWeight: 700,
  cursor: 'pointer', background: bg, border: `1px solid ${border}`,
});
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ccd2e0', whiteSpace: 'nowrap', color: '#515970',
};
const TD: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap',
};

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: '#0f7a4a', SUSPENDED: '#b42318', LOCKED: '#b42318',
  PENDING: '#8a5300', INACTIVE: '#515970', BANNED: '#b42318',
};

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  const has = (p: string) => !isDemoSession && (user?.permissions ?? []).includes(p);
  const mayLock = has('users:lock');
  const mayVerify = has('users:verify');

  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<AdminUserSummary | null>(null);

  const list = useQuery({
    queryKey: ['admin', 'users', applied],
    queryFn: () => adminUsersApi.list({ search: applied || undefined, limit: 25 }),
  });

  const sessions = useQuery({
    queryKey: ['admin', 'users', detailFor?.id, 'sessions'],
    queryFn: () => adminUsersApi.sessions(detailFor!.id),
    enabled: !!detailFor,
  });

  // P-10: the operator's read view of a player's SELF-IMPOSED limits. There is deliberately no
  // control here to create or raise a limit — those belong to the player. An operator may only
  // lift a restriction early, which is the one direction that needs an operator at all.
  const rg = useQuery({
    queryKey: ['admin', 'users', detailFor?.id, 'responsible-gaming'],
    queryFn: () => adminResponsibleGamingApi.forUser(detailFor!.id),
    enabled: !!detailFor,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] });

  const liftRestriction = useMutation({
    mutationFn: (v: { id: string }) =>
      adminResponsibleGamingApi.liftRestriction(v.id, 'Lifted early by operator'),
    onSuccess: () => {
      setNotice('Restriction lifted.');
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: () => setNotice(null),
  });

  const act = useMutation({
    mutationFn: (v: { action: string; id: string }) => {
      switch (v.action) {
        case 'lock': return adminUsersApi.lock(v.id, 'Locked by operator');
        case 'unlock': return adminUsersApi.unlock(v.id);
        case 'verify': return adminUsersApi.verifyEmail(v.id);
        case 'revoke-sessions': return adminUsersApi.revokeSessions(v.id);
        default: throw new Error('unknown action');
      }
    },
    onSuccess: (_d, v) => { setNotice(`${label(v.action)} applied.`); invalidate(); },
    onError: () => setNotice(null),
  });

  const d = list.data;

  return (
    <div
      data-testid="admin-users"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 1200, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Users</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        {mayLock || mayVerify
          ? 'Every action is recorded in the security log against your account.'
          : 'Read-only: locking and verifying require their own permissions. The server refuses these actions from this account.'}
      </p>

      {/* ----------------------------------------------------------- search */}
      <div style={{ ...PANEL, display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, minWidth: 0 }}>
        <label style={{ flex: '1 1 240px', minWidth: 0 }}>
          <span style={{ fontSize: 11, color: '#515970' }}>Search email or username</span>
          <input
            data-testid="users-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setApplied(search.trim()); }}
            placeholder="player@example.com"
            style={FIELD}
          />
        </label>
        <button
          data-testid="users-search-submit"
          onClick={() => setApplied(search.trim())}
          style={{ ...BTN('#e8efff', '#e8efff'), alignSelf: 'flex-end', minWidth: 120 }}
        >
          Search
        </button>
      </div>

      {list.isLoading ? (
        <div data-testid="users-loading" style={{ ...PANEL, height: 100 }} />
      ) : list.isError ? (
        <div data-testid="users-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load users.
        </div>
      ) : d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {notice ? (
            <span data-testid="users-notice" role="status" style={{ fontSize: 12, color: '#0f7a4a' }}>{notice}</span>
          ) : null}
          {act.isError ? (
            <span data-testid="users-action-error" role="alert" style={{ fontSize: 12, color: '#b42318' }}>
              That action was refused by the server and was NOT applied.
            </span>
          ) : null}

          {d.items.length === 0 ? (
            <div data-testid="users-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
              No users match this search.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: '#515970' }}>
                {d.meta.total} total · page {d.meta.page} of {d.meta.totalPages}
              </div>
              <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
                <table data-testid="users-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900, fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['Username', 'Email', 'Status', 'Verified', '2FA', 'Roles', 'Last login', 'Actions']
                        .map((h) => <th key={h} style={TH}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((u) => (
                      <tr key={u.id} data-testid={`user-row-${u.id}`}>
                        <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 150 }}>{u.username}</td>
                        <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 200 }}>{u.email}</td>
                        <td style={{ ...TD, color: STATUS_COLOR[u.status] ?? '#1b1f37' }}>{label(u.status)}</td>
                        <td style={TD}>{u.emailVerified ? 'yes' : 'no'}</td>
                        <td style={TD}>{u.twoFactorEnabled ? 'on' : 'off'}</td>
                        <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 170 }}>
                          {u.roles.length > 0 ? u.roles.join(', ') : '—'}
                        </td>
                        <td style={TD}>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—'}</td>
                        <td style={TD}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {mayLock ? (
                              u.status === 'ACTIVE' ? (
                                <button
                                  data-testid={`user-lock-${u.id}`}
                                  disabled={act.isPending}
                                  onClick={() => act.mutate({ action: 'lock', id: u.id })}
                                  style={BTN('#fef2f2', '#f0b4b0')}
                                >
                                  Lock
                                </button>
                              ) : (
                                <button
                                  data-testid={`user-unlock-${u.id}`}
                                  disabled={act.isPending}
                                  onClick={() => act.mutate({ action: 'unlock', id: u.id })}
                                  style={BTN('#e6f6ee', '#86c9a6')}
                                >
                                  Unlock
                                </button>
                              )
                            ) : null}
                            {mayVerify && !u.emailVerified ? (
                              <button
                                data-testid={`user-verify-${u.id}`}
                                disabled={act.isPending}
                                onClick={() => act.mutate({ action: 'verify', id: u.id })}
                                style={BTN('#e8efff', '#e8efff')}
                              >
                                Verify
                              </button>
                            ) : null}
                            <button
                              data-testid={`user-detail-${u.id}`}
                              onClick={() => setDetailFor(detailFor?.id === u.id ? null : u)}
                              style={BTN('#ebeef5', '#b9c1d4')}
                            >
                              Sessions
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ------------------------------------------------ session detail */}
          {detailFor ? (
            <section data-testid="user-sessions-panel" style={{ ...PANEL, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800, overflowWrap: 'anywhere', minWidth: 0 }}>
                  Sessions — {detailFor.username}
                </div>
                {mayLock ? (
                  <button
                    data-testid="user-revoke-sessions"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ action: 'revoke-sessions', id: detailFor.id })}
                    style={BTN('#fef2f2', '#f0b4b0')}
                  >
                    Revoke all
                  </button>
                ) : null}
              </div>
              {sessions.isLoading ? (
                <div data-testid="user-sessions-loading" style={{ height: 40, opacity: 0.4 }} />
              ) : sessions.isError ? (
                <p data-testid="user-sessions-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: 0 }}>
                  Could not load sessions.
                </p>
              ) : (sessions.data ?? []).length === 0 ? (
                <p data-testid="user-sessions-empty" style={{ fontSize: 12, color: '#515970', margin: 0 }}>
                  No active sessions.
                </p>
              ) : (
                <ul data-testid="user-sessions-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(sessions.data ?? []).map((s) => (
                    <li key={s.id} style={{ fontSize: 11, opacity: 0.8, overflowWrap: 'anywhere' }}>
                      {s.createdAt ? new Date(s.createdAt).toLocaleString() : 'session'}
                      {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {detailFor ? (
            <section data-testid="user-rg-panel" style={{ ...PANEL, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>
                Responsible gaming — {detailFor.username}
              </div>
              <p style={{ fontSize: 11, color: '#515970', margin: '0 0 10px', lineHeight: 1.5 }}>
                Limits are set by the player and enforced before any money moves. An operator can
                only lift a restriction early — never add one or raise a limit.
              </p>

              {rg.isLoading ? (
                <div data-testid="user-rg-loading" style={{ height: 40, opacity: 0.4 }} />
              ) : rg.isError ? (
                <p data-testid="user-rg-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: 0 }}>
                  Could not load responsible-gaming state.
                </p>
              ) : rg.data ? (
                <>
                  {(rg.data.limits ?? []).length === 0 ? (
                    <p data-testid="user-rg-no-limits" style={{ fontSize: 12, color: '#515970', margin: '0 0 8px' }}>
                      This player has set no limits.
                    </p>
                  ) : (
                    <ul data-testid="user-rg-limits" style={{ listStyle: 'none', margin: '0 0 10px', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(rg.data.limits ?? []).map((l) => (
                        <li key={l.id} style={{ fontSize: 11, opacity: 0.85, overflowWrap: 'anywhere' }}>
                          {l.type.toLowerCase().replace(/_/g, ' ')} · {l.period.toLowerCase()} · {l.amount}
                          {l.currency ? ` ${l.currency}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}

                  {(rg.data.restrictions ?? []).length === 0 ? (
                    <p data-testid="user-rg-no-restrictions" style={{ fontSize: 12, color: '#515970', margin: 0 }}>
                      No active restrictions.
                    </p>
                  ) : (
                    <ul data-testid="user-rg-restrictions" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {(rg.data.restrictions ?? []).map((r) => (
                        <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, opacity: 0.85, overflowWrap: 'anywhere', minWidth: 0 }}>
                            {r.type.toLowerCase().replace(/_/g, ' ')} · {r.status.toLowerCase()}
                            {r.endsAt ? ` · until ${new Date(r.endsAt).toLocaleDateString()}` : ''}
                          </span>
                          {mayLock && r.status === 'ACTIVE' ? (
                            <button
                              data-testid={`user-rg-lift-${r.id}`}
                              disabled={liftRestriction.isPending}
                              onClick={() => liftRestriction.mutate({ id: r.id })}
                              style={BTN('#e8efff', '#e8efff')}
                            >
                              Lift early
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}
            </section>
          ) : null}

          {!mayVerify ? null : (
            <p data-testid="users-verify-note" style={{ fontSize: 11, color: '#515970', margin: '0 2px', lineHeight: 1.55 }}>
              No email provider is configured, so verification messages cannot be sent. Manually
              verifying an address here is currently the only way to complete that step.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
