import { randomUUID } from 'node:crypto';

import { BadRequestException, ForbiddenException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ActivityType, PartnerStatus } from '@prisma/client';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { ActivityEventService } from '../events/activity-event.service';
import { PartnerService } from '../partner/partner.service';
import { AnalyticsService } from './analytics.service';

/**
 * Phase 2D.9 (part 2) INTEGRATION against real Postgres (`RUN_DB_IT=1`).
 *
 * Engagement / DAU-MAU on the activity-event pipeline (X-02) and the partner activity report
 * (PA-07), including its ownership isolation and its deliberate absence of any money column.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

d('Phase 2D.9 engagement + partner report (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let analytics: AnalyticsService;
  let partners: PartnerService;
  let events: ActivityEventService;
  let actor: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    analytics = app.get(AnalyticsService);
    partners = app.get(PartnerService);
    events = app.get(ActivityEventService);
    actor = await newUser();
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  async function newUser(): Promise<string> {
    return (await prisma.user.create({
      data: {
        email: `p9e_${randomUUID()}@t.local`,
        username: `p9e${randomUUID().slice(0, 12)}`,
        status: 'ACTIVE',
        authProvider: 'LOCAL',
        referralCode: `RE${randomUUID().slice(0, 10).toUpperCase().replace(/-/g, '')}`,
      },
    })).id;
  }

  const window = (days = 2) => ({
    from: new Date(Date.now() - days * 86_400_000).toISOString(),
    to: new Date(Date.now() + 60_000).toISOString(),
  });

  /* ==================================================== X-02 ENGAGEMENT */

  it('counts a user as active exactly once however many events they record', async () => {
    const u = await newUser();
    const before = await analytics.engagement(window());

    for (const type of [ActivityType.LOGIN, ActivityType.DEPOSIT, ActivityType.GAME_PLAY]) {
      await events.record({ userId: u, type, eventKey: `eng:${u}:${type}` });
    }

    const after = await analytics.engagement(window());
    // Three events, ONE additional active user. DAU is distinct users, not event volume.
    expect(after.eventsInWindow - before.eventsInWindow).toBe(3);
    expect(after.activeUsersInWindow! - before.activeUsersInWindow!).toBe(1);
  });

  it('a re-emitted event does not inflate the active-user or event count', async () => {
    const u = await newUser();
    const key = `eng:dup:${u}`;
    await events.record({ userId: u, type: ActivityType.LOGIN, eventKey: key });
    const once = await analytics.engagement(window());

    await events.record({ userId: u, type: ActivityType.LOGIN, eventKey: key });
    await events.record({ userId: u, type: ActivityType.LOGIN, eventKey: key });
    const thrice = await analytics.engagement(window());

    expect(thrice.eventsInWindow).toBe(once.eventsInWindow);
    expect(thrice.activeUsersInWindow).toBe(once.activeUsersInWindow);
  });

  it('states the definitions it used, so DAU cannot be silently reinterpreted', async () => {
    const e = await analytics.engagement(window());
    expect(e.definitions.dau).toContain('Distinct users');
    expect(e.definitions.dau).toContain('UTC calendar day');
    expect(e.definitions.mau).toContain('30 days');
  });

  it('declares the window incomplete when it reaches back before the first event', async () => {
    const u = await newUser();
    await events.record({ userId: u, type: ActivityType.LOGIN, eventKey: `eng:cov:${u}` });

    // The widest window the deployment permits (366 days) still predates the pipeline, which was
    // deployed in this phase. Deliberately NOT wider: the range guard rejects, it never clamps.
    const wide = await analytics.engagement({
      from: new Date(Date.now() - 360 * 86_400_000).toISOString(),
      to: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(wide.dataAvailableFrom).not.toBeNull();
    expect(wide.windowFullyCovered).toBe(false);
    const coverage = wide.unavailable.find((x) => x.metric === 'coverage');
    expect(coverage?.reason).toContain('no backfill');
  });

  it('never returns a fabricated figure for retention, LTV, session time or bounce rate', async () => {
    const e = await analytics.engagement(window());
    for (const metric of ['retention', 'ltv', 'sessionTime', 'bounceRate']) {
      const row = e.unavailable.find((x) => x.metric === metric);
      // The metric name is folded into the assertion so a failure names which one was missing.
      expect(`${metric}:${row ? 'declared' : 'MISSING'}`).toBe(`${metric}:declared`);
      expect(row!.reason).toMatch(/NOT AVAILABLE/);
    }
    // And no numeric field for any of them exists on the payload at all.
    expect(Object.keys(e)).not.toContain('retention');
    expect(Object.keys(e)).not.toContain('ltv');
  });

  it('the daily series carries one row per day with at least one event, never zero-filled', async () => {
    const u = await newUser();
    await events.record({ userId: u, type: ActivityType.LOGIN, eventKey: `eng:series:${u}` });
    const e = await analytics.engagement(window(2));

    const today = new Date().toISOString().slice(0, 10);
    expect(e.dailyActiveUsers.some((r) => r.date === today)).toBe(true);
    // Every returned day is a day that genuinely had activity.
    expect(e.dailyActiveUsers.every((r) => r.activeUsers > 0)).toBe(true);
  });

  it('rejects an inverted window rather than silently swapping the bounds', async () => {
    await expect(
      analytics.engagement({ from: new Date().toISOString(), to: new Date(Date.now() - 86_400_000).toISOString() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /* ================================================= PA-07 PARTNER REPORT */

  async function newPartnerWithMember(name: string) {
    const p = await partners.create({ name, revenueSharePercent: '1', actorUserId: actor });
    const member = await newUser();
    await partners.addMember(p.id, member, actor, true);
    return { partnerId: p.id, member };
  }

  it('a partner sees the recorded history of their OWN organisation', async () => {
    const { partnerId, member } = await newPartnerWithMember(`P9 Report ${randomUUID().slice(0, 8)}`);
    await partners.setShare(partnerId, '2.5', actor);
    await partners.setStatus(partnerId, PartnerStatus.ACTIVE, actor);

    const report = await partners.myActivityReport(member);
    expect(report.partner.id).toBe(partnerId);
    expect(report.events.length).toBeGreaterThanOrEqual(3);

    const summaries = report.events.map((e) => e.summary).join(' | ');
    expect(summaries).toContain('Ownership share changed from');
    expect(summaries).toContain('Status changed from');
  });

  it('ISOLATION — partner B\'s report contains nothing belonging to partner A', async () => {
    const a = await newPartnerWithMember(`P9 Iso A ${randomUUID().slice(0, 8)}`);
    const b = await newPartnerWithMember(`P9 Iso B ${randomUUID().slice(0, 8)}`);
    await partners.setShare(a.partnerId, '3.5', actor);

    const reportB = await partners.myActivityReport(b.member);
    expect(reportB.partner.id).toBe(b.partnerId);
    // The only way to be sure: B's report must resolve to B, and A's share change (3.5) must be absent.
    expect(reportB.events.some((e) => e.summary.includes('3.5'))).toBe(false);
  });

  it('a user who belongs to no partner is refused, not given an empty report', async () => {
    const stranger = await newUser();
    await expect(partners.myActivityReport(stranger)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('withholds the operator identity behind every change', async () => {
    const { partnerId, member } = await newPartnerWithMember(`P9 Actor ${randomUUID().slice(0, 8)}`);
    await partners.setStatus(partnerId, PartnerStatus.ACTIVE, actor);

    const report = await partners.myActivityReport(member);
    const blob = JSON.stringify(report);
    // The acting operator's user id must never reach a partner.
    expect(blob).not.toContain(actor);
    expect(report.events.every((e) => !e.changed.includes('actorUserId'))).toBe(true);
    // Nor the user id of a fellow member.
    expect(report.events.every((e) => !e.changed.includes('memberUserId'))).toBe(true);
  });

  it('carries NO monetary column and repeats the blocked financial reasons', async () => {
    const { member } = await newPartnerWithMember(`P9 Money ${randomUUID().slice(0, 8)}`);
    const report = await partners.myActivityReport(member);

    const metrics = report.unavailable.map((u) => u.metric);
    expect(metrics).toContain('netProfit');
    expect(metrics).toContain('partnerProfit');
    expect(metrics).toContain('availableBalance');

    // No event row carries an amount, a balance or a currency.
    for (const e of report.events) {
      expect(Object.keys(e).sort()).toEqual(['action', 'at', 'changed', 'summary']);
    }
  });

  it('reports truncation instead of silently dropping rows', async () => {
    const { partnerId, member } = await newPartnerWithMember(`P9 Trunc ${randomUUID().slice(0, 8)}`);
    await partners.setShare(partnerId, '1.5', actor);
    await partners.setShare(partnerId, '1.75', actor);

    const limited = await partners.myActivityReport(member, { limit: 1 });
    expect(limited.events).toHaveLength(1);
    expect(limited.truncated).toBe(true);

    const full = await partners.myActivityReport(member, { limit: 500 });
    expect(full.truncated).toBe(false);
    expect(full.events.length).toBeGreaterThan(1);
  });

  it('rejects an inverted report window', async () => {
    const { member } = await newPartnerWithMember(`P9 Win ${randomUUID().slice(0, 8)}`);
    await expect(
      partners.myActivityReport(member, {
        from: new Date().toISOString(),
        to: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
