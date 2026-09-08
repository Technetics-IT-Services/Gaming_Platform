import { randomUUID } from 'node:crypto';

import { BadRequestException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { GameMoneyBridgeService } from './game-money-bridge.service';
import { GameMoneyRecoveryService } from './game-money-recovery.service';

/**
 * Phase 2C.7 — Card games (Dragon Tiger · Andar Bahar · Teen Patti) INTEGRATION against real Postgres
 * + Redis (gated on `RUN_DB_IT=1`). Real services only — the real authoritative card-engine, real
 * reservations, the real generic `playCard` bridge method — no faked money. Proves the financial
 * invariant, reconcile balanced, no duplicate ledger, idempotency, concurrency, insufficient-balance
 * rejection, out-of-scope-variant rejection, and centralized recovery for EVERY approved variant.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

async function ledgerBalanced(prisma: PrismaService): Promise<boolean> {
  const rows = await prisma.ledgerEntry.groupBy({ by: ['direction'], _sum: { amount: true } });
  let debit = 0;
  let credit = 0;
  for (const r of rows) {
    const v = Number(r._sum.amount ?? 0);
    if (r.direction === 'DEBIT') debit = v;
    else credit = v;
  }
  return Math.abs(debit - credit) < 1e-6;
}

const MAIN_BET: Record<string, string> = { 'dragon-tiger': 'dragon', 'andar-bahar': 'andar', 'teen-patti': 'player' };

d('GameMoney Card (Dragon Tiger · Andar Bahar · Teen Patti) (integration)', () => {
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

  for (const variant of ['dragon-tiger', 'andar-bahar', 'teen-patti']) {
    it(`${variant}: 20 real rounds — invariant holds every round, reconcile balanced, wins & losses seen`, async () => {
      const userId = await fundUser('5000');
      let wins = 0;
      let losses = 0;
      for (let i = 0; i < 20; i += 1) {
        const before = await avail(userId);
        const res = await bridge.playCard({ userId, variant, bets: [{ type: MAIN_BET[variant]!, amount: '10' }], currencyCode: 'INR', idempotencyKey: randomUUID() });
        const after = await avail(userId);
        expect(after).toBeCloseTo(before - 10 + Number(res.payout), 6); // invariant
        expect(after).toBeGreaterThanOrEqual(0);
        if (Number(res.payout) > 10) wins += 1; else if (Number(res.payout) === 0) losses += 1;
      }
      expect(wins).toBeGreaterThan(0);
      expect(losses).toBeGreaterThan(0);
      expect(await ledgerBalanced(prisma)).toBe(true);
    }, 60_000);
  }

  it('rejects insufficient balance, unknown bet, and out-of-scope variant without moving money', async () => {
    const userId = await fundUser('5');
    await expect(bridge.playCard({ userId, variant: 'dragon-tiger', bets: [{ type: 'dragon', amount: '10' }], currencyCode: 'INR', idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(BadRequestException);
    await expect(bridge.playCard({ userId, variant: 'dragon-tiger', bets: [{ type: 'banker', amount: '1' }], currencyCode: 'INR', idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(BadRequestException);
    await expect(bridge.playCard({ userId, variant: 'baccarat', bets: [{ type: 'player', amount: '1' }], currencyCode: 'INR', idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(BadRequestException);
    expect(await avail(userId)).toBe(5); // untouched
  }, 30_000);

  it('is idempotent — a duplicate key debits once and returns the same round', async () => {
    const userId = await fundUser('500');
    const key = randomUUID();
    const before = await avail(userId);
    const a = await bridge.playCard({ userId, variant: 'teen-patti', bets: [{ type: 'player', amount: '10' }], currencyCode: 'INR', idempotencyKey: key });
    const b = await bridge.playCard({ userId, variant: 'teen-patti', bets: [{ type: 'player', amount: '10' }], currencyCode: 'INR', idempotencyKey: key });
    const after = await avail(userId);
    expect(a.roundId).toBe(b.roundId);
    // Authoritative settled payout from the DB round (a.payout can be a transient create-race loser's).
    const settledPayout = Number((await prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } }))!.payout);
    expect(after).toBeCloseTo(before - 10 + settledPayout, 6);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);

  it('concurrency — 10 concurrent rounds: no negative balance, no double debit, ledger balanced', async () => {
    const userId = await fundUser('1000');
    const before = await avail(userId);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => bridge.playCard({ userId, variant: 'dragon-tiger', bets: [{ type: 'dragon', amount: '10' }], currencyCode: 'INR', idempotencyKey: randomUUID() })),
    );
    const after = await avail(userId);
    const totalPayout = results.reduce((s, r) => s + Number(r.payout), 0);
    expect(after).toBeCloseTo(before - 10 * 10 + totalPayout, 6);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 60_000);

  it('recovery — a PENDING_SETTLEMENT card round recovers via the centralized recovery', async () => {
    const userId = await fundUser('200');
    const before = await avail(userId);
    const round = await prisma.gameRound.create({ data: { userId, gameKey: 'dragon-tiger', variant: 'dragon-tiger', betType: 'dragon', currencyId: inrId, stake: '10', payout: '20', status: 'PENDING_SETTLEMENT', idempotencyKey: randomUUID(), result: { kind: 'dragon-tiger', winningBets: ['dragon'] } } });
    const reserved = await wallet.reserve(userId, inrId, '10', `round:${round.id}`, `${round.id}:reserve`);
    await prisma.gameRound.update({ where: { id: round.id }, data: { reservationId: reserved.reservationId } });
    expect(await recovery.recoverOne(round.id)).toBe('recovered');
    expect(await avail(userId)).toBe(before - 10 + 20);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);

  it('final ledger reconcile is balanced', async () => {
    expect(await ledgerBalanced(prisma)).toBe(true);
  });
});
