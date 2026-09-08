import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, RgLimitPeriod, RgLimitType, RgRestrictionStatus, RgRestrictionType } from '@prisma/client';

import { ResponsibleGamingService } from './responsible-gaming.service';

/**
 * Responsible gaming — enforcement logic without a database.
 *
 * These pin the properties that make the control trustworthy: period windows are deterministic and
 * UTC, usage comes from authoritative aggregates, a breach THROWS rather than warning, and a
 * decrease in protection is never delayed. The DB-gated integration suite proves the same behaviour
 * against real Postgres, through the real money paths.
 */

const D = (v: string | number) => new Prisma.Decimal(v);

function make(over: Record<string, unknown> = {}) {
  const audited: Record<string, unknown>[] = [];
  const prisma = {
    currency: { findUnique: jest.fn().mockResolvedValue({ id: 'cur-inr', code: 'INR' }) },
    accountRestriction: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'r1', startsAt: new Date(), status: RgRestrictionStatus.ACTIVE, reason: null, ...data })),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    responsibleGamingLimit: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'l1', ...data })),
    },
    depositRequest: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: D(0) } }) },
    gameRound: { aggregate: jest.fn().mockResolvedValue({ _sum: { stake: D(0), payout: D(0) } }) },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
    ...over,
  };
  const audit = { record: jest.fn().mockImplementation((e: Record<string, unknown>) => { audited.push(e); }) };
  const svc = new ResponsibleGamingService(prisma as never, audit as never);
  return { svc, prisma, audit, audited };
}

/* --------------------------------------------------------------- windows */

describe('period windows are deterministic and UTC', () => {
  const at = (iso: string) => new Date(iso);

  it('DAILY starts at UTC midnight', () => {
    expect(ResponsibleGamingService.windowStart(RgLimitPeriod.DAILY, at('2026-03-15T23:59:59.999Z')).toISOString())
      .toBe('2026-03-15T00:00:00.000Z');
  });

  it('MONTHLY starts on the 1st of the UTC month', () => {
    expect(ResponsibleGamingService.windowStart(RgLimitPeriod.MONTHLY, at('2026-03-31T12:00:00Z')).toISOString())
      .toBe('2026-03-01T00:00:00.000Z');
  });

  it('WEEKLY starts on the ISO Monday', () => {
    // 2026-03-15 is a Sunday → the ISO week began Monday 2026-03-09.
    expect(ResponsibleGamingService.windowStart(RgLimitPeriod.WEEKLY, at('2026-03-15T12:00:00Z')).toISOString())
      .toBe('2026-03-09T00:00:00.000Z');
  });

  it('WEEKLY on a Monday returns that same Monday', () => {
    expect(ResponsibleGamingService.windowStart(RgLimitPeriod.WEEKLY, at('2026-03-09T00:00:00Z')).toISOString())
      .toBe('2026-03-09T00:00:00.000Z');
  });

  it('is unaffected by the host timezone — the same instant gives the same window', () => {
    const a = ResponsibleGamingService.windowStart(RgLimitPeriod.DAILY, at('2026-03-15T00:00:00.000Z'));
    const b = ResponsibleGamingService.windowStart(RgLimitPeriod.DAILY, at('2026-03-15T05:30:00.000+05:30'));
    expect(a.getTime()).toBe(b.getTime());
  });
});

/* ---------------------------------------------------------- restrictions */

