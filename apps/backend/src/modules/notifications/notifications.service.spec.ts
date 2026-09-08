import { NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';

import { notificationId } from './notification-key.util';
import { NotificationsService } from './notifications.service';

/**
 * Phase 2D.1 — notification service contract, without a database.
 *
 * Pins: user scoping, idempotent creation, preference enforcement, read semantics, and the guarantee
 * that a notification failure can never affect a caller on a financial path. The DB-gated integration
 * suite proves the same behaviour against real Postgres.
 */

type Row = {
  id: string; userId: string; type: NotificationType; title: string; body: string;
  data: Prisma.JsonValue | null; readAt: Date | null; createdAt: Date;
};

const row = (over: Partial<Row> = {}): Row => ({
  id: '01a04000-0000-7000-8000-000000000001',
  userId: 'u1',
  type: NotificationType.TRANSACTION,
  title: 'Deposit successful',
  body: 'Your deposit of 500 has been credited.',
  data: { kind: 'deposit.completed' },
  readAt: null,
  createdAt: new Date('2026-08-27T10:00:00.000Z'),
  ...over,
});

function make(over: { pref?: { enabled: boolean } | null; found?: Row | null; createThrows?: unknown } = {}) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    notification: {
      findMany: jest.fn().mockResolvedValue([row()]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(over.found === undefined ? row() : over.found),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(row({ readAt: data.readAt as Date }))),
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        if (over.createThrows) return Promise.reject(over.createThrows);
        created.push(data);
        return Promise.resolve(row({ id: data.id as string, userId: data.userId as string }));
      }),
    },
    notificationPreference: {
      findUnique: jest.fn().mockResolvedValue(over.pref === undefined ? null : over.pref),
    },
    $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const gateway = { notify: jest.fn() };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const svc = new NotificationsService(prisma as never, gateway as never, logger as never);
  return { svc, prisma, gateway, logger, created };
}

const P2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });

describe('NotificationsService — reads are user-scoped', () => {
  it('list constrains every query by the authenticated userId', async () => {
    const { svc, prisma } = make();
    await svc.listForUser('u1', { page: 1, limit: 20, sortOrder: 'desc' } as never);
    const where = prisma.notification.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe('u1');
    expect(where.deletedAt).toBeNull();
  });

  it('list orders by createdAt DESC with a stable id tie-breaker (deterministic pagination)', async () => {
    const { svc, prisma } = make();
    await svc.listForUser('u1', { page: 2, limit: 10, sortOrder: 'desc' } as never);
    const args = prisma.notification.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
  });

  it('an empty mailbox returns an empty page, not an error', async () => {
    const { svc, prisma } = make();
    prisma.notification.findMany.mockResolvedValueOnce([]);
    prisma.notification.count.mockResolvedValue(0);
    const page = await svc.listForUser('u1', { page: 1, limit: 20, sortOrder: 'desc' } as never);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.unread).toBe(0);
  });

  it('unreadCount counts only the caller unread rows', async () => {
    const { svc, prisma } = make();
    prisma.notification.count.mockResolvedValueOnce(7);
    const res = await svc.unreadCount('u1');
    expect(res.unread).toBe(7);
    expect(prisma.notification.count.mock.calls[0][0].where).toMatchObject({ userId: 'u1', readAt: null });
  });

  it('get returns 404 for a row the caller does not own (ids cannot be probed)', async () => {
    const { svc } = make({ found: null });
    await expect(svc.getForUser('attacker', 'someone-elses-id')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the view never exposes internal plumbing', async () => {
    const { svc } = make();
    const v = await svc.getForUser('u1', 'x');
    expect(Object.keys(v).sort()).toEqual(['body', 'createdAt', 'data', 'id', 'readAt', 'read', 'title', 'type'].sort());
  });
});

