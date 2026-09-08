import { randomBytes } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { AuditService } from '../security/audit.service';

/**
 * Support ticketing — real, persisted player↔operator conversations.
 *
 * WHAT EXISTED: nothing. No ticket model, no module; `/support` was a static FAQ page that honestly
 * said it could not file tickets.
 *
 * THE OWNERSHIP RULE — how IDOR is closed:
 * every player-facing query filters on `userId` **inside the WHERE clause**, so a player asking for
 * someone else's ticket gets "not found" from the database itself. Ownership is not a check that
 * runs after loading the row (which can be forgotten); there is no code path that loads a ticket
 * without the owner filter.
 *
 * `isFromAgent` is derived server-side from the caller's role, never accepted from the client, so a
 * player cannot post a message that appears to come from support.
 */

export interface TicketMessageView {
  id: string;
  body: string;
  isFromAgent: boolean;
  createdAt: string;
}

export interface TicketView {
  id: string;
  reference: string;
  subject: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  createdAt: string;
  lastMessageAt: string;
  closedAt: string | null;
  messages?: TicketMessageView[];
  messageCount?: number;
}

/** Statuses in which a player may still add a message. */
const PLAYER_WRITABLE: SupportTicketStatus[] = [
  SupportTicketStatus.OPEN,
  SupportTicketStatus.IN_PROGRESS,
  SupportTicketStatus.WAITING_ON_PLAYER,
  SupportTicketStatus.RESOLVED,
];

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationEventsService,
  ) {}

  private reference(): string {
    return `TKT-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  /* ------------------------------------------------------------------ player */

  async create(input: {
    userId: string;
    subject: string;
    category: SupportTicketCategory;
    priority?: SupportTicketPriority;
    message: string;
  }): Promise<TicketView> {
    // A player may not declare their own ticket URGENT; priority is triage, which is an agent's job.
    // NORMAL is the only value a player-created ticket starts at.
    const ticket = await this.prisma.$transaction(async (tx) => {
      const t = await tx.supportTicket.create({
        data: {
          reference: this.reference(),
          userId: input.userId,
          subject: input.subject.trim(),
          category: input.category,
          priority: SupportTicketPriority.NORMAL,
          status: SupportTicketStatus.OPEN,
        },
      });
      await tx.supportTicketMessage.create({
        data: { ticketId: t.id, authorUserId: input.userId, isFromAgent: false, body: input.message.trim() },
      });
      return t;
    });

    await this.audit.record({
      userId: input.userId,
      action: 'CREATE',
      entityType: 'support_ticket',
      entityId: ticket.id,
      changes: { subjectUserId: input.userId, reference: ticket.reference, category: input.category },
    });

    return this.toView(ticket);
  }

  /** The caller's own tickets. The `userId` filter is what makes cross-player reads impossible. */
  async listMine(userId: string, page = 1, limit = 20): Promise<{ items: TicketView[]; total: number; page: number; limit: number }> {
    const p = Math.max(1, page);
    const l = Math.min(50, Math.max(1, limit));
    const where: Prisma.SupportTicketWhereInput = { userId, deletedAt: null };

    const [rows, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
        include: { _count: { select: { messages: true } } },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({ ...this.toView(r), messageCount: r._count.messages })),
      total, page: p, limit: l,
    };
  }

  /**
   * One of the caller's own tickets, with its conversation.
   *
   * `userId` is part of the WHERE, so another player's id yields `NotFoundException` — the same
   * response as a genuinely missing ticket, which avoids confirming that someone else's id exists.
   * Internal agent notes are excluded.
   */
  async getMine(userId: string, ticketId: string): Promise<TicketView> {
    const t = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId, deletedAt: null },
      include: {
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
          select: { id: true, body: true, isFromAgent: true, createdAt: true },
        },
      },
    });
    if (!t) throw new NotFoundException('Ticket not found.');
    return {
      ...this.toView(t),
      messages: t.messages.map((m) => ({
        id: m.id, body: m.body, isFromAgent: m.isFromAgent, createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /** Player reply. Ownership is enforced by the same WHERE filter. */
  async replyAsPlayer(userId: string, ticketId: string, body: string): Promise<TicketView> {
    const t = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, userId, deletedAt: null } });
    if (!t) throw new NotFoundException('Ticket not found.');
    if (!PLAYER_WRITABLE.includes(t.status)) {
      throw new BadRequestException('This ticket is closed. Reopen it to add a message.');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicketMessage.create({
        data: { ticketId, authorUserId: userId, isFromAgent: false, body: body.trim() },
      });
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          lastMessageAt: now,
          // A player answering a question moves it back into the agents' court.
          status: t.status === SupportTicketStatus.WAITING_ON_PLAYER || t.status === SupportTicketStatus.RESOLVED
            ? SupportTicketStatus.IN_PROGRESS
            : t.status,
        },
      });
    });

    await this.audit.record({
      userId, action: 'UPDATE', entityType: 'support_ticket', entityId: ticketId,
      changes: { subjectUserId: userId, event: 'player_reply' },
    });

    return this.getMine(userId, ticketId);
  }

  /** Player closes their own ticket. */
  async closeMine(userId: string, ticketId: string): Promise<TicketView> {
    const t = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, userId, deletedAt: null } });
    if (!t) throw new NotFoundException('Ticket not found.');
    if (t.status === SupportTicketStatus.CLOSED) return this.getMine(userId, ticketId);

    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: SupportTicketStatus.CLOSED, closedAt: new Date() },
    });
    await this.audit.record({
      userId, action: 'UPDATE', entityType: 'support_ticket', entityId: ticketId,
      changes: { subjectUserId: userId, from: t.status, to: SupportTicketStatus.CLOSED, by: 'player' },
    });
    return this.getMine(userId, ticketId);
  }

  /** Player reopens their own closed/resolved ticket. */
  async reopenMine(userId: string, ticketId: string): Promise<TicketView> {
    const t = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, userId, deletedAt: null } });
    if (!t) throw new NotFoundException('Ticket not found.');
    if (t.status !== SupportTicketStatus.CLOSED && t.status !== SupportTicketStatus.RESOLVED) {
      throw new BadRequestException('This ticket is already open.');
    }

    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: SupportTicketStatus.IN_PROGRESS, closedAt: null, lastMessageAt: new Date() },
    });
    await this.audit.record({
      userId, action: 'UPDATE', entityType: 'support_ticket', entityId: ticketId,
      changes: { subjectUserId: userId, from: t.status, to: SupportTicketStatus.IN_PROGRESS, by: 'player' },
    });
    return this.getMine(userId, ticketId);
  }

  /* ------------------------------------------------------------------- agent */

  /** Operator queue, filterable and paginated. */
  async queue(query: {
    status?: SupportTicketStatus;
    priority?: SupportTicketPriority;
    category?: SupportTicketCategory;
    assignedToUserId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: Prisma.SupportTicketWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.assignedToUserId ? { assignedToUserId: query.assignedToUserId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { lastMessageAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { messages: true } } },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        ...this.toView(r),
        messageCount: r._count.messages,
        userId: r.userId,
        assignedToUserId: r.assignedToUserId,
      })),
      total, page, limit,
    };
  }

  /** One ticket for an agent — includes internal notes, which players never receive. */
  async getForAgent(ticketId: string) {
    const t = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, deletedAt: null },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, body: true, isFromAgent: true, isInternal: true, createdAt: true },
        },
      },
    });
    if (!t) throw new NotFoundException('Ticket not found.');
    return {
      ...this.toView(t),
      userId: t.userId,
      assignedToUserId: t.assignedToUserId,
      messages: t.messages.map((m) => ({
        id: m.id, body: m.body, isFromAgent: m.isFromAgent,
        isInternal: m.isInternal, createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /** Agent reply. `isFromAgent` is set here, from the authenticated agent — never from the body. */
  async replyAsAgent(agentUserId: string, ticketId: string, body: string, isInternal = false) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, deletedAt: null } });
    if (!t) throw new NotFoundException('Ticket not found.');

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicketMessage.create({
        data: { ticketId, authorUserId: agentUserId, isFromAgent: true, isInternal, body: body.trim() },
      });
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          lastMessageAt: now,
          // An internal note is not an answer to the player, so it must not change the status.
          status: isInternal
            ? t.status
            : t.status === SupportTicketStatus.OPEN
              ? SupportTicketStatus.WAITING_ON_PLAYER
              : t.status,
          assignedToUserId: t.assignedToUserId ?? agentUserId,
        },
      });
    });

    await this.audit.record({
      userId: agentUserId, action: 'UPDATE', entityType: 'support_ticket', entityId: ticketId,
      changes: { subjectUserId: t.userId, event: isInternal ? 'agent_internal_note' : 'agent_reply' },
    });

    // Only a real reply notifies the player; an internal note must never leak.
    if (!isInternal) {
      await this.notifications.supportAgentReplied({
        userId: t.userId, ticketId, reference: t.reference, subject: t.subject,
      });
    }

    return this.getForAgent(ticketId);
  }

  async assign(agentUserId: string, ticketId: string, assigneeUserId: string | null) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, deletedAt: null } });
    if (!t) throw new NotFoundException('Ticket not found.');

    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        assignedToUserId: assigneeUserId,
        status: t.status === SupportTicketStatus.OPEN && assigneeUserId ? SupportTicketStatus.IN_PROGRESS : t.status,
      },
    });
    await this.audit.record({
      userId: agentUserId, action: 'UPDATE', entityType: 'support_ticket', entityId: ticketId,
      changes: { subjectUserId: t.userId, event: 'assigned', from: t.assignedToUserId, to: assigneeUserId },
    });
    return this.getForAgent(ticketId);
  }

  async setStatus(agentUserId: string, ticketId: string, status: SupportTicketStatus) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, deletedAt: null } });
    if (!t) throw new NotFoundException('Ticket not found.');
    if (t.status === status) return this.getForAgent(ticketId);

    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status,
        closedAt: status === SupportTicketStatus.CLOSED ? new Date() : null,
        lastMessageAt: new Date(),
      },
    });
    await this.audit.record({
      userId: agentUserId, action: 'UPDATE', entityType: 'support_ticket', entityId: ticketId,
      changes: { subjectUserId: t.userId, event: 'status_changed', from: t.status, to: status },
    });

    await this.notifications.supportTicketStatusChanged({
      userId: t.userId, ticketId, reference: t.reference, status,
    });

    return this.getForAgent(ticketId);
  }

  async setPriority(agentUserId: string, ticketId: string, priority: SupportTicketPriority) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, deletedAt: null } });
    if (!t) throw new NotFoundException('Ticket not found.');

    await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { priority } });
    await this.audit.record({
      userId: agentUserId, action: 'UPDATE', entityType: 'support_ticket', entityId: ticketId,
      changes: { subjectUserId: t.userId, event: 'priority_changed', from: t.priority, to: priority },
    });
    return this.getForAgent(ticketId);
  }

  /* ----------------------------------------------------------------- helper */

  private toView(t: {
    id: string; reference: string; subject: string; category: SupportTicketCategory;
    priority: SupportTicketPriority; status: SupportTicketStatus;
    createdAt: Date; lastMessageAt: Date; closedAt: Date | null;
  }): TicketView {
    return {
      id: t.id,
      reference: t.reference,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      lastMessageAt: t.lastMessageAt.toISOString(),
      closedAt: t.closedAt?.toISOString() ?? null,
    };
  }
}
