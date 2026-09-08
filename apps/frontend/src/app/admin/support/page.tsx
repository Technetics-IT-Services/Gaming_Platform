'use client';

/**
 * Admin support queue — server-backed, server-authorized.
 *
 * `AdminGuard` keeps this out of a player's browser, but it is NOT the security boundary: every
 * request below is independently authorized by the backend against `support:read` / `support:write`.
 * A player calling these endpoints directly gets 403 regardless of what the UI does.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { apiClient, unwrap } from '@/lib/api-client';
import type { Ticket, TicketStatus } from '@/lib/support-api';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};

const STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_PLAYER', 'RESOLVED', 'CLOSED'];
const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

interface AgentTicket extends Ticket {
  userId: string;
  assignedToUserId: string | null;
  messages: (Ticket['messages'] extends (infer M)[] | undefined ? M & { isInternal: boolean } : never)[];
}

const adminSupportApi = {
  queue: (status?: string) =>
    unwrap<{ items: AgentTicket[]; total: number }>(
      apiClient.get(`/admin/support/tickets${status ? `?status=${status}` : ''}`),
    ),
  get: (id: string) => unwrap<AgentTicket>(apiClient.get(`/admin/support/tickets/${id}`)),
  reply: (id: string, message: string, internal: boolean) =>
    unwrap<AgentTicket>(apiClient.post(`/admin/support/tickets/${id}/reply`, { message, internal })),
  setStatus: (id: string, status: TicketStatus) =>
    unwrap<AgentTicket>(apiClient.post(`/admin/support/tickets/${id}/status`, { status })),
};

export default function AdminSupportPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);

  const queue = useQuery({
    queryKey: ['admin', 'support', statusFilter],
    queryFn: () => adminSupportApi.queue(statusFilter || undefined),
  });
  const detail = useQuery({
    queryKey: ['admin', 'support', 'ticket', openId],
    queryFn: () => adminSupportApi.get(openId!),
    enabled: !!openId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'support'] });
  };

  const send = useMutation({
    mutationFn: () => adminSupportApi.reply(openId!, reply, internal),
    onSuccess: () => { setReply(''); setInternal(false); invalidate(); },
  });
  const changeStatus = useMutation({
    mutationFn: (s: TicketStatus) => adminSupportApi.setStatus(openId!, s),
    onSuccess: invalidate,
  });

  const d = detail.data;

  return (
    <div
      data-testid="admin-support"
      style={{ color: '#1b1f37', width: '100%', maxWidth: 1100, minWidth: 0, margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box' }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Support queue</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px' }}>
        Every action here is authorized by the backend, not by this screen.
      </p>

      {!openId ? (
        <>
          <label style={{ display: 'block', maxWidth: 260, marginBottom: 12 }}>
            <span style={{ fontSize: 11, color: '#515970' }}>Status</span>
            <select data-testid="admin-support-filter" value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)} style={FIELD}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </label>

          {queue.isLoading ? (
            <div data-testid="admin-support-loading" style={{ ...PANEL, height: 80 }} />
          ) : queue.isError ? (
            <div data-testid="admin-support-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
              Could not load the queue.
            </div>
          ) : queue.data && queue.data.items.length > 0 ? (
            <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
              <table data-testid="admin-support-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420, fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Reference', 'Subject', 'Category', 'Priority', 'Status', 'Updated'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ccd2e0', whiteSpace: 'nowrap', color: '#515970' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queue.data.items.map((t) => (
                    <tr key={t.id} data-testid={`admin-ticket-${t.reference}`} onClick={() => setOpenId(t.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>{t.reference}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff' }}>{t.subject}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>{label(t.category)}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>{label(t.priority)}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>{label(t.status)}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>{new Date(t.lastMessageAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div data-testid="admin-support-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
              No tickets match this filter.
            </div>
          )}
        </>
      ) : (
        <>
          <button data-testid="admin-support-back" onClick={() => setOpenId(null)}
                  style={{ ...FIELD, width: 'auto', padding: '0 16px', marginBottom: 12, cursor: 'pointer' }}>
            ← Queue
          </button>

          {d ? (
            <section data-testid="admin-support-detail" style={{ ...PANEL, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15 }}>{d.subject}</strong>
                <span style={{ fontSize: 12, color: '#515970' }}>{d.reference} · {label(d.status)}</span>
              </div>

              <ul style={{ listStyle: 'none', margin: '12px 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(d.messages ?? []).map((m) => (
                  <li key={m.id}
                      style={{
                        border: `1px solid ${m.isInternal ? '#fff7e6' : '#ccd2e0'}`, borderRadius: 10, padding: 10,
                        background: m.isFromAgent ? '#ebeef5' : '#ebeef5', overflowWrap: 'anywhere', minWidth: 0,
                      }}>
                    <div style={{ fontSize: 11, color: '#515970', marginBottom: 4 }}>
                      {m.isInternal ? 'Internal note' : m.isFromAgent ? 'Agent' : 'Player'} · {new Date(m.createdAt).toLocaleString()}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.body}</div>
                  </li>
                ))}
              </ul>

              <textarea data-testid="admin-support-reply" value={reply} onChange={(e) => setReply(e.target.value)}
                        rows={3} placeholder="Reply to the player…" style={{ ...FIELD, minHeight: 72, resize: 'vertical', marginBottom: 8 }} />

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 13, cursor: 'pointer' }}>
                <input data-testid="admin-support-internal" type="checkbox" checked={internal}
                       onChange={(e) => setInternal(e.target.checked)} style={{ width: 18, height: 18 }} />
                Internal note (never shown to the player)
              </label>

              <button data-testid="admin-support-send" onClick={() => send.mutate()}
                      disabled={!reply.trim() || send.isPending}
                      style={{ ...FIELD, minHeight: 44, fontWeight: 700, cursor: 'pointer',
                               border: '1px solid #86c9a6', background: '#e6f6ee',
                               opacity: !reply.trim() ? 0.6 : 1, marginBottom: 10 }}>
                {send.isPending ? 'Sending…' : internal ? 'Add internal note' : 'Send reply'}
              </button>

              <label style={{ display: 'block', maxWidth: 260 }}>
                <span style={{ fontSize: 11, color: '#515970' }}>Change status</span>
                <select data-testid="admin-support-status" value={d.status}
                        onChange={(e) => changeStatus.mutate(e.target.value as TicketStatus)} style={FIELD}>
                  {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </label>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