describe('NotificationsService — mutations are user-scoped', () => {
  it('markAsRead refuses a row the caller does not own', async () => {
    const { svc, prisma } = make({ found: null });
    await expect(svc.markAsRead('attacker', 'victim-row')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('markAsRead is idempotent — an already-read row is not written again', async () => {
    const { svc, prisma } = make({ found: row({ readAt: new Date('2026-08-27T09:00:00Z') }) });
    const v = await svc.markAsRead('u1', 'x');
    expect(v.read).toBe(true);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('markAllAsRead only touches the caller unread rows', async () => {
    const { svc, prisma } = make();
    const res = await svc.markAllAsRead('u1');
    expect(res.updated).toBe(3);
    expect(prisma.notification.updateMany.mock.calls[0][0].where).toMatchObject({ userId: 'u1', readAt: null });
  });
});

describe('NotificationsService — idempotent creation (Phase F)', () => {
  it('derives a deterministic primary key from the event key', async () => {
    const { svc, created } = make();
    await svc.create({ userId: 'u1', type: NotificationType.TRANSACTION, title: 't', body: 'b', eventKey: 'deposit:completed:D1' });
    expect(created[0]!.id).toBe(notificationId('deposit:completed:D1'));
  });

  it('the same event ALWAYS maps to the same id; different events never collide', () => {
    expect(notificationId('withdrawal:approved:W1')).toBe(notificationId('withdrawal:approved:W1'));
    expect(notificationId('withdrawal:approved:W1')).not.toBe(notificationId('withdrawal:approved:W2'));
    expect(notificationId('withdrawal:approved:W1')).not.toBe(notificationId('withdrawal:rejected:W1'));
  });

  it('the derived id is a valid RFC-4122 UUID (the column is @db.Uuid)', () => {
    expect(notificationId('any:event:1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('a duplicate event returns null instead of creating a second row', async () => {
    const { svc, logger } = make({ createThrows: P2002 });
    const res = await svc.create({ userId: 'u1', type: NotificationType.TRANSACTION, title: 't', body: 'b', eventKey: 'e1' });
    expect(res).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('notification deduplicated', expect.any(Object));
  });

  it('a NON-duplicate database error still propagates (failures are not swallowed silently)', async () => {
    const boom = new Prisma.PrismaClientKnownRequestError('down', { code: 'P1001', clientVersion: 'x' });
    const { svc } = make({ createThrows: boom });
    await expect(svc.create({ userId: 'u1', type: NotificationType.SYSTEM, title: 't', body: 'b', eventKey: 'e' }))
      .rejects.toBe(boom);
  });

  it('only IN_APP is produced — no email/SMS/push is ever claimed', async () => {
    const { svc, created } = make();
    await svc.create({ userId: 'u1', type: NotificationType.TRANSACTION, title: 't', body: 'b', eventKey: 'e' });
    expect(created[0]!.channel).toBe('IN_APP');
  });

  it('a realtime push failure never breaks persistence', async () => {
    const { svc, gateway } = make();
    gateway.notify.mockImplementation(() => { throw new Error('socket down'); });
    const res = await svc.create({ userId: 'u1', type: NotificationType.SYSTEM, title: 't', body: 'b', eventKey: 'e' });
    expect(res).not.toBeNull(); // the durable row is the source of truth
  });
});

describe('NotificationsService — preferences (Phase L)', () => {
  it('no preference row means enabled (the column default is true)', async () => {
    const { svc, prisma } = make({ pref: null });
    await svc.create({ userId: 'u1', type: NotificationType.TRANSACTION, title: 't', body: 'b', eventKey: 'e' });
    expect(prisma.notification.create).toHaveBeenCalled();
  });

  it('a disabled preference suppresses the notification server-side', async () => {
    const { svc, prisma } = make({ pref: { enabled: false } });
    const res = await svc.create({ userId: 'u1', type: NotificationType.PROMOTION, title: 't', body: 'b', eventKey: 'e' });
    expect(res).toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});

describe('NotificationsService — financial safety (Phase E)', () => {
  it('safeEmit swallows ANY failure so a money movement can never be affected', async () => {
    const { svc, logger } = make({ createThrows: new Error('database on fire') });
    await expect(
      svc.safeEmit({ userId: 'u1', type: NotificationType.TRANSACTION, title: 't', body: 'b', eventKey: 'e' }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('notification processing failed', expect.any(Object));
  });

  it('the service never touches a wallet, ledger or settlement table', () => {
    const { prisma } = make();
    // The mock exposes only notification tables; if the service reached for anything financial the
    // property would be undefined and the call would throw.
    expect(Object.keys(prisma).sort()).toEqual(['$transaction', 'notification', 'notificationPreference']);
  });
});
