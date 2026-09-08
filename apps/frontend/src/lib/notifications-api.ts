import { apiClient, unwrap } from './api-client';

/**
 * Player notification API client (Phase 2D.1).
 *
 * Every endpoint is user-scoped on the server from the JWT — this client never sends a `userId`, and
 * there is no way for it to request another player's notifications. All content is server-generated;
 * nothing here is fabricated, hardcoded or demo-backed.
 *
 * Only `IN_APP` notifications exist. Email, SMS and push have no configured provider in this
 * deployment, so this client must never imply that an external message was sent.
 */

/** Matches the backend `NotificationType` enum. */
export type NotificationType = 'SYSTEM' | 'TRANSACTION' | 'PROMOTION' | 'SECURITY' | 'GAME' | 'ACCOUNT' | 'KYC';

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Non-sensitive references only (record ids, amounts, statuses). Never secrets. */
  data: Record<string, unknown> | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationView[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  unread: number;
}

export const notificationsApi = {
  list: (params: { page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && q.set(k, String(v)));
    const qs = q.toString();
    return unwrap<NotificationPage>(apiClient.get(`/notifications${qs ? `?${qs}` : ''}`));
  },
  unreadCount: () => unwrap<{ unread: number }>(apiClient.get('/notifications/unread-count')),
  get: (id: string) => unwrap<NotificationView>(apiClient.get(`/notifications/${id}`)),
  markRead: (id: string) => unwrap<NotificationView>(apiClient.patch(`/notifications/${id}/read`, {})),
  markAllRead: () => unwrap<{ updated: number }>(apiClient.patch('/notifications/read-all', {})),
};
