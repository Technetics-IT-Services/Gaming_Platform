import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationChannel, NotificationStatus, NotificationType, Prisma } from '@prisma/client';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { Logger } from 'winston';

import type { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../database/prisma.service';
import { notificationId } from './notification-key.util';
import { NotificationsGateway } from './notifications.gateway';

/**
 * Durable, user-scoped in-app notifications (Phase 2D.1).
 *
 * Replaces the previous `NotImplementedException` stub. Everything here is server-authoritative:
 *
 *   - the recipient is ALWAYS derived from the authenticated principal by the caller
 *     (`@CurrentUser('id')`) or from a server-owned domain record — never from a request body;
 *   - reads and mutations are constrained by `userId` in the WHERE clause, so one player can never
 *     see or modify another player's notifications;
 *   - creation is IDEMPOTENT via a deterministic primary key derived from the domain event
 *     (see `notification-key.util.ts`), enforced by Postgres and durable across restarts;
 *   - `NotificationPreference` is honoured server-side (absent row = enabled).
 *
 * CHANNEL SCOPE: only `IN_APP` is produced. Email, SMS and push have no configured provider in this
 * repository (the mailer runs in log-only mode), so nothing here claims or implies external delivery.
 *
 * FINANCIAL SAFETY: this service never touches wallets, ledgers or settlements. Callers invoke it
 * strictly AFTER a financial transaction has committed, and `safeEmit` swallows failures so an
 * optional notification can never fail or alter a financial outcome.
 */

/** A notification as returned to the owning player. Deliberately free of internal identifiers. */
export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
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

/** Input for creating one notification. `eventKey` is what makes the write idempotent. */
export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Stable, permanent identity of the underlying domain event. No timestamps or random values. */
  eventKey: string;
  /** Non-sensitive references only (ids, amounts, statuses). Never secrets or credentials. */
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /* --------------------------------------------------------------- reads */

  /** The authenticated player's notifications, newest first. `userId` comes from the JWT. */
  async listForUser(userId: string, query: PaginationQueryDto): Promise<NotificationPage> {
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const page = Math.max(1, Number(query.page) || 1);
    const where: Prisma.NotificationWhereInput = { userId, deletedAt: null };

    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        // `id` is a UUIDv7 (monotonic by creation), giving a stable tie-breaker so rows are never
        // duplicated or skipped between pages when several land in the same millisecond.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);

    return {
      items: items.map((n) => this.view(n)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      unread,
    };
  }

  /** Unread badge count for the authenticated player. */
  async unreadCount(userId: string): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({ where: { userId, deletedAt: null, readAt: null } });
    return { unread };
  }

  /** One notification — 404 (not 403) for someone else's row, so ids cannot be probed. */
  async getForUser(userId: string, id: string): Promise<NotificationView> {
    const row = await this.prisma.notification.findFirst({ where: { id, userId, deletedAt: null } });
    if (!row) throw new NotFoundException('Notification not found');
    return this.view(row);
  }

  /* ------------------------------------------------------------ mutations */

  /** Mark one notification read. Ownership is enforced in the WHERE clause; idempotent. */
  async markAsRead(userId: string, id: string): Promise<NotificationView> {
    const row = await this.prisma.notification.findFirst({ where: { id, userId, deletedAt: null } });
    if (!row) throw new NotFoundException('Notification not found');
    if (row.readAt) return this.view(row); // already read — no second write

    const updated = await this.prisma.notification.update({
      where: { id: row.id },
      data: { readAt: new Date(), status: NotificationStatus.READ },
    });
    return this.view(updated);
  }

  /** Mark every unread notification read for the authenticated player only. */
  async markAllAsRead(userId: string): Promise<{ updated: number }> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, deletedAt: null, readAt: null },
      data: { readAt: new Date(), status: NotificationStatus.READ },
    });
    return { updated: res.count };
  }

  /* -------------------------------------------------------------- creation */

  /**
   * Create one notification, exactly once per domain event.
   *
   * Returns the view on first creation, or `null` when the event had already been notified — the
   * caller treats `null` as success, not as an error. Honours `NotificationPreference`.
   */
  async create(input: CreateNotificationInput): Promise<NotificationView | null> {
    if (!(await this.isEnabled(input.userId, input.type))) {
      this.logger.info('notification suppressed by user preference', {
        context: 'NotificationsService', type: input.type, userId: input.userId,
      });
      return null;
    }

    const id = notificationId(input.eventKey);
    try {
      const row = await this.prisma.notification.create({
        data: {
          id,
          userId: input.userId,
          type: input.type,
          channel: NotificationChannel.IN_APP,
          // In-app notifications are delivered the moment they are persisted — the player's next read
          // returns them. This never asserts EMAIL/SMS/PUSH delivery, which has no provider here.
          status: NotificationStatus.SENT,
          sentAt: new Date(),
          title: input.title,
          body: input.body,
          data: (input.data ?? {}) as Prisma.InputJsonValue,
        },
      });

      this.logger.info('notification created', {
        context: 'NotificationsService', notificationId: row.id, type: row.type, userId: input.userId,
      });

      // Best-effort realtime nudge to the player's socket room. Never authoritative: the durable row
      // above is the source of truth, and a socket failure must not affect anything.
      try {
        this.gateway.notify(input.userId, { id: row.id, type: row.type, title: row.title });
      } catch {
        /* the notification is already persisted; realtime is a convenience only */
      }

      return this.view(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // The deterministic primary key already exists ⇒ this exact event was already notified.
        // Expected on retry, duplicate delivery, concurrent processing and after a restart.
        this.logger.info('notification deduplicated', {
          context: 'NotificationsService', notificationId: id, type: input.type,
        });
        return null;
      }
      throw error;
    }
  }

  /**
   * Fire-and-forget creation for callers on a financial path.
   *
   * A notification is NEVER allowed to fail or delay a money movement, so every error is caught and
   * logged here. Callers invoke this only after their transaction has committed.
   */
  async safeEmit(input: CreateNotificationInput): Promise<void> {
    try {
      await this.create(input);
    } catch (error) {
      this.logger.warn('notification processing failed', {
        context: 'NotificationsService',
        type: input.type,
        eventKey: input.eventKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Push a transient realtime payload without persisting. Retained from the previous implementation. */
  pushRealtime(userId: string, payload: Record<string, unknown>): void {
    this.gateway.notify(userId, payload);
  }

  /* --------------------------------------------------------------- helpers */

  /** Server-side preference check. No row means enabled (the column default is `true`). */
  private async isEnabled(userId: string, type: NotificationType): Promise<boolean> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_type_channel: { userId, type, channel: NotificationChannel.IN_APP } },
    });
    return pref?.enabled ?? true;
  }

  /** Map a row to the player-facing view. Internal ids (templateId, channel plumbing) are not exposed. */
  private view(n: {
    id: string; type: NotificationType; title: string; body: string;
    data: Prisma.JsonValue | null; readAt: Date | null; createdAt: Date;
  }): NotificationView {
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: (n.data as Record<string, unknown> | null) ?? null,
      read: n.readAt !== null,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    };
  }
}
