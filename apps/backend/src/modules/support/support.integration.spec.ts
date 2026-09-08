import { randomUUID } from 'node:crypto';

import { BadRequestException, NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from '@prisma/client';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { SupportService } from './support.service';

/**
 * Support ticketing INTEGRATION against real Postgres + Redis (`RUN_DB_IT=1`).
 *
 * The centrepiece is IDOR: two real players, two real tickets, and every cross-access path proven
 * to fail. Also covers the lifecycle, internal notes never reaching the player, audit coverage,
 * restart persistence, and that support moves no money.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

d('Support ticketing (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let support: SupportService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    support = app.get(SupportService);
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  const newUser = async () => (await prisma.user.create({
    data: {
      email: `sup_${randomUUID()}@t.local`,
      username: `sup${randomUUID().slice(0, 12)}`,
      status: 'ACTIVE',
      authProvider: 'LOCAL',
    },
  })).id;

  const open = (userId: string, subject = 'Cannot withdraw') =>
    support.create({ userId, subject, category: SupportTicketCategory.WITHDRAWAL, message: 'Please help.' });

  /* --------------------------------------------------------------- create */

  it('creates a persisted ticket with a reference and a first message', async () => {
    const userId = await newUser();
    const t = await open(userId);

    expect(t.reference).toMatch(/^TKT-[0-9A-F]{8}$/);
    expect(t.status).toBe(SupportTicketStatus.OPEN);
    expect(t.priority).toBe(SupportTicketPriority.NORMAL);

    const detail = await support.getMine(userId, t.id);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages![0]!.isFromAgent).toBe(false);
  }, 60_000);

  it('a player-created ticket ALWAYS starts NORMAL — a player cannot self-escalate', async () => {
    const userId = await newUser();
    const t = await open(userId);
    const row = await prisma.supportTicket.findUnique({ where: { id: t.id } });
    expect(row!.priority).toBe(SupportTicketPriority.NORMAL);
  }, 60_000);

  it('references are unique across tickets', async () => {
    const userId = await newUser();
    const refs = new Set<string>();
    for (let i = 0; i < 5; i++) refs.add((await open(userId, `Issue ${i}`)).reference);
    expect(refs.size).toBe(5);
  }, 60_000);

  /* ----------------------------------------------------------------- IDOR */

  it('IDOR: player A cannot READ player B’s ticket', async () => {
    const a = await newUser();
    const b = await newUser();
    const ticketB = await open(b, 'B private issue');

    await expect(support.getMine(a, ticketB.id)).rejects.toBeInstanceOf(NotFoundException);
  }, 60_000);

  it('IDOR: player A cannot REPLY to player B’s ticket', async () => {
    const a = await newUser();
    const b = await newUser();
    const ticketB = await open(b);
    await expect(support.replyAsPlayer(a, ticketB.id, 'injected')).rejects.toBeInstanceOf(NotFoundException);

    // And B's conversation is untouched.
    const detail = await support.getMine(b, ticketB.id);
    expect(detail.messages).toHaveLength(1);
  }, 60_000);

  it('IDOR: player A cannot CLOSE or REOPEN player B’s ticket', async () => {
    const a = await newUser();
    const b = await newUser();
    const ticketB = await open(b);
    await expect(support.closeMine(a, ticketB.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(support.reopenMine(a, ticketB.id)).rejects.toBeInstanceOf(NotFoundException);

    const row = await prisma.supportTicket.findUnique({ where: { id: ticketB.id } });
    expect(row!.status).toBe(SupportTicketStatus.OPEN);
  }, 60_000);

  it('IDOR: it is symmetric — B cannot reach A either', async () => {
    const a = await newUser();
    const b = await newUser();
    const ticketA = await open(a);
    await expect(support.getMine(b, ticketA.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(support.replyAsPlayer(b, ticketA.id, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  }, 60_000);

  it('a player’s list contains ONLY their own tickets', async () => {
    const a = await newUser();
    const b = await newUser();
    await open(a, 'A one');
    await open(a, 'A two');
    await open(b, 'B one');

    const listA = await support.listMine(a);
    expect(listA.total).toBe(2);
    expect(listA.items.every((t) => t.subject.startsWith('A '))).toBe(true);

    const listB = await support.listMine(b);
    expect(listB.total).toBe(1);
  }, 60_000);

  it('another player’s ticket id yields the SAME error as a missing one (no existence oracle)', async () => {
    const a = await newUser();
    const b = await newUser();
    const ticketB = await open(b);

    const real = await support.getMine(a, ticketB.id).catch((e: Error) => e);
    const fake = await support.getMine(a, '00000000-0000-4000-8000-000000000000').catch((e: Error) => e);
    expect((real as Error).constructor).toBe((fake as Error).constructor);
    expect((real as Error).message).toBe((fake as Error).message);
  }, 60_000);

  /* ------------------------------------------------------------ lifecycle */

  it('an agent reply moves OPEN → WAITING_ON_PLAYER and is marked as from an agent', async () => {
    const userId = await newUser();
    const agent = await newUser();
    const t = await open(userId);

    const after = await support.replyAsAgent(agent, t.id, 'We are looking into it.');
    expect(after.status).toBe(SupportTicketStatus.WAITING_ON_PLAYER);
    expect(after.messages.at(-1)!.isFromAgent).toBe(true);
    // First responder is auto-assigned.
    expect(after.assignedToUserId).toBe(agent);
  }, 60_000);

  it('a player reply moves WAITING_ON_PLAYER back to IN_PROGRESS', async () => {
    const userId = await newUser();
    const agent = await newUser();
    const t = await open(userId);
    await support.replyAsAgent(agent, t.id, 'Question?');
    const after = await support.replyAsPlayer(userId, t.id, 'Answer.');
    expect(after.status).toBe(SupportTicketStatus.IN_PROGRESS);
  }, 60_000);

  it('a player can close and reopen their own ticket', async () => {
    const userId = await newUser();
    const t = await open(userId);

    const closed = await support.closeMine(userId, t.id);
    expect(closed.status).toBe(SupportTicketStatus.CLOSED);
    expect(closed.closedAt).not.toBeNull();

    // A closed ticket refuses new messages until reopened.
    await expect(support.replyAsPlayer(userId, t.id, 'more')).rejects.toBeInstanceOf(BadRequestException);

    const reopened = await support.reopenMine(userId, t.id);
    expect(reopened.status).toBe(SupportTicketStatus.IN_PROGRESS);
    expect(reopened.closedAt).toBeNull();
    await expect(support.replyAsPlayer(userId, t.id, 'more')).resolves.toBeDefined();
  }, 60_000);

  it('reopening an already-open ticket is refused', async () => {
    const userId = await newUser();
    const t = await open(userId);
    await expect(support.reopenMine(userId, t.id)).rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  /* ------------------------------------------------------- internal notes */

  it('an INTERNAL agent note is never returned to the player', async () => {
    const userId = await newUser();
    const agent = await newUser();
    const t = await open(userId);

    await support.replyAsAgent(agent, t.id, 'Suspected chargeback abuse — check history.', true);

    const playerView = await support.getMine(userId, t.id);
    expect(playerView.messages!.some((m) => m.body.includes('chargeback'))).toBe(false);
    expect(playerView.messages).toHaveLength(1);

    // The agent DOES see it.
    const agentView = await support.getForAgent(t.id);
    expect(agentView.messages.some((m) => m.isInternal && m.body.includes('chargeback'))).toBe(true);
  }, 60_000);

  it('an internal note does not change the ticket status', async () => {
    const userId = await newUser();
    const agent = await newUser();
    const t = await open(userId);
    const after = await support.replyAsAgent(agent, t.id, 'internal only', true);
    expect(after.status).toBe(SupportTicketStatus.OPEN);
  }, 60_000);

  it('an internal note creates NO notification for the player', async () => {
    const userId = await newUser();
    const agent = await newUser();
    const t = await open(userId);
    const before = await prisma.notification.count({ where: { userId } });
    await support.replyAsAgent(agent, t.id, 'internal only', true);
    expect(await prisma.notification.count({ where: { userId } })).toBe(before);
  }, 60_000);

  /* ------------------------------------------------------- notifications */

  it('a real agent reply notifies the player through the EXISTING notification system', async () => {
    const userId = await newUser();
    const agent = await newUser();
    const t = await open(userId);

    const before = await prisma.notification.count({ where: { userId } });
    await support.replyAsAgent(agent, t.id, 'Here is our answer.');
    const after = await prisma.notification.count({ where: { userId } });
    expect(after).toBe(before + 1);

    const n = await prisma.notification.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    expect(n!.title).toContain(t.reference);
    // A notification is a pointer, not a copy of the conversation.
    expect(n!.body).not.toContain('Here is our answer.');
  }, 60_000);

  it('the same status transition does not duplicate a notification (existing dedup)', async () => {
    const userId = await newUser();
    const agent = await newUser();
    const t = await open(userId);

    await support.setStatus(agent, t.id, SupportTicketStatus.RESOLVED);
    const afterFirst = await prisma.notification.count({ where: { userId } });
    // Re-issuing the same transition is a no-op on status and must not add a second notification.
    await support.setStatus(agent, t.id, SupportTicketStatus.RESOLVED);
    expect(await prisma.notification.count({ where: { userId } })).toBe(afterFirst);
  }, 60_000);

  /* -------------------------------------------------------------- agent */

  it('the agent queue filters by status and priority', async () => {
    const userId = await newUser();
    const agent = await newUser();
    const t = await open(userId);
    await support.setPriority(agent, t.id, SupportTicketPriority.URGENT);

    const urgent = await support.queue({ priority: SupportTicketPriority.URGENT, page: 1, limit: 50 });
    expect(urgent.items.some((x) => x.id === t.id)).toBe(true);
    expect(urgent.items.every((x) => x.priority === SupportTicketPriority.URGENT)).toBe(true);
  }, 60_000);

  it('assignment is recorded and can be cleared', async () => {
    const userId = await newUser();
    const agent = await newUser();
    const t = await open(userId);

    const assigned = await support.assign(agent, t.id, agent);
    expect(assigned.assignedToUserId).toBe(agent);
    expect(assigned.status).toBe(SupportTicketStatus.IN_PROGRESS);

    const unassigned = await support.assign(agent, t.id, null);
    expect(unassigned.assignedToUserId).toBeNull();
  }, 60_000);

  /* ---------------------------------------------------------------- audit */

  it('every sensitive action is audited through the EXISTING audit service', async () => {
    const userId = await newUser();
    const agent = await newUser();
    const t = await open(userId);
    await support.replyAsAgent(agent, t.id, 'reply');
    await support.assign(agent, t.id, agent);
    await support.setStatus(agent, t.id, SupportTicketStatus.RESOLVED);
    await support.setPriority(agent, t.id, SupportTicketPriority.HIGH);
    await support.closeMine(userId, t.id);

    const audits = await prisma.auditTrail.findMany({
      where: { entityType: 'support_ticket', entityId: t.id },
    });
    const events = audits.map((a) => (a.changes as Record<string, unknown>).event ?? 'created');
    expect(events).toEqual(expect.arrayContaining([
      'created', 'agent_reply', 'assigned', 'status_changed', 'priority_changed',
    ]));
    // Only ONE audit store is used — no second system was created.
    expect(await prisma.adminAuditLog.count()).toBe(0);
  }, 60_000);

  /* --------------------------------------------------------- persistence */

  it('tickets survive a full service restart', async () => {
    const userId = await newUser();
    const t = await open(userId, 'Persisted issue');

    const ref2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app2 = ref2.createNestApplication();
    await app2.init();
    try {
      const support2 = app2.get(SupportService);
      const detail = await support2.getMine(userId, t.id);
      expect(detail.subject).toBe('Persisted issue');
      expect(detail.messages).toHaveLength(1);
    } finally {
      await app2.close();
    }
  }, 180_000);

  /* ---------------------------------------------------- financial safety */

  it('support moves no money — the ledger is untouched', async () => {
    const snapshot = async () => {
      const rows = await prisma.$queryRaw<{ debit: string; credit: string }[]>`
        SELECT COALESCE(SUM(CASE WHEN direction='DEBIT'  THEN amount ELSE 0 END),0)::text AS debit,
               COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE 0 END),0)::text AS credit
        FROM ledger_entries`;
      return { ...rows[0]!, tx: await prisma.walletTransaction.count() };
    };

    const before = await snapshot();
    const userId = await newUser();
    const agent = await newUser();
    const t = await open(userId);
    await support.replyAsAgent(agent, t.id, 'reply');
    await support.setStatus(agent, t.id, SupportTicketStatus.RESOLVED);
    await support.closeMine(userId, t.id);

    expect(await snapshot()).toEqual(before);
  }, 120_000);
});
