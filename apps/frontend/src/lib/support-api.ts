import { apiClient, unwrap } from './api-client';

/**
 * Support ticketing API client.
 *
 * Every ticket and message is SERVER state. No route takes a user id — the server always scopes to
 * the authenticated caller, which is what makes cross-player access impossible.
 */

export const TICKET_CATEGORIES = [
  'ACCOUNT', 'DEPOSIT', 'WITHDRAWAL', 'GAME', 'BONUS', 'TECHNICAL', 'RESPONSIBLE_GAMING', 'OTHER',
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_PLAYER' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface TicketMessage {
  id: string;
  body: string;
  isFromAgent: boolean;
  createdAt: string;
}

export interface Ticket {
  id: string;
  reference: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  lastMessageAt: string;
  closedAt: string | null;
  messages?: TicketMessage[];
  messageCount?: number;
}

export interface TicketPage {
  items: Ticket[];
  total: number;
  page: number;
  limit: number;
}

export const supportApi = {
  list: (page = 1, limit = 20) =>
    unwrap<TicketPage>(apiClient.get(`/support/tickets?page=${page}&limit=${limit}`)),

  get: (id: string) => unwrap<Ticket>(apiClient.get(`/support/tickets/${id}`)),

  /** The client sends only subject, category and message — never status, priority or a user id. */
  create: (input: { subject: string; category: TicketCategory; message: string }) =>
    unwrap<Ticket>(apiClient.post('/support/tickets', input)),

  reply: (id: string, message: string) =>
    unwrap<Ticket>(apiClient.post(`/support/tickets/${id}/reply`, { message })),

  close: (id: string) => unwrap<Ticket>(apiClient.post(`/support/tickets/${id}/close`, {})),

  reopen: (id: string) => unwrap<Ticket>(apiClient.post(`/support/tickets/${id}/reopen`, {})),
};