describe('self-exclusion and cooling-off block action', () => {
  const activeExclusion = (endsAt: Date | null) => ({
    accountRestriction: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'r1', type: RgRestrictionType.SELF_EXCLUSION, status: RgRestrictionStatus.ACTIVE, startsAt: new Date(0), endsAt, reason: null },
      ]),
      create: jest.fn(), findUnique: jest.fn(), update: jest.fn(),
    },
  });

  it('blocks gameplay while an indefinite self-exclusion is active', async () => {
    const { svc } = make(activeExclusion(null));
    await expect(svc.assertCanWager('u1', '10', 'INR')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks deposits too', async () => {
    const { svc } = make(activeExclusion(null));
    await expect(svc.assertCanDeposit('u1', '10', 'INR')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('says it is permanent when there is no end date', async () => {
    const { svc } = make(activeExclusion(null));
    await expect(svc.assertCanWager('u1', '10', 'INR')).rejects.toThrow(/permanent/i);
  });

  it('names the end date for a time-boxed restriction', async () => {
    const ends = new Date(Date.now() + 86_400_000);
    const { svc } = make(activeExclusion(ends));
    await expect(svc.assertCanWager('u1', '10', 'INR')).rejects.toThrow(ends.toISOString());
  });

  it('allows action when no restriction is active', async () => {
    const { svc } = make();
    await expect(svc.assertNotRestricted('u1', 'Playing')).resolves.toBeUndefined();
  });

  it('queries only ACTIVE, in-window restrictions', async () => {
    const { svc, prisma } = make();
    await svc.assertNotRestricted('u1', 'Playing');
    const where = (prisma.accountRestriction.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.status).toBe(RgRestrictionStatus.ACTIVE);
    expect(where.startsAt.lte).toBeInstanceOf(Date);
    // A permanent exclusion (endsAt NULL) must still match.
    expect(where.OR).toEqual([{ endsAt: null }, { endsAt: { gt: expect.any(Date) } }]);
  });
});

describe('creating a restriction', () => {
  it('requires an end date for cooling-off', async () => {
    const { svc } = make();
    await expect(svc.createRestriction({ userId: 'u1', type: RgRestrictionType.COOLING_OFF, endsAt: null }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a permanent self-exclusion', async () => {
    const { svc } = make();
    await expect(svc.createRestriction({ userId: 'u1', type: RgRestrictionType.SELF_EXCLUSION, endsAt: null }))
      .resolves.toMatchObject({ type: RgRestrictionType.SELF_EXCLUSION, endsAt: null });
  });

  it('rejects an end date in the past', async () => {
    const { svc } = make();
    await expect(svc.createRestriction({
      userId: 'u1', type: RgRestrictionType.COOLING_OFF, endsAt: new Date(Date.now() - 1000),
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REFUSES to shorten an active restriction', async () => {
    const longer = new Date(Date.now() + 10 * 86_400_000);
    const { svc } = make({
      accountRestriction: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r1', type: RgRestrictionType.COOLING_OFF, status: RgRestrictionStatus.ACTIVE, startsAt: new Date(0), endsAt: longer, reason: null },
        ]),
        create: jest.fn(), findUnique: jest.fn(), update: jest.fn(),
      },
    });
    await expect(svc.createRestriction({
      userId: 'u1', type: RgRestrictionType.COOLING_OFF, endsAt: new Date(Date.now() + 86_400_000),
    })).rejects.toThrow(/cannot be shortened/i);
  });

  it('refuses to add anything on top of an indefinite exclusion', async () => {
    const { svc } = make({
      accountRestriction: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r1', type: RgRestrictionType.SELF_EXCLUSION, status: RgRestrictionStatus.ACTIVE, startsAt: new Date(0), endsAt: null, reason: null },
        ]),
        create: jest.fn(), findUnique: jest.fn(), update: jest.fn(),
      },
    });
    await expect(svc.createRestriction({
      userId: 'u1', type: RgRestrictionType.COOLING_OFF, endsAt: new Date(Date.now() + 86_400_000),
    })).rejects.toThrow(/indefinite self-exclusion is already active/i);
  });

  it('writes an audit record naming the subject', async () => {
    const { svc, audited } = make();
    await svc.createRestriction({ userId: 'u1', type: RgRestrictionType.SELF_EXCLUSION, endsAt: null });
    expect(audited).toHaveLength(1);
    expect(audited[0]!.entityType).toBe('account_restriction');
    expect((audited[0]!.changes as Record<string, unknown>).subjectUserId).toBe('u1');
  });

  it('records whether it was self-service or operator-initiated', async () => {
    const { svc, audited } = make();
    await svc.createRestriction({ userId: 'u1', type: RgRestrictionType.SELF_EXCLUSION, endsAt: null, createdByUserId: 'op1' });
    expect((audited[0]!.changes as Record<string, unknown>).selfService).toBe(false);
  });
});

/* ----------------------------------------------------------------- limits */

describe('limit enforcement', () => {
  const withLimit = (amount: string, period = RgLimitPeriod.DAILY, type = RgLimitType.WAGER) => ({
    responsibleGamingLimit: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'l1', type, period, amount: D(amount), currencyId: 'cur-inr', effectiveFrom: new Date(0) },
      ]),
      updateMany: jest.fn(), create: jest.fn(),
    },
  });

  it('allows a wager below the cap', async () => {
    const { svc } = make({ ...withLimit('100'), gameRound: { aggregate: jest.fn().mockResolvedValue({ _sum: { stake: D(50), payout: D(0) } }) } });
    await expect(svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.WAGER, amount: '10', currencyCode: 'INR' }))
      .resolves.toBeUndefined();
  });

  it('allows a wager landing EXACTLY on the cap', async () => {
    const { svc } = make({ ...withLimit('100'), gameRound: { aggregate: jest.fn().mockResolvedValue({ _sum: { stake: D(90), payout: D(0) } }) } });
    await expect(svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.WAGER, amount: '10', currencyCode: 'INR' }))
      .resolves.toBeUndefined();
  });

  it('BLOCKS the wager that would cross the cap', async () => {
    const { svc } = make({ ...withLimit('100'), gameRound: { aggregate: jest.fn().mockResolvedValue({ _sum: { stake: D(95), payout: D(0) } }) } });
    await expect(svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.WAGER, amount: '10', currencyCode: 'INR' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks by one hundredth — no rounding slack', async () => {
    const { svc } = make({ ...withLimit('100'), gameRound: { aggregate: jest.fn().mockResolvedValue({ _sum: { stake: D('99.99'), payout: D(0) } }) } });
    await expect(svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.WAGER, amount: '0.02', currencyCode: 'INR' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reports the cap, the usage and the remaining headroom', async () => {
    const { svc } = make({ ...withLimit('100'), gameRound: { aggregate: jest.fn().mockResolvedValue({ _sum: { stake: D(95), payout: D(0) } }) } });
    await expect(svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.WAGER, amount: '10', currencyCode: 'INR' }))
      .rejects.toThrow(/limit of 100 INR. Used 95, remaining 5/);
  });

  it('does nothing when no limit is set — absence means unlimited', async () => {
    const { svc } = make();
    await expect(svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.WAGER, amount: '99999', currencyCode: 'INR' }))
      .resolves.toBeUndefined();
  });

  it('ignores a limit whose effectiveFrom is still in the future', async () => {
    const { svc, prisma } = make();
    await svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.WAGER, amount: '10', currencyCode: 'INR' });
    const where = (prisma.responsibleGamingLimit.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.effectiveFrom.lte).toBeInstanceOf(Date);
    expect(where.supersededAt).toBeNull();
  });

  it('enforces DAILY and MONTHLY caps together — the stricter one binds', async () => {
    const { svc } = make({
      responsibleGamingLimit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'l1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: D(1000), currencyId: 'cur-inr', effectiveFrom: new Date(0) },
          { id: 'l2', type: RgLimitType.WAGER, period: RgLimitPeriod.MONTHLY, amount: D(50), currencyId: 'cur-inr', effectiveFrom: new Date(0) },
        ]),
        updateMany: jest.fn(), create: jest.fn(),
      },
      gameRound: { aggregate: jest.fn().mockResolvedValue({ _sum: { stake: D(45), payout: D(0) } }) },
    });
    await expect(svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.WAGER, amount: '10', currencyCode: 'INR' }))
      .rejects.toThrow(/monthly/i);
  });

  it('an unknown currency is not this control’s error to raise', async () => {
    const { svc } = make({ currency: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.WAGER, amount: '10', currencyCode: 'ZZZ' }))
      .resolves.toBeUndefined();
  });
});

