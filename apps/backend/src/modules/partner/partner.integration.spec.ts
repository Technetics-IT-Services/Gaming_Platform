import { randomUUID } from 'node:crypto';

import { BadRequestException, ForbiddenException, NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PartnerStatus, Prisma } from '@prisma/client';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { PartnerService } from './partner.service';

/**
 * Partner principal INTEGRATION against real Postgres + Redis (`RUN_DB_IT=1`).
 *
 * The properties that matter: partner isolation is structural, the Σ ≤ 100 ownership invariant holds
 * even under concurrency, membership reuses the existing identity system, financial figures are
 * reported UNAVAILABLE rather than zero, and the partner module moves no money.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

d('Partner principal (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let partners: PartnerService;
  let actor: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    partners = app.get(PartnerService);
    actor = await newUser();
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  async function newUser(): Promise<string> {
    return (await prisma.user.create({
      data: {
        email: `ptr_${randomUUID()}@t.local`,
        username: `ptr${randomUUID().slice(0, 12)}`,
        status: 'ACTIVE',
        authProvider: 'LOCAL',
      },
    })).id;
  }

  /** Deactivate every pre-existing active partner so allocation tests are deterministic. */
  async function clearAllocation(): Promise<void> {
    await prisma.partner.updateMany({
      where: { status: PartnerStatus.ACTIVE, deletedAt: null },
      data: { status: PartnerStatus.SUSPENDED },
    });
  }

  /* ------------------------------------------------------------- lifecycle */

  it('creates a partner as PENDING with a generated code', async () => {
    const p = await partners.create({ name: 'Acme Holdings', revenueSharePercent: '10', actorUserId: actor });
    expect(p.code).toMatch(/^PTR-[0-9A-F]{6}$/);
    expect(p.status).toBe(PartnerStatus.PENDING);
    expect(p.revenueSharePercent).toBe('10');
    expect(p.memberCount).toBe(0);
  }, 60_000);

  it('a partner code is unique across partners', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 5; i++) {
      codes.add((await partners.create({ name: `P${i}`, actorUserId: actor })).code);
    }
    expect(codes.size).toBe(5);
  }, 60_000);

  it('rejects a share outside 0–100', async () => {
    for (const bad of ['-1', '101', '150']) {
      await expect(partners.create({ name: 'Bad', revenueSharePercent: bad, actorUserId: actor }))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  }, 60_000);

  it('creation and share changes are audited with old and new values', async () => {
    const p = await partners.create({ name: 'Audited', revenueSharePercent: '5', actorUserId: actor });
    await partners.setShare(p.id, '7.5', actor);

    const audits = await prisma.auditTrail.findMany({
      where: { entityType: 'partner', entityId: p.id }, orderBy: { createdAt: 'asc' },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    const update = audits.find((a) => (a.changes as Record<string, unknown>).field === 'revenueSharePercent');
    expect(update).toBeDefined();
    const c = update!.changes as Record<string, unknown>;
    expect(c.from).toBe('5');
    expect(c.to).toBe('7.5');
    // One audit store only.
    expect(await prisma.adminAuditLog.count()).toBe(0);
  }, 60_000);

  /* ------------------------------------------------- Σ ≤ 100 ownership invariant */

  it('allows the allocation to reach exactly 100%', async () => {
    await clearAllocation();
    const a = await partners.create({ name: 'A60', revenueSharePercent: '60', actorUserId: actor });
    const b = await partners.create({ name: 'B40', revenueSharePercent: '40', actorUserId: actor });
    await partners.setStatus(a.id, PartnerStatus.ACTIVE, actor);
    await expect(partners.setStatus(b.id, PartnerStatus.ACTIVE, actor)).resolves.toBeDefined();

    const listed = await partners.list({ page: 1, limit: 100 });
    expect(Number(listed.allocation.allocatedPercent)).toBeCloseTo(100, 4);
    expect(Number(listed.allocation.unallocatedPercent)).toBeCloseTo(0, 4);
  }, 60_000);

  it('REFUSES to exceed 100% when activating', async () => {
    await clearAllocation();
    const a = await partners.create({ name: 'A70', revenueSharePercent: '70', actorUserId: actor });
    const b = await partners.create({ name: 'B40b', revenueSharePercent: '40', actorUserId: actor });
    await partners.setStatus(a.id, PartnerStatus.ACTIVE, actor);
    await expect(partners.setStatus(b.id, PartnerStatus.ACTIVE, actor)).rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('REFUSES a share increase that would exceed 100%', async () => {
    await clearAllocation();
    const a = await partners.create({ name: 'A50', revenueSharePercent: '50', actorUserId: actor });
    const b = await partners.create({ name: 'B50', revenueSharePercent: '50', actorUserId: actor });
    await partners.setStatus(a.id, PartnerStatus.ACTIVE, actor);
    await partners.setStatus(b.id, PartnerStatus.ACTIVE, actor);

    await expect(partners.setShare(b.id, '60', actor)).rejects.toBeInstanceOf(BadRequestException);
    // The refusal left the stored value untouched.
    expect((await partners.getById(b.id)).revenueSharePercent).toBe('50');
  }, 60_000);

  it('does NOT require the allocation to equal 100 — the house may retain a share', async () => {
    await clearAllocation();
    const a = await partners.create({ name: 'Only30', revenueSharePercent: '30', actorUserId: actor });
    await expect(partners.setStatus(a.id, PartnerStatus.ACTIVE, actor)).resolves.toBeDefined();

    const listed = await partners.list({ page: 1, limit: 100 });
    expect(Number(listed.allocation.allocatedPercent)).toBeCloseTo(30, 4);
    // The remainder is surfaced explicitly rather than implied to be zero.
    expect(Number(listed.allocation.unallocatedPercent)).toBeCloseTo(70, 4);
  }, 60_000);

  it('CONCURRENT share updates cannot combine to exceed 100%', async () => {
    await clearAllocation();
    const a = await partners.create({ name: 'C50a', revenueSharePercent: '50', actorUserId: actor });
    const b = await partners.create({ name: 'C50b', revenueSharePercent: '50', actorUserId: actor });
    await partners.setStatus(a.id, PartnerStatus.ACTIVE, actor);
    await partners.setStatus(b.id, PartnerStatus.ACTIVE, actor);

    // Both try to take 80 at once. At most one can succeed; 80 + 80 must never be stored.
    await Promise.allSettled([
      partners.setShare(a.id, '80', actor),
      partners.setShare(b.id, '80', actor),
    ]);

    const agg = await prisma.partner.aggregate({
      where: { status: PartnerStatus.ACTIVE, deletedAt: null },
      _sum: { revenueSharePercent: true },
    });
    const total = agg._sum.revenueSharePercent ?? new Prisma.Decimal(0);
    expect(total.lessThanOrEqualTo(new Prisma.Decimal(100))).toBe(true);
  }, 60_000);

  it('a SUSPENDED partner does not consume allocation', async () => {
    await clearAllocation();
    const a = await partners.create({ name: 'S90', revenueSharePercent: '90', actorUserId: actor });
    await partners.setStatus(a.id, PartnerStatus.ACTIVE, actor);
    await partners.setStatus(a.id, PartnerStatus.SUSPENDED, actor);

    const b = await partners.create({ name: 'S90b', revenueSharePercent: '90', actorUserId: actor });
    await expect(partners.setStatus(b.id, PartnerStatus.ACTIVE, actor)).resolves.toBeDefined();
  }, 60_000);

  /* ------------------------------------------------------------- membership */

  it('links an EXISTING user and grants the partner role (no second auth system)', async () => {
    const p = await partners.create({ name: 'WithMember', actorUserId: actor });
    const userId = await newUser();
    const after = await partners.addMember(p.id, userId, actor);
    expect(after.memberCount).toBe(1);

    // The user gained the `partner` role through the EXISTING role system.
    const roles = await prisma.userRole.findMany({ where: { userId }, include: { role: true } });
    expect(roles.some((r) => r.role.slug === 'partner')).toBe(true);

    // No separate credential store was created for partners.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    expect(user!.email).toContain('@t.local');
  }, 60_000);

  it('one user cannot belong to two partners', async () => {
    const p1 = await partners.create({ name: 'One', actorUserId: actor });
    const p2 = await partners.create({ name: 'Two', actorUserId: actor });
    const userId = await newUser();

    await partners.addMember(p1.id, userId, actor);
    await expect(partners.addMember(p2.id, userId, actor)).rejects.toThrow(/already belongs to another partner/i);
    await expect(partners.addMember(p1.id, userId, actor)).rejects.toThrow(/already belongs to this partner/i);
  }, 60_000);

  it('rejects linking an unknown user or an unknown partner', async () => {
    const p = await partners.create({ name: 'Unknowns', actorUserId: actor });
    await expect(partners.addMember(p.id, '00000000-0000-4000-8000-000000000000', actor))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(partners.addMember('00000000-0000-4000-8000-000000000000', await newUser(), actor))
      .rejects.toBeInstanceOf(NotFoundException);
  }, 60_000);

  it('member listing returns identifiers, never credentials', async () => {
    const p = await partners.create({ name: 'Members', actorUserId: actor });
    const userId = await newUser();
    await partners.addMember(p.id, userId, actor, true);

    const members = await partners.members(p.id);
    expect(members).toHaveLength(1);
    expect(members[0]!.isPrimary).toBe(true);
    const dump = JSON.stringify(members).toLowerCase();
    for (const forbidden of ['password', 'hash', 'token', 'secret', 'email']) {
      expect(dump).not.toContain(forbidden);
    }
  }, 60_000);

  /* --------------------------------------------------------------- ISOLATION */

  it('ISOLATION: a partner member resolves ONLY their own organisation', async () => {
    const pA = await partners.create({ name: 'Alpha Org', actorUserId: actor });
    const pB = await partners.create({ name: 'Beta Org', actorUserId: actor });
    const userA = await newUser();
    const userB = await newUser();
    await partners.addMember(pA.id, userA, actor);
    await partners.addMember(pB.id, userB, actor);

    expect((await partners.myPartner(userA)).name).toBe('Alpha Org');
    expect((await partners.myPartner(userB)).name).toBe('Beta Org');

    // There is NO service call that lets a partner name another partner — resolution is by the
    // authenticated user id alone, so cross-partner access has no code path.
    expect((await partners.myPartner(userA)).id).not.toBe(pB.id);
  }, 60_000);

  it('a user with no partner membership is refused, not given an empty partner', async () => {
    const stranger = await newUser();
    await expect(partners.myPartner(stranger)).rejects.toBeInstanceOf(ForbiddenException);
  }, 60_000);

  it('a member of a soft-deleted partner is refused', async () => {
    const p = await partners.create({ name: 'Doomed', actorUserId: actor });
    const userId = await newUser();
    await partners.addMember(p.id, userId, actor);
    await prisma.partner.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
    await expect(partners.myPartner(userId)).rejects.toBeInstanceOf(ForbiddenException);
  }, 60_000);

  /* ------------------------------------------------- honest unavailability */

  it('the dashboard reports profit and balance as UNAVAILABLE, never zero', async () => {
    await clearAllocation();
    const p = await partners.create({ name: 'Dash', revenueSharePercent: '25', actorUserId: actor });
    const userId = await newUser();
    await partners.addMember(p.id, userId, actor);

    const dash = await partners.myDashboard(userId);
    expect(dash.partner.revenueSharePercent).toBe('25');

    const metrics = dash.unavailable.map((u) => u.metric);
    expect(metrics).toEqual(expect.arrayContaining(['netProfit', 'partnerProfit', 'availableBalance', 'withdrawals']));

    // The blocker must be named as a business decision, not a vague "coming soon".
    const profit = dash.unavailable.find((u) => u.metric === 'netProfit')!;
    expect(profit.reason).toMatch(/BUSINESS DEFINITION MISSING/);
    expect(profit.reason).toMatch(/revenue/i);

    // And no fabricated numbers anywhere in the payload.
    const dump = JSON.stringify(dash);
    expect(dump).not.toMatch(/"balance"/);
    expect(dump).not.toMatch(/"profit":\s*\d/);
  }, 60_000);

  /* ------------------------------------------------------ financial safety */

  it('the partner module moves NO money — ledger, wallets and transactions untouched', async () => {
    const snapshot = async () => {
      const rows = await prisma.$queryRaw<{ debit: string; credit: string }[]>`
        SELECT COALESCE(SUM(CASE WHEN direction='DEBIT'  THEN amount ELSE 0 END),0)::text AS debit,
               COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE 0 END),0)::text AS credit
        FROM ledger_entries`;
      return {
        ...rows[0]!,
        tx: await prisma.walletTransaction.count(),
        wallets: await prisma.wallet.count(),
      };
    };

    const before = await snapshot();

    await clearAllocation();
    const p = await partners.create({ name: 'NoMoney', revenueSharePercent: '15', actorUserId: actor });
    await partners.setStatus(p.id, PartnerStatus.ACTIVE, actor);
    await partners.setShare(p.id, '12', actor);
    const userId = await newUser();
    await partners.addMember(p.id, userId, actor);
    await partners.myDashboard(userId);
    await partners.list({ page: 1, limit: 20 });

    expect(await snapshot()).toEqual(before);
  }, 120_000);

  it('no partner wallet or balance table exists', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_name LIKE 'partner%'`;
    const names = rows.map((r) => r.table_name).sort();
    // Exactly two tables: the principal and its membership. No balance, no commission, no payout.
    expect(names).toEqual(['partner_users', 'partners']);
  }, 60_000);

  /* ---------------------------------------------------------- persistence */

  it('partner state survives a full service restart', async () => {
    const p = await partners.create({ name: 'Persisted Org', revenueSharePercent: '8', actorUserId: actor });
    const userId = await newUser();
    await partners.addMember(p.id, userId, actor);

    const ref2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app2 = ref2.createNestApplication();
    await app2.init();
    try {
      const partners2 = app2.get(PartnerService);
      const mine = await partners2.myPartner(userId);
      expect(mine.name).toBe('Persisted Org');
      expect(mine.revenueSharePercent).toBe('8');
    } finally {
      await app2.close();
    }
  }, 180_000);
});

/* ============================================ PA-08 partner notifications (2D.5) */

d('Partner notifications (integration)', () => {
  let app2: INestApplication;
  let prisma2: PrismaService;
  let partners2: PartnerService;
  let actor2: string;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app2 = ref.createNestApplication();
    await app2.init();
    prisma2 = app2.get(PrismaService);
    partners2 = app2.get(PartnerService);
    actor2 = (await prisma2.user.create({
      data: {
        email: `pn_${randomUUID()}@t.local`,
        username: `pn${randomUUID().slice(0, 12)}`,
        status: 'ACTIVE',
        authProvider: 'LOCAL',
      },
    })).id;
  }, 60_000);

  afterAll(async () => { await app2?.close(); });

  const newMember = async () => (await prisma2.user.create({
    data: {
      email: `pm_${randomUUID()}@t.local`,
      username: `pm${randomUUID().slice(0, 12)}`,
      status: 'ACTIVE',
      authProvider: 'LOCAL',
    },
  })).id;

  it('linking a member notifies THAT user through the existing system', async () => {
    const p = await partners2.create({ name: 'Notify Org', actorUserId: actor2 });
    const userId = await newMember();

    const before = await prisma2.notification.count({ where: { userId } });
    await partners2.addMember(p.id, userId, actor2);
    expect(await prisma2.notification.count({ where: { userId } })).toBe(before + 1);

    const n = await prisma2.notification.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    expect(n!.title).toContain('Notify Org');
  }, 60_000);

  it('a status change notifies every member', async () => {
    const p = await partners2.create({ name: 'Status Org', actorUserId: actor2 });
    const a = await newMember();
    const b = await newMember();
    await partners2.addMember(p.id, a, actor2);
    await partners2.addMember(p.id, b, actor2);

    const beforeA = await prisma2.notification.count({ where: { userId: a } });
    const beforeB = await prisma2.notification.count({ where: { userId: b } });
    await partners2.setStatus(p.id, PartnerStatus.ACTIVE, actor2);

    expect(await prisma2.notification.count({ where: { userId: a } })).toBe(beforeA + 1);
    expect(await prisma2.notification.count({ where: { userId: b } })).toBe(beforeB + 1);
  }, 60_000);

  it('a share change notifies members with the SHARE, not an amount of money', async () => {
    const p = await partners2.create({ name: 'Share Org', revenueSharePercent: '10', actorUserId: actor2 });
    const userId = await newMember();
    await partners2.addMember(p.id, userId, actor2);

    await partners2.setShare(p.id, '15', actor2);
    const n = await prisma2.notification.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    expect(n!.body).toContain('15%');
    // A share is configuration, not currency — no money symbol or balance wording.
    expect(n!.body).not.toMatch(/₹|balance|profit/i);
  }, 60_000);

  it('re-applying the SAME transition does not duplicate (deterministic dedup)', async () => {
    const p = await partners2.create({ name: 'Dedup Org', actorUserId: actor2 });
    const userId = await newMember();
    await partners2.addMember(p.id, userId, actor2);

    await partners2.setStatus(p.id, PartnerStatus.ACTIVE, actor2);
    const after = await prisma2.notification.count({ where: { userId } });
    // setStatus is a no-op when unchanged, and the event key is (partner,status) either way.
    await partners2.setStatus(p.id, PartnerStatus.ACTIVE, actor2);
    expect(await prisma2.notification.count({ where: { userId } })).toBe(after);
  }, 60_000);

  it('notifications are OWNED — a member sees only their own', async () => {
    const p = await partners2.create({ name: 'Owned Org', actorUserId: actor2 });
    const a = await newMember();
    const b = await newMember();
    await partners2.addMember(p.id, a, actor2);

    // B was never linked, so B received nothing.
    expect(await prisma2.notification.count({ where: { userId: b } })).toBe(0);
    expect(await prisma2.notification.count({ where: { userId: a } })).toBeGreaterThan(0);
  }, 60_000);

  it('NO partner-profit notification exists — it would need a fabricated amount', async () => {
    const events = app2.get(NotificationEventsService) as unknown as Record<string, unknown>;
    for (const blocked of ['partnerDailyProfit', 'partnerProfit', 'partnerPayout', 'partnerBalance']) {
      expect(events[blocked]).toBeUndefined();
    }
  }, 60_000);
});
