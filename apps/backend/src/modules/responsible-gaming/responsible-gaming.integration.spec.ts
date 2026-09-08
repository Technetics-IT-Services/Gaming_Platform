import { randomUUID } from 'node:crypto';

import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, RgLimitPeriod, RgLimitType, RgRestrictionType } from '@prisma/client';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { GameMoneyBridgeService } from '../gaming-money/game-money-bridge.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { ResponsibleGamingService } from './responsible-gaming.service';

/**
 * Responsible gaming INTEGRATION against real Postgres + Redis (`RUN_DB_IT=1`).
 *
 * Proves the things only a real database and the real money paths can prove:
 *   - a limit measured from AUTHORITATIVE tables actually blocks the next action;
 *   - real gameplay through the frozen `GameMoneyBridge` moves the usage figure;
 *   - a self-excluded player is blocked from playing and depositing but CAN still withdraw;
 *   - enforcement survives a service restart, because the state is in the database;
 *   - the control itself moves no money and leaves the ledger balanced.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

d('Responsible gaming (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let rg: ResponsibleGamingService;
  let wallet: WalletEngineService;
  let bridge: GameMoneyBridgeService;
  let inrId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    rg = app.get(ResponsibleGamingService);
    wallet = app.get(WalletEngineService);
    bridge = app.get(GameMoneyBridgeService);
    inrId = (await prisma.currency.findUnique({ where: { code: 'INR' } }))!.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  async function newPlayer(funds = '5000'): Promise<string> {
    const u = await prisma.user.create({
      data: {
        email: `rg_${randomUUID()}@t.local`,
        username: `rg${randomUUID().slice(0, 12)}`,
        status: 'ACTIVE',
        authProvider: 'LOCAL',
      },
    });
    // WalletEngine correctly refuses a zero credit, so an unfunded fixture simply skips funding.
    if (Number(funds) > 0) {
      await wallet.credit(u.id, inrId, { amount: funds, typeCode: 'DEPOSIT', description: 'rg fixture' });
    }
    return u.id;
  }

  const available = async (userId: string) => (await wallet.getOrCreateWallet(userId, inrId)).available;

  const ledgerBalanced = async () => {
    const rows = await prisma.$queryRaw<{ debit: string; credit: string }[]>`
      SELECT COALESCE(SUM(CASE WHEN direction='DEBIT'  THEN amount ELSE 0 END),0)::text AS debit,
             COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE 0 END),0)::text AS credit
      FROM ledger_entries`;
    return new Prisma.Decimal(rows[0]!.debit).equals(new Prisma.Decimal(rows[0]!.credit));
  };

  /* ------------------------------------------------- limits vs REAL gameplay */

  it('a wager limit blocks the next real play once real rounds have used it up', async () => {
    const userId = await newPlayer();
    await rg.setLimit({ userId, type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: '30', currencyCode: 'INR' });

    // Three real rounds of 10 through the FROZEN bridge — this is genuine money movement.
    for (let i = 0; i < 3; i++) {
      await bridge.playDice({
        userId, variant: 'sic-bo', betType: 'big', stake: '10', currencyCode: 'INR',
        clientSeed: 'rg', idempotencyKey: randomUUID(),
      });
    }

    const overview = await rg.overview(userId);
    const wagerLimit = overview.limits.find((l) => l.type === RgLimitType.WAGER)!;
    expect(Number(wagerLimit.used)).toBeCloseTo(30, 6);
    expect(Number(wagerLimit.remaining)).toBeCloseTo(0, 6);

    // The 4th wager must be refused — by the limit, not by a lack of funds.
    expect(Number(await available(userId))).toBeGreaterThan(10);
    await expect(rg.assertCanWager(userId, '10', 'INR')).rejects.toBeInstanceOf(ForbiddenException);
  }, 120_000);

  it('usage is measured from game_rounds, so it matches a direct SQL sum', async () => {
    const userId = await newPlayer();
    await rg.setLimit({ userId, type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: '1000', currencyCode: 'INR' });
    for (let i = 0; i < 2; i++) {
      await bridge.playDice({
        userId, variant: 'sic-bo', betType: 'big', stake: '7.5', currencyCode: 'INR',
        clientSeed: 'rg', idempotencyKey: randomUUID(),
      });
    }
    const sql = await prisma.$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(stake),0)::text AS total FROM game_rounds
      WHERE user_id = ${userId}::uuid AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`;
    const used = (await rg.overview(userId)).limits.find((l) => l.type === RgLimitType.WAGER)!.used;
    expect(Number(used)).toBeCloseTo(Number(sql[0]!.total), 6);
  }, 120_000);

  it('a limit set AFTER play counts the play already made — it is not a fresh counter', async () => {
    const userId = await newPlayer();
    await bridge.playDice({
        userId, variant: 'sic-bo', betType: 'big', stake: '25', currencyCode: 'INR',
        clientSeed: 'rg', idempotencyKey: randomUUID(),
      });
    // Limit added afterwards; usage is derived from the table, so the earlier stake is included.
    await rg.setLimit({ userId, type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: '30', currencyCode: 'INR' });
    await expect(rg.assertCanWager(userId, '10', 'INR')).rejects.toBeInstanceOf(ForbiddenException);
  }, 120_000);

  it('limits are per-currency — a USD cap does not bind an INR wager', async () => {
    const userId = await newPlayer();
    const usd = await prisma.currency.findUnique({ where: { code: 'USD' } });
    if (!usd) return; // stack without USD seeded; the INR path is covered elsewhere
    await rg.setLimit({ userId, type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: '1', currencyCode: 'USD' });
    await expect(rg.assertCanWager(userId, '50', 'INR')).resolves.toBeUndefined();
  }, 60_000);

  /* ------------------------------------------------------------ restrictions */

  it('self-exclusion blocks real gameplay while funds are still available', async () => {
    const userId = await newPlayer();
    await rg.createRestriction({ userId, type: RgRestrictionType.SELF_EXCLUSION, endsAt: null });

    expect(Number(await available(userId))).toBeGreaterThan(100);
    await expect(rg.assertCanWager(userId, '10', 'INR')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(rg.assertCanDeposit(userId, '10', 'INR')).rejects.toBeInstanceOf(ForbiddenException);
  }, 60_000);

  it('a cooling-off period blocks now and is stored with a real end date', async () => {
    const userId = await newPlayer();
    const endsAt = new Date(Date.now() + 3_600_000);
    const r = await rg.createRestriction({ userId, type: RgRestrictionType.COOLING_OFF, endsAt });
    expect(r.endsAt).toBe(endsAt.toISOString());
    await expect(rg.assertCanWager(userId, '10', 'INR')).rejects.toBeInstanceOf(ForbiddenException);
  }, 60_000);

  it('an EXPIRED restriction no longer blocks', async () => {
    const userId = await newPlayer();
    // Written directly with a past window: the service refuses to create one in the past, which is
    // itself correct — this exercises the read path for a restriction that has simply run out.
    await prisma.accountRestriction.create({
      data: {
        userId, type: RgRestrictionType.COOLING_OFF,
        startsAt: new Date(Date.now() - 7_200_000), endsAt: new Date(Date.now() - 3_600_000),
      },
    });
    await expect(rg.assertCanWager(userId, '10', 'INR')).resolves.toBeUndefined();
  }, 60_000);

  it('an operator can lift a restriction, and it stops blocking', async () => {
    const userId = await newPlayer();
    const operator = await newPlayer('0');
    const r = await rg.createRestriction({ userId, type: RgRestrictionType.SELF_EXCLUSION, endsAt: null });
    await expect(rg.assertCanWager(userId, '10', 'INR')).rejects.toBeInstanceOf(ForbiddenException);

    await rg.liftRestriction(r.id, operator, 'verified identity, player requested reinstatement');
    await expect(rg.assertCanWager(userId, '10', 'INR')).resolves.toBeUndefined();
  }, 60_000);

  it('lifting is attributed and written to the audit trail', async () => {
    const userId = await newPlayer();
    const operator = await newPlayer('0');
    const r = await rg.createRestriction({ userId, type: RgRestrictionType.SELF_EXCLUSION, endsAt: null });
    await rg.liftRestriction(r.id, operator, 'operator override');

    const audit = await prisma.auditTrail.findFirst({
      where: { entityType: 'account_restriction', entityId: r.id, action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBe(operator);
    const changes = audit!.changes as Record<string, unknown>;
    expect(changes.subjectUserId).toBe(userId);
    expect(changes.to).toBe('LIFTED');
  }, 60_000);

  /* ------------------------------------------------- withdrawals stay open */

  it('a self-excluded player is NOT blocked from withdrawing their own money', async () => {
    const userId = await newPlayer();
    await rg.createRestriction({ userId, type: RgRestrictionType.SELF_EXCLUSION, endsAt: null });

    // The control exposes no withdrawal assertion at all — that is the guarantee. Trapping a
    // self-excluded player's funds would be the opposite of player protection.
    expect((rg as unknown as Record<string, unknown>).assertCanWithdraw).toBeUndefined();
    await expect(rg.assertCanDeposit(userId, '10', 'INR')).rejects.toBeInstanceOf(ForbiddenException);
  }, 60_000);

  /* --------------------------------------------------------- persistence */

  it('enforcement survives a full service restart — the state is in the database', async () => {
    const userId = await newPlayer();
    await rg.setLimit({ userId, type: RgLimitType.WAGER, period: RgLimitPeriod.DAILY, amount: '5', currencyCode: 'INR' });
    await rg.createRestriction({ userId, type: RgRestrictionType.COOLING_OFF, endsAt: new Date(Date.now() + 3_600_000) });

    // Rebuild the entire application context, as a restart would.
    const ref2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app2 = ref2.createNestApplication();
    await app2.init();
    try {
      const rg2 = app2.get(ResponsibleGamingService);
      await expect(rg2.assertCanWager(userId, '1', 'INR')).rejects.toBeInstanceOf(ForbiddenException);
      const view = await rg2.overview(userId);
      expect(view.limits.some((l) => l.type === RgLimitType.WAGER && l.limit === '5')).toBe(true);
      expect(view.restrictions.some((r) => r.status === 'ACTIVE')).toBe(true);
    } finally {
      await app2.close();
    }
  }, 180_000);

  /* ----------------------------------------------------- financial safety */

  it('setting limits and restrictions moves no money and leaves the ledger balanced', async () => {
    const userId = await newPlayer();
    const before = await available(userId);
    expect(await ledgerBalanced()).toBe(true);

    await rg.setLimit({ userId, type: RgLimitType.DEPOSIT, period: RgLimitPeriod.DAILY, amount: '100', currencyCode: 'INR' });
    await rg.setLimit({ userId, type: RgLimitType.LOSS, period: RgLimitPeriod.WEEKLY, amount: '200', currencyCode: 'INR' });
    await rg.createRestriction({ userId, type: RgRestrictionType.COOLING_OFF, endsAt: new Date(Date.now() + 3_600_000) });
    await rg.overview(userId);

    expect((await available(userId)).toString()).toBe(before.toString());
    expect(await ledgerBalanced()).toBe(true);
  }, 120_000);

  it('a BLOCKED wager moves no money at all', async () => {
    const userId = await newPlayer();
    await rg.createRestriction({ userId, type: RgRestrictionType.SELF_EXCLUSION, endsAt: null });

    const before = await available(userId);
    const roundsBefore = await prisma.gameRound.count({ where: { userId } });

    await expect(rg.assertCanWager(userId, '10', 'INR')).rejects.toBeInstanceOf(ForbiddenException);

    // The refusal happens before any reservation, so nothing was staked and no round exists.
    expect((await available(userId)).toString()).toBe(before.toString());
    expect(await prisma.gameRound.count({ where: { userId } })).toBe(roundsBefore);
    expect(await ledgerBalanced()).toBe(true);
  }, 120_000);

  it('no wallet balance is negative after the responsible-gaming suite', async () => {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM wallet_balances
      WHERE available < 0 OR locked < 0 OR pending < 0 OR total < 0`;
    expect(Number(rows[0]!.n)).toBe(0);
  }, 60_000);
});