describe('loss limits use NET loss, floored at zero', () => {
  const lossLimit = (used: { stake: string; payout: string }) => make({
    responsibleGamingLimit: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'l1', type: RgLimitType.LOSS, period: RgLimitPeriod.DAILY, amount: D(100), currencyId: 'cur-inr', effectiveFrom: new Date(0) },
      ]),
      updateMany: jest.fn(), create: jest.fn(),
    },
    gameRound: { aggregate: jest.fn().mockResolvedValue({ _sum: { stake: D(used.stake), payout: D(used.payout) } }) },
  });

  it('counts stake minus payout, not gross stake', async () => {
    // Staked 500, won back 450 → net loss 50. A gross-stake reading would have blocked this.
    const { svc } = lossLimit({ stake: '500', payout: '450' });
    await expect(svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.LOSS, amount: '40', currencyCode: 'INR' }))
      .resolves.toBeUndefined();
  });

  it('blocks once the net loss cap would be crossed', async () => {
    const { svc } = lossLimit({ stake: '500', payout: '450' });
    await expect(svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.LOSS, amount: '60', currencyCode: 'INR' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('floors a winning player at zero loss — being up creates no extra headroom', async () => {
    // Net is -200 (a profit). Floored to 0, so the full 100 cap remains, not 300.
    const { svc } = lossLimit({ stake: '300', payout: '500' });
    await expect(svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.LOSS, amount: '100', currencyCode: 'INR' }))
      .resolves.toBeUndefined();
    const { svc: svc2 } = lossLimit({ stake: '300', payout: '500' });
    await expect(svc2.assertWithinLimit({ userId: 'u1', type: RgLimitType.LOSS, amount: '101', currencyCode: 'INR' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('deposit limits count committed money', () => {
  it('aggregates PENDING, PROCESSING and COMPLETED deposits', async () => {
    const { svc, prisma } = make({
      responsibleGamingLimit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'l1', type: RgLimitType.DEPOSIT, period: RgLimitPeriod.DAILY, amount: D(1000), currencyId: 'cur-inr', effectiveFrom: new Date(0) },
        ]),
        updateMany: jest.fn(), create: jest.fn(),
      },
    });
    await svc.assertWithinLimit({ userId: 'u1', type: RgLimitType.DEPOSIT, amount: '10', currencyCode: 'INR' });
    const where = (prisma.depositRequest.aggregate as jest.Mock).mock.calls[0][0].where;
    // A pending deposit is money the player has already committed; ignoring it would let the cap be
    // walked past by queueing requests the operator has not credited yet.
    expect(where.status.in).toEqual(expect.arrayContaining(['PENDING', 'PROCESSING', 'COMPLETED']));
  });
});

/* ------------------------------------------------------------- set limits */

describe('setting limits', () => {
  afterEach(() => { delete process.env.RG_LIMIT_INCREASE_DELAY_HOURS; });

  it('rejects a zero or negative limit', async () => {
    const { svc } = make();
    for (const amount of ['0', '-5']) {
      await expect(svc.setLimit({ userId: 'u1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount, currencyCode: 'INR' }))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('rejects an unknown currency', async () => {
    const { svc } = make({ currency: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(svc.setLimit({ userId: 'u1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: '10', currencyCode: 'ZZZ' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies a DECREASE immediately, even when a delay is configured', async () => {
    process.env.RG_LIMIT_INCREASE_DELAY_HOURS = '24';
    const { svc } = make({
      responsibleGamingLimit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'l1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: D(500), currencyId: 'cur-inr', effectiveFrom: new Date(0) },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'l2', ...data })),
      },
    });
    const before = Date.now();
    const res = await svc.setLimit({ userId: 'u1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: '100', currencyCode: 'INR' });
    // Tightening your own protection must never be made to wait.
    expect(new Date(res.effectiveFrom).getTime()).toBeLessThanOrEqual(before + 5_000);
  });

  it('DELAYS an increase when a delay is configured', async () => {
    process.env.RG_LIMIT_INCREASE_DELAY_HOURS = '24';
    const { svc } = make({
      responsibleGamingLimit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'l1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: D(100), currencyId: 'cur-inr', effectiveFrom: new Date(0) },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'l2', ...data })),
      },
    });
    const res = await svc.setLimit({ userId: 'u1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: '500', currencyCode: 'INR' });
    expect(new Date(res.effectiveFrom).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  });

  it('applies an increase IMMEDIATELY by default — no delay is invented', async () => {
    const { svc } = make({
      responsibleGamingLimit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'l1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: D(100), currencyId: 'cur-inr', effectiveFrom: new Date(0) },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'l2', ...data })),
      },
    });
    const res = await svc.setLimit({ userId: 'u1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: '500', currencyCode: 'INR' });
    expect(new Date(res.effectiveFrom).getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('a FIRST limit applies immediately even with a delay configured (it is new protection)', async () => {
    process.env.RG_LIMIT_INCREASE_DELAY_HOURS = '24';
    const { svc } = make();
    const res = await svc.setLimit({ userId: 'u1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: '100', currencyCode: 'INR' });
    expect(new Date(res.effectiveFrom).getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('audits the change with direction and both values', async () => {
    const { svc, audited } = make({
      responsibleGamingLimit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'l1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: D(500), currencyId: 'cur-inr', effectiveFrom: new Date(0) },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'l2', ...data })),
      },
    });
    await svc.setLimit({ userId: 'u1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: '100', currencyCode: 'INR' });
    const c = audited[0]!.changes as Record<string, unknown>;
    expect(c.direction).toBe('DECREASE');
    expect(c.from).toBe('500');
    expect(c.to).toBe('100');
  });

  it('supersedes the previous live limit so exactly one is ever in force', async () => {
    const { svc, prisma } = make();
    await svc.setLimit({ userId: 'u1', type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: '100', currencyCode: 'INR' });
    const call = (prisma.responsibleGamingLimit.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where.supersededAt).toBeNull();
    expect(call.data.supersededAt).toBeInstanceOf(Date);
  });
});

/* --------------------------------------------------------------- combined */

describe('assertCanWager combines every applicable control', () => {
  it('checks restrictions BEFORE limits — an excluded player is blocked regardless of headroom', async () => {
    const order: string[] = [];
    const { svc } = make({
      accountRestriction: {
        findMany: jest.fn().mockImplementation(() => { order.push('restriction'); return Promise.resolve([]); }),
        create: jest.fn(), findUnique: jest.fn(), update: jest.fn(),
      },
      responsibleGamingLimit: {
        findMany: jest.fn().mockImplementation(() => { order.push('limit'); return Promise.resolve([]); }),
        updateMany: jest.fn(), create: jest.fn(),
      },
    });
    await svc.assertCanWager('u1', '10', 'INR');
    expect(order[0]).toBe('restriction');
  });

  it('applies BOTH the wager cap and the loss cap to a stake', async () => {
    const seen: RgLimitType[] = [];
    const { svc } = make({
      responsibleGamingLimit: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { type: RgLimitType } }) => {
          seen.push(where.type); return Promise.resolve([]);
        }),
        updateMany: jest.fn(), create: jest.fn(),
      },
    });
    await svc.assertCanWager('u1', '10', 'INR');
    expect(seen).toEqual([RgLimitType.WAGER, RgLimitType.LOSS]);
  });

  it('never consults a wager or loss cap on the deposit path', async () => {
    const seen: RgLimitType[] = [];
    const { svc } = make({
      responsibleGamingLimit: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { type: RgLimitType } }) => {
          seen.push(where.type); return Promise.resolve([]);
        }),
        updateMany: jest.fn(), create: jest.fn(),
      },
    });
    await svc.assertCanDeposit('u1', '10', 'INR');
    expect(seen).toEqual([RgLimitType.DEPOSIT]);
  });
});

/* -------------------------------------------------------------- read-only */

describe('the control never moves money', () => {
  it('has no wallet, ledger or bridge collaborator at all', () => {
    const { prisma } = make();
    for (const model of ['wallet', 'walletBalance', 'ledger', 'ledgerEntry', 'walletTransaction']) {
      expect((prisma as Record<string, unknown>)[model]).toBeUndefined();
    }
  });

  it('only ever READS the financial tables it measures usage from', () => {
    const { prisma } = make();
    for (const model of ['depositRequest', 'gameRound'] as const) {
      const m = prisma[model] as Record<string, unknown>;
      expect(m.aggregate).toBeDefined();
      for (const w of ['create', 'update', 'delete', 'upsert', 'updateMany']) {
        expect(m[w]).toBeUndefined();
      }
    }
  });
});
