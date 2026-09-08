import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { GameMoneyBridgeService } from './game-money-bridge.service';
import { GameMoneyRecoveryService } from './game-money-recovery.service';

/**
 * Phase 2C.4 — Baccarat + Blackjack INTEGRATION against real Postgres + Redis (gated on
 * `RUN_DB_IT=1`; skipped otherwise). Real services only — real reservations (WalletEngine), the
 * real frozen Card engine and the real bridge — no faked money, no direct balance/ledger mutation.
 * Proves the financial invariant, reconcile balanced, no duplicate ledger, Baccarat multi-bet
 * settlement + recovery, and the interactive Blackjack lifecycle (hit/stand/double), concurrency,
 * restart reconstruction, and doubled-hand recovery.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

async function ledgerBalanced(prisma: PrismaService): Promise<{ balanced: boolean; difference: string }> {
  const rows = await prisma.ledgerEntry.groupBy({ by: ['direction'], _sum: { amount: true } });
  let debit = 0;
  let credit = 0;
  for (const r of rows) {
    const v = Number(r._sum.amount ?? 0);
    if (r.direction === 'DEBIT') debit = v;
    else credit = v;
  }
  return { balanced: Math.abs(debit - credit) < 1e-6, difference: String(debit - credit) };
}

d('GameMoney Baccarat + Blackjack (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wallet: WalletEngineService;
  let bridge: GameMoneyBridgeService;
  let recovery: GameMoneyRecoveryService;
  let inrId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    wallet = app.get(WalletEngineService);
    bridge = app.get(GameMoneyBridgeService);
    recovery = app.get(GameMoneyRecoveryService);
    inrId = (await prisma.currency.findUnique({ where: { code: 'INR' } }))!.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  async function fundUser(amount: string): Promise<string> {
    const u = await prisma.user.create({ data: { email: `it_${randomUUID()}@t.local`, username: `it${randomUUID().slice(0, 12)}`, status: 'ACTIVE', authProvider: 'LOCAL' } });
    await wallet.credit(u.id, inrId, { amount, typeCode: 'DEPOSIT', description: 'it fund' });
    return u.id;
  }
  const avail = async (userId: string) => Number((await wallet.getOrCreateWallet(userId, inrId)).available);

  /* -------------------------------- BACCARAT -------------------------------- */

  it('BACCARAT: 10 real multi-bet rounds — invariant holds every round, wins & losses observed', async () => {
    const userId = await fundUser('2000');
    let wins = 0;
    let losses = 0;
    for (let i = 0; i < 10; i += 1) {
      const before = await avail(userId);
      const bets = i % 2 === 0 ? [{ type: 'player', amount: '10' }, { type: 'banker', amount: '10' }] : [{ type: 'tie', amount: '10' }];
      const totalStake = bets.reduce((s, b) => s + Number(b.amount), 0);
      const res = await bridge.playBaccarat({ userId, bets, currencyCode: 'INR', idempotencyKey: randomUUID() });
      const after = await avail(userId);
      expect(after).toBeCloseTo(before - totalStake + Number(res.payout), 6); // invariant
      expect(after).toBeGreaterThanOrEqual(0);
      if (Number(res.payout) > 0) wins += 1; else losses += 1;
    }
    expect(wins).toBeGreaterThanOrEqual(1);
    expect(losses).toBeGreaterThanOrEqual(1);
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 120_000);

  it('BACCARAT: insufficient balance rejected atomically; duplicate + concurrent settle once', async () => {
    const poor = await fundUser('5');
    const pb = await avail(poor);
    await expect(bridge.playBaccarat({ userId: poor, bets: [{ type: 'player', amount: '100' }], currencyCode: 'INR', idempotencyKey: randomUUID() })).rejects.toBeDefined();
    expect(await avail(poor)).toBe(pb);

    const userId = await fundUser('500');
    const key = randomUUID();
    const before = await avail(userId);
    const [a, b] = await Promise.all([
      bridge.playBaccarat({ userId, bets: [{ type: 'banker', amount: '20' }], currencyCode: 'INR', idempotencyKey: key }),
      bridge.playBaccarat({ userId, bets: [{ type: 'banker', amount: '20' }], currencyCode: 'INR', idempotencyKey: key }),
    ]);
    expect(a.roundId).toBe(b.roundId);
    // Authoritative settled payout from the DB round (a.payout can be a transient create-race loser's).
    const settledPayout = Number((await prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } }))!.payout);
    expect(await avail(userId)).toBeCloseTo(before - 20 + settledPayout, 6);
  }, 60_000);

  it('BACCARAT: a pending-settlement round recovers via the centralized recovery', async () => {
    const userId = await fundUser('200');
    const before = await avail(userId);
    const round = await prisma.gameRound.create({ data: { userId, gameKey: 'baccarat', variant: 'baccarat', betType: 'player', currencyId: inrId, stake: '20', payout: '40', status: 'PENDING_SETTLEMENT', idempotencyKey: randomUUID(), result: { kind: 'baccarat', winners: ['player'] } } });
    const reserved = await wallet.reserve(userId, inrId, '20', `round:${round.id}`, `${round.id}:reserve`);
    await prisma.gameRound.update({ where: { id: round.id }, data: { reservationId: reserved.reservationId } });
    expect(await recovery.recoverOne(round.id)).toBe('recovered');
    expect(await avail(userId)).toBe(before - 20 + 40);
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 30_000);

  /* -------------------------------- BLACKJACK ------------------------------- */

  it('BLACKJACK: 10 real interactive hands — invariant holds, wins & losses observed, hits exercised', async () => {
    const userId = await fundUser('2000');
    let payoutPositive = 0;
    let payoutZero = 0;
    let hitsExercised = 0;
    for (let i = 0; i < 10; i += 1) {
      const before = await avail(userId);
      let state = await bridge.startBlackjack({ userId, stake: '10', currencyCode: 'INR', idempotencyKey: randomUUID() });
      expect(state.active).toBe(true);
      expect(state.dealer.length).toBe(1); // hole hidden
      // Interactive: hit while low, then stand.
      let guard = 0;
      while (state.active && state.playerValue < 12 && guard < 5) { state = await bridge.blackjackAction({ userId, roundId: state.roundId, action: 'HIT' }); guard += 1; hitsExercised += 1; }
      if (state.active) state = await bridge.blackjackAction({ userId, roundId: state.roundId, action: 'STAND' });
      const after = await avail(userId);
      expect(state.status).toBe('SETTLED');
      expect(after).toBeCloseTo(before - Number(state.stake) + Number(state.payout), 6); // invariant
      expect(after).toBeGreaterThanOrEqual(0);
      expect(state.dealer.length).toBeGreaterThanOrEqual(2); // full dealer revealed
      if (Number(state.payout) > 0) payoutPositive += 1; else payoutZero += 1;
    }
    expect(payoutPositive).toBeGreaterThanOrEqual(1);
    expect(payoutZero).toBeGreaterThanOrEqual(1);
    expect(hitsExercised).toBeGreaterThanOrEqual(1); // at least one interactive HIT happened
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 120_000);

  it('BLACKJACK: DOUBLE reserves a second stake and settles once at 2× stake (invariant)', async () => {
    const userId = await fundUser('500');
    const before = await avail(userId);
    const start = await bridge.startBlackjack({ userId, stake: '20', currencyCode: 'INR', idempotencyKey: randomUUID() });
    const res = await bridge.blackjackAction({ userId, roundId: start.roundId, action: 'DOUBLE' });
    expect(res.status).toBe('SETTLED');
    expect(res.doubled).toBe(true);
    expect(Number(res.stake)).toBe(40); // total committed stake = 2× original
    const after = await avail(userId);
    expect(after).toBeCloseTo(before - 40 + Number(res.payout), 6); // invariant across both reservations
    expect(after).toBeGreaterThanOrEqual(0);
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 60_000);

  it('BLACKJACK: duplicate start returns the same hand; wrong-user action rejected', async () => {
    const userId = await fundUser('200');
    const key = randomUUID();
    const a = await bridge.startBlackjack({ userId, stake: '10', currencyCode: 'INR', idempotencyKey: key });
    const b = await bridge.startBlackjack({ userId, stake: '10', currencyCode: 'INR', idempotencyKey: key });
    expect(b.roundId).toBe(a.roundId); // same hand, no second reservation
    const other = await fundUser('100');
    await expect(bridge.blackjackAction({ userId: other, roundId: a.roundId, action: 'HIT' })).rejects.toBeDefined();
  }, 30_000);

  it('BLACKJACK: concurrent STAND settles exactly once; action after settlement is idempotent', async () => {
    const userId = await fundUser('200');
    const before = await avail(userId);
    const start = await bridge.startBlackjack({ userId, stake: '10', currencyCode: 'INR', idempotencyKey: randomUUID() });
    const [x, y] = await Promise.allSettled([
      bridge.blackjackAction({ userId, roundId: start.roundId, action: 'STAND' }),
      bridge.blackjackAction({ userId, roundId: start.roundId, action: 'STAND' }),
    ]);
    const settled = [x, y].filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ payout: string }>[];
    expect(settled.length).toBeGreaterThanOrEqual(1);
    // Authoritative settled payout from the DB round: the actionSeq "loser" can return a transient
    // response, so assert against the durable round row, not a concurrent action's payload (Phase 2C.12).
    const payout = Number((await prisma.gameRound.findUnique({ where: { id: start.roundId } }))!.payout);
    const after = await avail(userId);
    expect(after).toBeCloseTo(before - 10 + payout, 6); // settled once, not twice
    // Another action after settlement is a no-op that returns the final state.
    const again = await bridge.blackjackAction({ userId, roundId: start.roundId, action: 'HIT' });
    expect(again.status).toBe('SETTLED');
    expect(await avail(userId)).toBeCloseTo(after, 6);
  }, 60_000);

  it('BLACKJACK: restart reconstruction — an active hand survives (state re-read deterministically)', async () => {
    const userId = await fundUser('200');
    const start = await bridge.startBlackjack({ userId, stake: '10', currencyCode: 'INR', idempotencyKey: randomUUID() });
    const hit = await bridge.blackjackAction({ userId, roundId: start.roundId, action: 'HIT' });
    // Simulate a restart: no in-memory state — re-read the hand purely from the DB + seed.
    const reread = await bridge.blackjackState(userId, start.roundId);
    if (hit.active) {
      expect(reread.active).toBe(true);
      expect(reread.player).toEqual(hit.player); // deterministic reconstruction, identical cards
      const done = await bridge.blackjackAction({ userId, roundId: start.roundId, action: 'STAND' });
      expect(done.status).toBe('SETTLED'); // can continue + settle after "restart"
    } else {
      expect(reread.status).toBe('SETTLED'); // busted on the hit → already settled, survives restart
    }
  }, 60_000);

  it('BLACKJACK: a pending-settlement DOUBLED hand recovers both reservations (invariant)', async () => {
    const userId = await fundUser('300');
    const before = await avail(userId);
    const start = await bridge.startBlackjack({ userId, stake: '20', currencyCode: 'INR', idempotencyKey: randomUUID() });
    // Real second reservation for the double (distinct reference, matching the bridge), then force PENDING_SETTLEMENT.
    const res2 = await wallet.reserve(userId, inrId, '20', `round:${start.roundId}:2`, `${start.roundId}:reserve2`);
    const round = await prisma.gameRound.findUnique({ where: { id: start.roundId } });
    const meta = round!.result as Record<string, unknown>;
    await prisma.gameRound.update({ where: { id: start.roundId }, data: { status: 'PENDING_SETTLEMENT', stake: '40', payout: '80', result: { ...meta, doubled: true, reservation2: res2.reservationId, extraReservations: [{ reservationId: res2.reservationId, win: '0', reference: `round:${start.roundId}:2`, idempotencyKey: `${start.roundId}:commit2` }] } as unknown as object } });
    expect(await recovery.recoverOne(start.roundId)).toBe('recovered');
    expect(await avail(userId)).toBe(before - 40 + 80); // both reservations committed, invariant holds
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 60_000);

  it('final reconcile is balanced (difference 0)', async () => {
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 30_000);
});
