'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';

import { useRealSession } from '@/hooks/use-real-session';
import { notificationsApi } from '@/lib/notifications-api';

/**
 * Notification bell + unread badge (Phase 2D.1).
 *
 * Replaces a hardcoded four-item array that also rendered a permanent "new" dot regardless of state.
 * The count now comes from `GET /notifications/unread-count` and is **server-authoritative**: when the
 * player has nothing unread, no badge is shown at all.
 *
 * Gated on `useRealSession()` — a demo session has no backend principal, so it must not call the
 * user-scoped endpoint (the api-client blocks `/notifications` for demo sessions regardless).
 *
 * Mobile-first: unlike the previous version this is rendered at every breakpoint, because on a phone
 * the bell is the only entry point to the notification centre.
 */
export function NotificationsMenu() {
  const realSession = useRealSession();

  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationsApi.unreadCount,
    enabled: realSession,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const unread = data?.unread ?? 0;
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <Link
      href="/notifications"
      aria-label={label}
      data-testid="notifications-bell"
      // Explicit pixels, not `h-11`: rem-based sizing renders below the 44px comfortable touch
      // target on this app's root font scale (measured 38.5px), and the bell is the ONLY entry point
      // to notifications on a phone.
      style={{ minHeight: 44, minWidth: 44 }}
      className="relative flex items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="h-[18px] w-[18px]" />
      {unread > 0 ? (
        <span
          data-testid="notifications-badge"
          className="absolute right-0.5 top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-pink px-1 text-[10px] font-bold leading-[18px] text-white"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
