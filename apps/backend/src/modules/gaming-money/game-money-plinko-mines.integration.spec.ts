import { randomUUID } from 'node:crypto';

import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { GameMoneyBridgeService } from './game-money-bridge.service';
import { GameMoneyRecoveryService } from './game-money-recovery.service';
import { mineBoard } from './engines/mines-engine';

/**
 * Phase 2C.6 — Plinko + Mines INTEGRATION against real Postgres + Redis (gated on `RUN_DB_IT=1`).
 * Real services only — real reservations, the real ported engines, the real bridge — no faked money.
 * Proves the financial invariant, reconcile balanced, no duplicate ledger, Plinko settlement +
 * recovery, and the interactive Mines lifecycle (safe reveal / mine-hit / cashout), concurrency,
 * restart reconstruction, and recovery.
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

d('GameMoney Plinko + Mines (integration)', () => {
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

  /* --------------------------------- PLINKO --------------------------------- */

  it('PLINKO: 10 real drops — invariant holds every drop, reconcile balanced, wins & losses seen', async () => {
    const userId = await fundUser('2000');
    let wins = 0;
    let losses = 0;
    for (let i = 0; i < 10; i += 1) {
      const before = await avail(userId);
      const risk = i % 2 === 0 ? 'high' : 'low';
      const res = await bridge.playPlinko({ userId, rows: 16, risk, stake: '10', currencyCode: 'INR', idempotencyKey: randomUUID() });
      const after = await avail(userId);
      expect(after).toBeCloseTo(before - 10 + Number(res.payout), 6); // invariant
      expect(after).toBeGreaterThanOrEqual(0);
      expect(res.table.length).toBe(17);
      if (Number(res.payout) > 10) wins += 1; else losses += 1;
    }
    expect(wins).toBeGreaterThanOrEqual(1);
    expect(losses).toBeGreaterThanOrEqual(1);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 120_000);

  it('PLINKO: insufficient rejected; duplicate request settles once', async () => {
    const poor = await fundUser('5');
    const pb = await avail(poor);
    await expect(bridge.playPlinko({ userId: poor, rows: 8, risk: 'low', stake: '100', currencyCode: 'INR', idempotencyKey: randomUUID() })).rejects.toBeDefined();
    expect(await avail(poor)).toBe(pb);

    const userId = await fundUser('200');
    const key = randomUUID();
    const before = await avail(userId);
    const a = await bridge.playPlinko({ userId, rows: 12, risk: 'medium', stake: '10', currencyCode: 'INR', idempotencyKey: key });
    const b = await bridge.playPlinko({ userId, rows: 12, risk: 'medium', stake: '10', currencyCode: 'INR', idempotencyKey: key });
    expect(b.roundId).toBe(a.roundId);
    expect(b.replayed).toBe(true);
    expect(await avail(userId)).toBeCloseTo(before - 10 + Number(a.payout), 6);
  }, 60_000);

  it('PLINKO: a pending-settlement drop recovers via the centralized recovery', async () => {
    const userId = await fundUser('200');
    const before = await avail(userId);
    const round = await prisma.gameRound.create({ data: { userId, gameKey: 'plinko', variant: 'plinko-pro', betType: '16:medium', currencyId: inrId, stake: '10', payout: '25', status: 'PENDING_SETTLEMENT', idempotencyKey: randomUUID(), result: { kind: 'plinko', bin: 3 } } });
    const reserved = await wallet.reserve(userId, inrId, '10', `round:${round.id}`, `${round.id}:reserve`);
    await prisma.gameRound.update({ where: { id: round.id }, data: { reservationId: reserved.reservationId } });
    expect(await recovery.recoverOne(round.id)).toBe('recovered');
    expect(await avail(userId)).toBe(before - 10 + 25);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);

  /* ---------------------------------- MINES --------------------------------- */

  it('MINES: 5 sessions — safe reveals + cashout (win) and mine-hit (loss); invariant holds', async () => {
    const userId = await fundUser('2000');
    let wins = 0;
    let losses = 0;
    for (let i = 0; i < 5; i += 1) {
      const before = await avail(userId);
      const start = await bridge.startMines({ userId, stake: '20', mines: 3, currencyCode: 'INR', idempotencyKey: randomUUID() });
      // Read the authoritative seed and compute the board to drive a deterministic win/loss.
      const row = await prisma.gameRound.findUnique({ where: { id: start.roundId } });
      const meta = row!.result as { seed: string; tiles: number; mines: number };
      const board = mineBoard(meta.tiles, meta.mines, meta.seed);
      const safe = [...Array(meta.tiles).keys()].filter((t) => !board.includes(t));

      let state = start;
      if (i % 2 === 0) {
        // WIN: reveal two safe tiles then cash out.
        state = await bridge.minesReveal({ userId, roundId: start.roundId, index: safe[0]! });
        expect(state.active).toBe(true);
        state = await bridge.minesReveal({ userId, roundId: start.roundId, index: safe[1]! });
        state = await bridge.minesCashout({ userId, roundId: start.roundId });
        expect(state.won).toBe(true);
        wins += 1;
      } else {
        // LOSS: reveal a mine.
        state = await bridge.minesReveal({ userId, roundId: start.roundId, index: board[0]! });
        expect(state.won).toBe(false);
        expect(Number(state.payout)).toBe(0);
        losses += 1;
      }
      const after = await avail(userId);
      expect(state.status).toBe('SETTLED');
      expect(after).toBeCloseTo(before - 20 + Number(state.payout), 6); // invariant
      expect(after).toBeGreaterThanOrEqual(0);
      expect(state.board).not.toBeNull(); // board revealed on settle
    }
    expect(wins).toBeGreaterThanOrEqual(1);
    expect(losses).toBeGreaterThanOrEqual(1);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 120_000);

  it('MINES: duplicate/concurrent reveal advances the board exactly once', async () => {
    const userId = await fundUser('200');
    const start = await bridge.startMines({ userId, stake: '10', mines: 3, currencyCode: 'INR', idempotencyKey: randomUUID() });
    const row = await prisma.gameRound.findUnique({ where: { id: start.roundId } });
    const meta = row!.result as { seed: string; tiles: number; mines: number };
    const safe = [...Array(meta.tiles).keys()].filter((t) => !mineBoard(meta.tiles, meta.mines, meta.seed).includes(t));
    // Two concurrent reveals of the SAME safe tile → exactly one advances (actionSeq guard).
    const [a, b] = await Promise.allSettled([
      bridge.minesReveal({ userId, roundId: start.roundId, index: safe[0]! }),
      bridge.minesReveal({ userId, roundId: start.roundId, index: safe[0]! }),
    ]);
    expect([a, b].filter((r) => r.status === 'fulfilled').length).toBe(2); // both resolve (one advances, one replays)
    const state = await bridge.minesState(userId, start.roundId);
    expect(state.revealed).toEqual([safe[0]]); // revealed exactly once
    expect(row!.result).toBeTruthy();
  }, 60_000);

  it('MINES: wrong-user rejected; restart reconstruction keeps the active hand', async () => {
    const userId = await fundUser('200');
    const start = await bridge.startMines({ userId, stake: '10', mines: 5, currencyCode: 'INR', idempotencyKey: randomUUID() });
    const other = await fundUser('100');
    await expect(bridge.minesReveal({ userId: other, roundId: start.roundId, index: 0 })).rejects.toBeInstanceOf(ForbiddenException);
    const row = await prisma.gameRound.findUnique({ where: { id: start.roundId } });
    const meta = row!.result as { seed: string; tiles: number; mines: number };
    const safe = [...Array(meta.tiles).keys()].filter((t) => !mineBoard(meta.tiles, meta.mines, meta.seed).includes(t));
    await bridge.minesReveal({ userId, roundId: start.roundId, index: safe[0]! });
    // Simulate restart: no in-memory state — re-read purely from DB + seed.
    const reread = await bridge.minesState(userId, start.roundId);
    expect(reread.active).toBe(true);
    expect(reread.revealed).toEqual([safe[0]]);
    const done = await bridge.minesCashout({ userId, roundId: start.roundId });
    expect(done.status).toBe('SETTLED'); // can continue + settle after "restart"
  }, 60_000);

  it('MINES: a pending-settlement round recovers via the centralized recovery', async () => {
    const userId = await fundUser('200');
    const before = await avail(userId);
    const start = await bridge.startMines({ userId, stake: '20', mines: 3, currencyCode: 'INR', idempotencyKey: randomUUID() });
    await prisma.gameRound.update({ where: { id: start.roundId }, data: { status: 'PENDING_SETTLEMENT', payout: '40' } });
    expect(await recovery.recoverOne(start.roundId)).toBe('recovered');
    expect(await avail(userId)).toBe(before - 20 + 40);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 60_000);

  it('final reconcile is balanced', async () => {
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 30_000);
});
