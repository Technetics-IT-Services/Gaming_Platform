'use client';

/**
 * Support tickets — REAL, server-backed conversations.
 *
 * Phase 2C.10 shipped `/support` as a static FAQ that honestly said it could not file tickets.
 * That gap is now closed: everything here reads and writes `GET/POST /support/tickets`, which is
 * scoped server-side to the authenticated caller. There is no local ticket state, no fake counts
 * and no demo data.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  supportApi,
  TICKET_CATEGORIES,
  type Ticket,
  type TicketCategory,
} from '@/lib/support-api';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};

const STATUS_COLOR: Record<string, string> = {
  OPEN: '#1d4ed8', IN_PROGRESS: '#8a5300', WAITING_ON_PLAYER: '#be185d',
  RESOLVED: '#0f7a4a', CLOSED: '#515970',
};

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export default function SupportTicketsPage() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('ACCOUNT');
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');
  const [creating, setCreating] = useState(false);

  const list = useQuery({ queryKey: ['support', 'tickets'], queryFn: () => supportApi.list() });
  const detail = useQuery({
    queryKey: ['support', 'ticket', openId],
    queryFn: () => supportApi.get(openId!),
    enabled: !!openId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['support', 'tickets'] });
    if (openId) qc.invalidateQueries({ queryKey: ['support', 'ticket', openId] });
  };

  const create = useMutation({
    mutationFn: () => supportApi.create({ subject, category, message }),
    onSuccess: (t: Ticket) => {
      setSubject(''); setMessage(''); setCreating(false); setOpenId(t.id); invalidate();
    },
  });

  const sendReply = useMutation({
    mutationFn: () => supportApi.reply(openId!, reply),
    onSuccess: () => { setReply(''); invalidate(); },
  });

  const close = useMutation({ mutationFn: () => supportApi.close(openId!), onSuccess: invalidate });
  const reopen = useMutation({ mutationFn: () => supportApi.reopen(openId!), onSuccess: invalidate });

  const d = detail.data;

  return (
    <div
      data-testid="support-tickets"
      style={{ color: '#1b1f37', width: '100%', maxWidth: 480, minWidth: 0, margin: '0 auto', padding: '12px 12px 28px', boxSizing: 'border-box' }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 6px' }}>My support tickets</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        Messages go to our support team. Only you and our agents can see your tickets.
      </p>

      {!openId ? (
        <>
          {!creating ? (
            <button
              data-testid="support-new"
              onClick={() => setCreating(true)}
              style={{ ...FIELD, minHeight: 44, fontWeight: 700, cursor: 'pointer', border: '1px solid #86c9a6', background: '#e6f6ee', marginBottom: 14 }}
            >
              New ticket
            </button>
          ) : (
            <section data-testid="support-create" style={{ ...PANEL, marginBottom: 14, minWidth: 0 }}>
              <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 10px' }}>New ticket</h2>
              <label style={{ display: 'block', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#515970' }}>Subject</span>
                <input data-testid="support-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
                       placeholder="Briefly, what is wrong?" style={FIELD} />
              </label>
              <label style={{ display: 'block', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#515970' }}>Category</span>
                <select data-testid="support-category" value={category}
                        onChange={(e) => setCategory(e.target.value as TicketCategory)} style={FIELD}>
                  {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                </select>
              </label>
              <label style={{ display: 'block', marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: '#515970' }}>Message</span>
                <textarea data-testid="support-message" value={message} onChange={(e) => setMessage(e.target.value)}
                          rows={5} style={{ ...FIELD, minHeight: 96, resize: 'vertical' }} />
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  data-testid="support-submit"
                  onClick={() => create.mutate()}
                  disabled={subject.trim().length < 3 || message.trim().length < 1 || create.isPending}
                  style={{ ...FIELD, flex: '1 1 140px', width: 'auto', fontWeight: 700, cursor: 'pointer',
                           border: '1px solid #86c9a6', background: '#e6f6ee',
                           opacity: subject.trim().length < 3 || !message.trim() ? 0.6 : 1 }}
                >
                  {create.isPending ? 'Sending…' : 'Send'}
                </button>
                <button onClick={() => setCreating(false)}
                        style={{ ...FIELD, flex: '1 1 100px', width: 'auto', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
              {create.isError ? (
                <p data-testid="support-create-error" role="alert" style={{ fontSize: 12, color: '#b42318', marginBottom: 0 }}>
                  Could not create the ticket. It was NOT sent — please try again.
                </p>
              ) : null}
            </section>
          )}

          {list.isLoading ? (
            <div data-testid="support-loading" style={{ ...PANEL, height: 80 }} />
          ) : list.isError ? (
            <div data-testid="support-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
              Could not load your tickets. Please try again.
            </div>
          ) : list.data && list.data.items.length > 0 ? (
            <ul data-testid="support-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.data.items.map((t) => (
                <li key={t.id}>
                  <button
                    data-testid={`support-ticket-${t.reference}`}
                    onClick={() => setOpenId(t.id)}
                    style={{ ...PANEL, width: '100%', minHeight: 44, textAlign: 'left', cursor: 'pointer', color: '#1b1f37' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 14 }}>{t.subject}</strong>
                      <span style={{ fontSize: 11, color: STATUS_COLOR[t.status] ?? '#515970' }}>{label(t.status)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#515970', marginTop: 4 }}>
                      {t.reference} · {label(t.category)} · {new Date(t.lastMessageAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div data-testid="support-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
              You have no tickets yet. Open one and our team will reply here.
            </div>
          )}
        </>
      ) : (
        <>
          <button data-testid="support-back" onClick={() => setOpenId(null)}
                  style={{ ...FIELD, minHeight: 44, marginBottom: 12, cursor: 'pointer', width: 'auto', padding: '0 16px' }}>
            ← All tickets
          </button>

          {detail.isLoading ? (
            <div data-testid="support-detail-loading" style={{ ...PANEL, height: 120 }} />
          ) : detail.isError ? (
            <div data-testid="support-detail-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
              Could not load this ticket.
            </div>
          ) : d ? (
            <section data-testid="support-detail" style={{ ...PANEL, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <strong style={{ fontSize: 15 }}>{d.subject}</strong>
                <span data-testid="support-status" style={{ fontSize: 12, color: STATUS_COLOR[d.status] ?? '#515970' }}>
                  {label(d.status)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#515970', marginBottom: 12 }}>
                {d.reference} · {label(d.category)}
              </div>

              <ul data-testid="support-messages" style={{ listStyle: 'none', margin: '0 0 12px', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(d.messages ?? []).map((m) => (
                  <li key={m.id}
                      style={{
                        border: '1px solid #ccd2e0', borderRadius: 10, padding: 10,
                        background: m.isFromAgent ? '#ebeef5' : '#ebeef5',
                        // Long messages must wrap, never widen the page.
                        overflowWrap: 'anywhere', minWidth: 0,
                      }}>
                    <div style={{ fontSize: 11, color: '#515970', marginBottom: 4 }}>
                      {m.isFromAgent ? 'Support' : 'You'} · {new Date(m.createdAt).toLocaleString()}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.body}</div>
                  </li>
                ))}
              </ul>

              {d.status !== 'CLOSED' ? (
                <>
                  <textarea data-testid="support-reply" value={reply} onChange={(e) => setReply(e.target.value)}
                            rows={3} placeholder="Write a reply…"
                            style={{ ...FIELD, minHeight: 72, resize: 'vertical', marginBottom: 8 }} />
                  <button
                    data-testid="support-reply-send"
                    onClick={() => sendReply.mutate()}
                    disabled={!reply.trim() || sendReply.isPending}
                    style={{ ...FIELD, minHeight: 44, fontWeight: 700, cursor: 'pointer',
                             border: '1px solid #86c9a6', background: '#e6f6ee',
                             opacity: !reply.trim() ? 0.6 : 1, marginBottom: 8 }}
                  >
                    {sendReply.isPending ? 'Sending…' : 'Send reply'}
                  </button>
                </>
              ) : null}

              {d.status === 'CLOSED' ? (
                <button data-testid="support-reopen" onClick={() => reopen.mutate()} disabled={reopen.isPending}
                        style={{ ...FIELD, minHeight: 44, cursor: 'pointer' }}>
                  {reopen.isPending ? 'Reopening…' : 'Reopen ticket'}
                </button>
              ) : (
                <button data-testid="support-close" onClick={() => close.mutate()} disabled={close.isPending}
                        style={{ ...FIELD, minHeight: 44, cursor: 'pointer' }}>
                  {close.isPending ? 'Closing…' : 'Close ticket'}
                </button>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
