import { randomUUID } from 'node:crypto';

import { BadRequestException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ActivityType, PromotionStatus, PromotionType, ReferralStatus } from '@prisma/client';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { ActivityEventService, activityEventId, sanitiseMetadata } from '../events/activity-event.service';
import { PromotionsService } from '../promotions/promotions.service';
import { ReferralService } from './referral.service';

/**
 * Phase 2D.9 INTEGRATION against real Postgres (`RUN_DB_IT=1`) — referral (P-17), promotions
 * (AD-08) and the activity event pipeline (X-02).
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

d('Phase 2D.9 (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let referral: ReferralService;
  let promotions: PromotionsService;
  let events: ActivityEventService;
  let actor: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    referral = app.get(ReferralService);
    promotions = app.get(PromotionsService);
    events = app.get(ActivityEventService);
    actor = await newUser();
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  async function newUser(code?: string): Promise<string> {
    return (await prisma.user.create({
      data: {
        email: `p9_${randomUUID()}@t.local`,
        username: `p9${randomUUID().slice(0, 12)}`,
        status: 'ACTIVE',
        authProvider: 'LOCAL',
        referralCode: code ?? `RC${randomUUID().slice(0, 10).toUpperCase().replace(/-/g, '')}`,
      },
    })).id;
  }

  const codeOf = async (userId: string) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } }))!.referralCode!;

  /* ======================================================== P-17 REFERRAL */

  it('a player sees their own code and an empty referral list', async () => {
    const u = await newUser();
    const s = await referral.mySummary(u);
    expect(s.code).toBeTruthy();
    expect(s.totalReferred).toBe(0);
    expect(s.referredBy).toBeNull();
  }, 60_000);

  it('claiming a valid code creates the relationship as PENDING', async () => {
    const referrer = await newUser();
    const referred = await newUser();
    const r = await referral.claim(referred, await codeOf(referrer));

    expect(r.status).toBe(ReferralStatus.PENDING);
    expect(r.alreadyClaimed).toBe(false);

    const row = await prisma.referralHistory.findUnique({ where: { referredId: referred } });
    expect(row!.referrerId).toBe(referrer);
    // Qualification requires an undefined rule, so nothing advances it.
    expect(row!.qualifiedAt).toBeNull();
    expect(row!.rewardedAt).toBeNull();
  }, 60_000);

  it('SELF-REFERRAL is refused', async () => {
    const u = await newUser();
    await expect(referral.claim(u, await codeOf(u))).rejects.toThrow(/cannot refer yourself/i);
    expect(await prisma.referralHistory.findUnique({ where: { referredId: u } })).toBeNull();
  }, 60_000);

  it('an invalid code fails cleanly and is not an existence oracle', async () => {
    const u = await newUser();
    const a = await referral.claim(u, 'NOSUCHCODE').catch((e: Error) => e);
    const b = await referral.claim(u, 'ALSOMISSING').catch((e: Error) => e);
    expect((a as Error).message).toBe((b as Error).message);
    expect(a).toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('claiming the SAME code twice is idempotent, not an error', async () => {
    const referrer = await newUser();
    const referred = await newUser();
    const code = await codeOf(referrer);

    const first = await referral.claim(referred, code);
    const second = await referral.claim(referred, code);
    expect(first.alreadyClaimed).toBe(false);
    expect(second.alreadyClaimed).toBe(true);
    expect(await prisma.referralHistory.count({ where: { referredId: referred } })).toBe(1);
  }, 60_000);

  it('a SECOND, DIFFERENT referrer is refused — one relationship per player', async () => {
    const r1 = await newUser();
    const r2 = await newUser();
    const referred = await newUser();
    await referral.claim(referred, await codeOf(r1));
    await expect(referral.claim(referred, await codeOf(r2))).rejects.toThrow(/already been referred/i);

    const row = await prisma.referralHistory.findUnique({ where: { referredId: referred } });
    expect(row!.referrerId).toBe(r1);
  }, 60_000);

  it('CONCURRENT claims cannot create two relationships', async () => {
    const referrer = await newUser();
    const referred = await newUser();
    const code = await codeOf(referrer);

    await Promise.allSettled([referral.claim(referred, code), referral.claim(referred, code)]);
    expect(await prisma.referralHistory.count({ where: { referredId: referred } })).toBe(1);
  }, 60_000);

  it('ISOLATION: a player sees only their own referrals', async () => {
    const a = await newUser();
    const b = await newUser();
    const ra = await newUser();
    const rb = await newUser();
    await referral.claim(ra, await codeOf(a));
    await referral.claim(rb, await codeOf(b));

    const sa = await referral.mySummary(a);
    const sb = await referral.mySummary(b);
    expect(sa.totalReferred).toBe(1);
    expect(sb.totalReferred).toBe(1);
    // A's summary contains nothing of B's referred player.
    const bUsername = (await prisma.user.findUnique({ where: { id: rb }, select: { username: true } }))!.username;
    expect(JSON.stringify(sa)).not.toContain(bUsername);
  }, 60_000);

  it('the referred player sees WHO referred them', async () => {
    const referrer = await newUser();
    const referred = await newUser();
    await referral.claim(referred, await codeOf(referrer));
    const s = await referral.mySummary(referred);
    expect(s.referredBy).not.toBeNull();
  }, 60_000);

  it('reward and qualification are declared BLOCKED, never shown as zero earnings', async () => {
    const u = await newUser();
    const s = await referral.mySummary(u);
    const metrics = s.unavailable.map((x) => x.metric);
    expect(metrics).toEqual(expect.arrayContaining(['referralQualification', 'referralReward']));
    expect(s.unavailable.find((x) => x.metric === 'referralReward')!.reason)
      .toMatch(/BUSINESS DEFINITION MISSING/);
    // No earnings figure of any kind.
    expect(JSON.stringify(s)).not.toMatch(/"earnings"|"reward":\s*[0-9]/);
  }, 60_000);

  it('referral moves NO money', async () => {
    const snapshot = async () => {
      const rows = await prisma.$queryRaw<{ debit: string }[]>`
        SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount ELSE 0 END),0)::text AS debit FROM ledger_entries`;
      return { ...rows[0]!, tx: await prisma.walletTransaction.count() };
    };
    const before = await snapshot();
    const referrer = await newUser();
    const referred = await newUser();
    await referral.claim(referred, await codeOf(referrer));
    await referral.mySummary(referrer);
    expect(await snapshot()).toEqual(before);
  }, 60_000);

  /* ===================================================== AD-08 PROMOTIONS */

  const promoCode = () => `PR${randomUUID().slice(0, 8).toUpperCase().replace(/-/g, '')}`;

  it('creates a promotion as DRAFT with a server-set status', async () => {
    const p = await promotions.create({
      code: promoCode(), name: 'Welcome offer', type: PromotionType.DEPOSIT_BONUS, actorUserId: actor,
    });
    expect(p.status).toBe(PromotionStatus.DRAFT);
    expect(p.currentRedemptions).toBe(0);
  }, 60_000);

  it('rejects a duplicate code and a malformed code', async () => {
    const code = promoCode();
    await promotions.create({ code, name: 'One', type: PromotionType.RELOAD, actorUserId: actor });
    await expect(promotions.create({ code, name: 'Two', type: PromotionType.RELOAD, actorUserId: actor }))
      .rejects.toThrow(/already exists/i);
    await expect(promotions.create({ code: 'no spaces!', name: 'Bad', type: PromotionType.RELOAD, actorUserId: actor }))
      .rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('rejects an end date before the start date', async () => {
    await expect(promotions.create({
      code: promoCode(), name: 'Bad window', type: PromotionType.CASHBACK, actorUserId: actor,
      startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-05-01T00:00:00.000Z',
    })).rejects.toThrow(/after startsAt/i);
  }, 60_000);

  it('enforces the status transition table', async () => {
    const p = await promotions.create({ code: promoCode(), name: 'Lifecycle', type: PromotionType.RELOAD, actorUserId: actor });
    await promotions.setStatus(p.id, PromotionStatus.ACTIVE, actor);
    await promotions.setStatus(p.id, PromotionStatus.PAUSED, actor);
    await promotions.setStatus(p.id, PromotionStatus.ENDED, actor);
    // ENDED is terminal.
    await expect(promotions.setStatus(p.id, PromotionStatus.ACTIVE, actor)).rejects.toThrow(/Cannot move/i);
    await expect(promotions.update(p.id, { name: 'nope', actorUserId: actor })).rejects.toThrow(/ENDED/i);
  }, 60_000);

  it('CONCURRENT status changes cannot both win', async () => {
    const p = await promotions.create({ code: promoCode(), name: 'Race', type: PromotionType.RELOAD, actorUserId: actor });
    const results = await Promise.allSettled([
      promotions.setStatus(p.id, PromotionStatus.ACTIVE, actor),
      promotions.setStatus(p.id, PromotionStatus.SCHEDULED, actor),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  }, 60_000);

  it('a player sees only ACTIVE, in-window promotions', async () => {
    const draft = await promotions.create({ code: promoCode(), name: 'Hidden draft', type: PromotionType.RELOAD, actorUserId: actor });
    const live = await promotions.create({ code: promoCode(), name: 'Live offer', type: PromotionType.RELOAD, actorUserId: actor });
    await promotions.setStatus(live.id, PromotionStatus.ACTIVE, actor);

    const future = await promotions.create({
      code: promoCode(), name: 'Future offer', type: PromotionType.RELOAD, actorUserId: actor,
      startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    await promotions.setStatus(future.id, PromotionStatus.ACTIVE, actor);

    const visible = await promotions.listActiveForPlayer();
    const names = visible.items.map((i) => i.name);
    expect(names).toContain('Live offer');
    expect(names).not.toContain('Hidden draft');
    expect(names).not.toContain('Future offer');
    expect(draft.status).toBe(PromotionStatus.DRAFT);
  }, 60_000);

  it('declares AWARDING blocked to both operator and player', async () => {
    const forOperator = await promotions.list({ page: 1, limit: 5 });
    const forPlayer = await promotions.listActiveForPlayer();
    for (const payload of [forOperator, forPlayer]) {
      expect(payload.unavailable.some((u) => u.metric === 'promotionAward')).toBe(true);
    }
    expect(forPlayer.unavailable[0]!.reason).toMatch(/BUSINESS DEFINITION MISSING/);
  }, 60_000);

  it('promotions move NO money and have no wallet collaborator', async () => {
    const before = await prisma.walletTransaction.count();
    const p = await promotions.create({ code: promoCode(), name: 'NoMoney', type: PromotionType.CASHBACK, actorUserId: actor });
    await promotions.setStatus(p.id, PromotionStatus.ACTIVE, actor);
    await promotions.listActiveForPlayer();
    expect(await prisma.walletTransaction.count()).toBe(before);
  }, 60_000);

  /* ==================================================== X-02 EVENT PIPELINE */

  it('records a durable activity event', async () => {
    const u = await newUser();
    const key = `test:event:${randomUUID()}`;
    await events.record({ userId: u, type: ActivityType.LOGIN, eventKey: key, metadata: { countryCode: 'GB' } });

    const row = await prisma.userActivity.findUnique({ where: { id: activityEventId(key) } });
    expect(row).not.toBeNull();
    expect(row!.userId).toBe(u);
    expect(row!.type).toBe(ActivityType.LOGIN);
  }, 60_000);

  it('is IDEMPOTENT — the same event key never creates two rows', async () => {
    const u = await newUser();
    const key = `test:idem:${randomUUID()}`;
    await events.record({ userId: u, type: ActivityType.GAME_PLAY, eventKey: key });
    await events.record({ userId: u, type: ActivityType.GAME_PLAY, eventKey: key });
    await events.record({ userId: u, type: ActivityType.GAME_PLAY, eventKey: key });
    expect(await prisma.userActivity.count({ where: { id: activityEventId(key) } })).toBe(1);
  }, 60_000);

  it('CONCURRENT emits of the same event create exactly one row', async () => {
    const u = await newUser();
    const key = `test:concurrent:${randomUUID()}`;
    await Promise.all(Array.from({ length: 6 }, () =>
      events.record({ userId: u, type: ActivityType.DEPOSIT, eventKey: key })));
    expect(await prisma.userActivity.count({ where: { id: activityEventId(key) } })).toBe(1);
  }, 60_000);

  it('NEVER throws — a bad event cannot fail the business action that emitted it', async () => {
    // A non-existent user violates the foreign key; record() must swallow it.
    await expect(events.record({
      userId: '00000000-0000-4000-8000-000000000000',
      type: ActivityType.LOGIN, eventKey: `test:bad:${randomUUID()}`,
    })).resolves.toBeUndefined();
  }, 60_000);

  it('STRIPS credential-shaped metadata, recursively', async () => {
    const u = await newUser();
    const key = `test:sanitise:${randomUUID()}`;
    await events.record({
      userId: u, type: ActivityType.LOGIN, eventKey: key,
      metadata: {
        countryCode: 'GB',
        password: 'hunter2',
        accessToken: 'jwt.abc.def',
        nested: { refreshToken: 'r-123', totpSecret: 'ABCDEF', safe: 'keep-me' },
      },
    });
    const row = await prisma.userActivity.findUnique({ where: { id: activityEventId(key) } });
    const dump = JSON.stringify(row!.metadata).toLowerCase();
    for (const secret of ['hunter2', 'jwt.abc.def', 'r-123', 'abcdef', 'password', 'token', 'totp']) {
      expect(dump).not.toContain(secret);
    }
    expect(dump).toContain('keep-me');
    expect(dump).toContain('gb');
  }, 60_000);

  it('the sanitiser drops every forbidden key shape', () => {
    const out = sanitiseMetadata({
      apiKey: 'x', api_key: 'x', 'X-Auth-Token': 'x', serverSeed: 'x',
      cardNumber: 'x', cvv: '123', ok: 'yes',
    }) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['ok']);
  });

  it('events SURVIVE a restart and back a distinct-user-per-day query', async () => {
    const u = await newUser();
    await events.record({ userId: u, type: ActivityType.LOGIN, eventKey: `test:dau:${randomUUID()}` });

    const ref2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app2 = ref2.createNestApplication();
    await app2.init();
    try {
      const p2 = app2.get(PrismaService);
      const rows = await p2.$queryRaw<{ n: bigint }[]>`
        SELECT count(DISTINCT user_id)::bigint AS n FROM user_activities
        WHERE occurred_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`;
      // This is exactly the shape a DAU figure needs, and it is now non-zero.
      expect(Number(rows[0]!.n)).toBeGreaterThan(0);
    } finally {
      await app2.close();
    }
  }, 180_000);

  it('reports when collection STARTED, so no metric predates the pipeline', async () => {
    const started = await events.collectionStartedAt();
    expect(started).toBeInstanceOf(Date);
  }, 60_000);
});
