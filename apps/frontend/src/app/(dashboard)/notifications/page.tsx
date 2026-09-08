'use client';

/**
 * Notification centre (Phase 2D.1) — mobile-first, 100% server-backed.
 *
 * This page previously rendered a HARDCODED array of four notifications with `useState` read tracking
 * that was lost on every reload. It is now driven entirely by `GET /notifications`: content, read
 * state, unread count and pagination are all server-authoritative, and read state persists.
 *
 * There is no demo-wallet dependency and no fabricated row. A demo session cannot reach the endpoint
 * (the api-client blocks `/notifications`), so it is shown the real-account notice instead.
 *
 * Only in-app notifications exist — no email, SMS or push provider is configured in this deployment,
 * and nothing here claims otherwise.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Gamepad2, Gift, Megaphone, ShieldCheck, Wallet } from 'lucide-react';
import { useState } from 'react';

import { RealAccountRequired } from '@/components/auth/real-money-guard';
import { useRealSession } from '@/hooks/use-real-session';
import { fmtTime } from '@/lib/datetime';
import { notificationsApi, type NotificationType, type NotificationView } from '@/lib/notifications-api';

const PAGE_SIZE = 20;

/** Icon + tone per server notification type. Purely presentational. */
const TYPE_META: Record<NotificationType, { icon: typeof Bell; tone: string; label: string }> = {
  TRANSACTION: { icon: Wallet, tone: '#0f7a4a', label: 'Wallet' },
  SECURITY: { icon: ShieldCheck, tone: '#8a5300', label: 'Security' },
  GAME: { icon: Gamepad2, tone: '#1d4ed8', label: 'Game' },
  PROMOTION: { icon: Gift, tone: '#be185d', label: 'Promotion' },
  ACCOUNT: { icon: Bell, tone: '#6d28d9', label: 'Account' },
  KYC: { icon: ShieldCheck, tone: '#8a5300', label: 'Verification' },
  SYSTEM: { icon: Megaphone, tone: '#515970', label: 'System' },
};

function meta(type: NotificationType) {
  return TYPE_META[type] ?? TYPE_META.SYSTEM;
}

export default function NotificationsPage() {
  const realSession = useRealSession();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ['notifications', 'list', page],
    queryFn: () => notificationsApi.list({ page, limit: PAGE_SIZE }),
    enabled: realSession,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidate,
  });

  if (!realSession) return <RealAccountRequired />;

  const items = q.data?.items ?? [];
  const unread = q.data?.unread ?? 0;
  const pages = q.data?.pages ?? 0;

  return (
    <div
      data-testid="notifications-page"
      style={{ color: '#1b1f37', maxWidth: 480, margin: '0 auto', padding: '12px 12px 28px', boxSizing: 'border-box' }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '0 2px 12px' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          Notifications
          {unread > 0 ? (
            <span
              data-testid="unread-count"
              style={{ background: '#be185d', color: '#fff', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 800 }}
            >
              {unread}
            </span>
          ) : null}
        </h1>
        <button
          data-testid="mark-all-read"
          onClick={() => markAll.mutate()}
          disabled={unread === 0 || markAll.isPending}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 14px',
            borderRadius: 12, border: '1px solid #b9c1d4', background: unread === 0 ? '#ebeef5' : '#ffffff',
            color: unread === 0 ? '#515970' : '#1b1f37', fontSize: 13, fontWeight: 700,
            cursor: unread === 0 ? 'default' : 'pointer',
          }}
        >
          <CheckCheck size={16} /> Mark all
        </button>
      </header>

      {q.isLoading ? (
        <div data-testid="notifications-loading" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} style={{ height: 78, borderRadius: 14, background: '#ffffff', border: '1px solid #ccd2e0' }} />
          ))}
        </div>
      ) : q.isError ? (
        <div
          data-testid="notifications-error"
          role="alert"
          style={{ border: '1px solid #f0b4b0', background: '#fef2f2', borderRadius: 14, padding: 16, fontSize: 14, color: '#b42318' }}
        >
          Could not load your notifications right now. Please try again.
        </div>
      ) : items.length === 0 ? (
        <div
          data-testid="notifications-empty"
          style={{ textAlign: 'center', padding: '48px 16px', border: '1px dashed #b9c1d4', borderRadius: 16 }}
        >
          <Bell size={30} color="#515970" />
          <p style={{ fontSize: 15, fontWeight: 700, margin: '12px 0 4px' }}>No notifications yet</p>
          <p style={{ fontSize: 13, color: '#515970', margin: 0 }}>
            Deposits, withdrawals and security updates will appear here.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((n) => (
            <NotificationRow key={n.id} n={n} onRead={() => markRead.mutate(n.id)} busy={markRead.isPending} />
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 16 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={pagerStyle(page <= 1)}
          >
            ← Newer
          </button>
          <span style={{ alignSelf: 'center', fontSize: 12, color: '#515970' }}>
            Page {page} of {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages}
            style={pagerStyle(page >= pages)}
          >
            Older →
          </button>
        </nav>
      ) : null}

      <p style={{ fontSize: 11, color: '#626a7e', marginTop: 18, lineHeight: 1.5 }}>
        In-app notifications only. Email, SMS and push delivery are not configured for this deployment.
      </p>
    </div>
  );
}

function pagerStyle(disabled: boolean): React.CSSProperties {
  return {
    minHeight: 44, padding: '0 16px', borderRadius: 12,
    border: '1px solid #b9c1d4', background: '#ffffff',
    color: disabled ? '#515970' : '#1b1f37', fontSize: 13, fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
  };
}

function NotificationRow({ n, onRead, busy }: { n: NotificationView; onRead: () => void; busy: boolean }) {
  const m = meta(n.type);
  const Icon = m.icon;
  return (
    <li
      data-testid={n.read ? 'notification-read' : 'notification-unread'}
      style={{
        display: 'flex', gap: 12, padding: 14, borderRadius: 14,
        background: n.read ? '#ebeef5' : '#ffffff',
        border: `1px solid ${n.read ? '#ccd2e0' : '#b9c1d4'}`,
        borderLeft: `3px solid ${n.read ? 'transparent' : m.tone}`,
      }}
    >
      <span
        style={{
          display: 'inline-flex', width: 36, height: 36, flex: '0 0 36px', alignItems: 'center',
          justifyContent: 'center', borderRadius: 10, background: '#ebeef5', border: '1px solid #ccd2e0',
        }}
      >
        <Icon size={17} color={m.tone} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: n.read ? 600 : 800 }}>{n.title}</span>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: m.tone }}>
            {m.label}
          </span>
        </div>
        {/* Server-generated text rendered as TEXT — never as HTML. */}
        <p style={{ fontSize: 13, color: '#515970', margin: '4px 0 6px', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
          {n.body}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <time style={{ fontSize: 11, color: '#626a7e' }} dateTime={n.createdAt}>
            {fmtTime(new Date(n.createdAt).getTime())}
          </time>
          {!n.read ? (
            <button
              data-testid="mark-read"
              onClick={onRead}
              disabled={busy}
              style={{
                minHeight: 44, padding: '0 12px', borderRadius: 10, border: '1px solid #b9c1d4',
                background: 'transparent', color: '#1d4ed8', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Mark read
            </button>
          ) : null}
        </div>
      </div>

      {!n.read ? (
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: m.tone, alignSelf: 'center', flex: '0 0 8px' }} />
      ) : null}
    </li>
  );
}
