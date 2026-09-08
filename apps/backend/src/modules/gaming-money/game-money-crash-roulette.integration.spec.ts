import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { GameMoneyBridgeService } from './game-money-bridge.service';
import { GameMoneyRecoveryService } from './game-money-recovery.service';

/**
 * Phase 2C.2 — Crash + Roulette INTEGRATION against a real Postgres + Redis (gated on
 * `RUN_DB_IT=1`; skipped otherwise). Real services only — real reservations (WalletEngine),
 * the real frozen engines and the real bridge — no faked money, no direct balance/ledger
 * mutation. Proves the financial invariant, reconcile balanced, no duplicate ledger, crash
 * cashout/loss, idempotency, concurrent single-settlement and centralized recovery.
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

d('GameMoney Crash + Roulette (integration)', () => {
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

  /* --------------------------------- CRASH ---------------------------------- */

  it('CRASH: 10 real rounds — cashout WIN + crash LOSS, invariant holds every round', async () => {
    const userId = await fundUser('1000');
    let wins = 0;
    let losses = 0;
    for (let i = 0; i < 10; i += 1) {
      const before = await avail(userId);
      const stake = 10;
      const play = await bridge.playCrash({ userId, variant: 'crash', stake: String(stake), currencyCode: 'INR', idempotencyKey: randomUUID() });
      expect(play.running).toBe(true);
      expect(play.crashPoint).toBeNull(); // hidden while running

      // Read the (server-only) crash meta to drive a deterministic win/loss via elapsed time.
      const round = await prisma.gameRound.findUnique({ where: { id: play.roundId } });
      const meta = round!.result as unknown as { crashPoint: number; growthRatePerSecond: number; startedAtMs: number };
      const rate = meta.growthRatePerSecond;

      const wantWin = i % 2 === 0 && meta.crashPoint > 1.3;
      let elapsedMs: number;
      if (wantWin) {
        const target = Math.min(meta.crashPoint - 0.05, 2);
        elapsedMs = (Math.log(target) / rate) * 1000 - 40; // safely before the bust
      } else {
        const crashTime = (Math.log(meta.crashPoint) / rate) * 1000;
        elapsedMs = crashTime + 2000; // safely after the bust → loss
      }
      // Simulate elapsed time by back-dating the round start (server recomputes the multiplier).
      await prisma.gameRound.update({ where: { id: play.roundId }, data: { result: { ...meta, startedAtMs: Date.now() - Math.max(0, elapsedMs) } as unknown as object } });

      const settled = await bridge.cashoutCrash({ userId, roundId: play.roundId, idempotencyKey: randomUUID() });
      const after = await avail(userId);
      // Invariant: balanceAfter = balanceBefore - stake + payout  (payout is authoritative).
      expect(after).toBeCloseTo(before - stake + Number(settled.payout), 6);
      expect(after).toBeGreaterThanOrEqual(0);
      expect(settled.crashPoint).not.toBeNull(); // revealed after settlement
      if (settled.won) wins += 1; else losses += 1;
    }
    expect(wins).toBeGreaterThanOrEqual(1);
    expect(losses).toBeGreaterThanOrEqual(1);
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 120_000);

  it('CRASH: double cash-out is idempotent (no second settlement, no dup ledger)', async () => {
    const userId = await fundUser('200');
    const play = await bridge.playCrash({ userId, variant: 'crash', stake: '20', currencyCode: 'INR', idempotencyKey: randomUUID() });
    const first = await bridge.cashoutCrash({ userId, roundId: play.roundId, idempotencyKey: randomUUID() });
    const ledgerAfterFirst = await prisma.ledgerEntry.count();
    const balAfterFirst = await avail(userId);
    const second = await bridge.cashoutCrash({ userId, roundId: play.roundId, idempotencyKey: randomUUID() });
    expect(second.payout).toBe(first.payout);
    expect(await avail(userId)).toBe(balAfterFirst); // no second credit/debit
    expect(await prisma.ledgerEntry.count()).toBe(ledgerAfterFirst); // no duplicate ledger rows
  }, 60_000);

  it('CRASH: concurrent cash-out settles exactly once', async () => {
    const userId = await fundUser('200');
    const before = await avail(userId); // measured BEFORE the round (pre-reservation)
    const play = await bridge.playCrash({ userId, variant: 'crash', stake: '20', currencyCode: 'INR', idempotencyKey: randomUUID() });
    const [a, b] = await Promise.all([
      bridge.cashoutCrash({ userId, roundId: play.roundId, idempotencyKey: randomUUID() }),
      bridge.cashoutCrash({ userId, roundId: play.roundId, idempotencyKey: randomUUID() }),
    ]);
    expect(a.payout).toBe(b.payout); // same authoritative outcome
    const after = await avail(userId);
    expect(after).toBeCloseTo(before - 20 + Number(a.payout), 6); // settled once, not twice
    const status = (await prisma.gameRound.findUnique({ where: { id: play.roundId } }))!.status;
    expect(['SETTLED', 'RECOVERED']).toContain(status);
  }, 60_000);

  it('CRASH: an abandoned (busted) round is finalized as a loss by the recovery sweep', async () => {
    const userId = await fundUser('200');
    const before = await avail(userId);
    const play = await bridge.playCrash({ userId, variant: 'crash', stake: '20', currencyCode: 'INR', idempotencyKey: randomUUID() });
    const round = await prisma.gameRound.findUnique({ where: { id: play.roundId } });
    const meta = round!.result as unknown as { crashPoint: number; growthRatePerSecond: number; crashTimeMs: number };
    // Back-date so the curve has already busted well beyond the grace window.
    await prisma.gameRound.update({ where: { id: play.roundId }, data: { result: { ...meta, startedAtMs: Date.now() - (meta.crashTimeMs + 60_000) } as unknown as object } });
    const res = await recovery.finalizeExpiredCrash();
    expect(res.finalized).toBeGreaterThanOrEqual(1);
    const settled = await prisma.gameRound.findUnique({ where: { id: play.roundId } });
    expect(settled!.status).toBe('SETTLED');
    expect(Number(settled!.payout)).toBe(0); // abandoned → loss
    expect(await avail(userId)).toBe(before - 20);
  }, 60_000);

  it('CRASH: a pending-settlement cashout recovers via the centralized bridge recovery', async () => {
    const userId = await fundUser('200');
    const before = await avail(userId);
    const play = await bridge.playCrash({ userId, variant: 'crash', stake: '20', currencyCode: 'INR', idempotencyKey: randomUUID() });
    // Simulate: cashout resolved a payout, but the commit failed → PENDING_SETTLEMENT with payout stored.
    const round = await prisma.gameRound.findUnique({ where: { id: play.roundId } });
    const meta = round!.result as unknown as Record<string, unknown>;
    await prisma.gameRound.update({ where: { id: play.roundId }, data: { status: 'PENDING_SETTLEMENT', payout: '30', result: { ...meta, settled: { cashedOutAt: 1.5, won: true, payout: '30', reason: 'cashout', crashPoint: (meta as { crashPoint: number }).crashPoint } } as unknown as object } });
    expect(await recovery.recoverOne(play.roundId)).toBe('recovered');
    expect(await avail(userId)).toBe(before - 20 + 30); // invariant via recovery
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 60_000);

  /* -------------------------------- ROULETTE -------------------------------- */

  it('ROULETTE: 20 real spins (single + multi bets) — invariant holds, wins & losses observed', async () => {
    const userId = await fundUser('5000');
    let wins = 0;
    let losses = 0;
    for (let i = 0; i < 20; i += 1) {
      const before = await avail(userId);
      const multi = i % 3 === 0;
      const bets = multi
        ? [{ type: 'red', amount: '10' }, { type: 'even', amount: '10' }, { type: 'straight', amount: '5', selection: [i % 37] }]
        : [{ type: 'red', amount: '10' }];
      const totalStake = bets.reduce((s, b) => s + Number(b.amount), 0);
      const res = await bridge.playRoulette({ userId, variant: 'european', bets, currencyCode: 'INR', idempotencyKey: randomUUID() });
      const after = await avail(userId);
      expect(after).toBeCloseTo(before - totalStake + Number(res.payout), 6); // invariant
      expect(after).toBeGreaterThanOrEqual(0);
      if (Number(res.payout) > 0) wins += 1; else losses += 1;
    }
    expect(wins).toBeGreaterThanOrEqual(1);
    expect(losses).toBeGreaterThanOrEqual(1);
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 120_000);

  it('ROULETTE: a cover-all-numbers spin is a guaranteed win (exactly one straight hits ×36)', async () => {
    const userId = await fundUser('200');
    const before = await avail(userId);
    const bets = Array.from({ length: 37 }, (_, n) => ({ type: 'straight', amount: '1', selection: [n] }));
    const res = await bridge.playRoulette({ userId, variant: 'european', bets, currencyCode: 'INR', idempotencyKey: randomUUID() });
    expect(Number(res.payout)).toBe(36); // one number wins, payout 36×1
    expect(await avail(userId)).toBeCloseTo(before - 37 + 36, 6);
  }, 60_000);

  it('ROULETTE: duplicate request (same idempotency key) does not double-charge', async () => {
    const userId = await fundUser('200');
    const key = randomUUID();
    const first = await bridge.playRoulette({ userId, variant: 'european', bets: [{ type: 'red', amount: '10' }], currencyCode: 'INR', idempotencyKey: key });
    const balAfterFirst = await avail(userId);
    const ledgerAfterFirst = await prisma.ledgerEntry.count();
    const second = await bridge.playRoulette({ userId, variant: 'european', bets: [{ type: 'red', amount: '10' }], currencyCode: 'INR', idempotencyKey: key });
    expect(second.roundId).toBe(first.roundId);
    expect(second.replayed).toBe(true);
    expect(await avail(userId)).toBe(balAfterFirst);
    expect(await prisma.ledgerEntry.count()).toBe(ledgerAfterFirst);
  }, 60_000);

  it('ROULETTE: concurrent duplicate requests create ONE round + ONE settlement', async () => {
    const userId = await fundUser('200');
    const key = randomUUID();
    const before = await avail(userId);
    const [a, b] = await Promise.all([
      bridge.playRoulette({ userId, variant: 'european', bets: [{ type: 'red', amount: '10' }], currencyCode: 'INR', idempotencyKey: key }),
      bridge.playRoulette({ userId, variant: 'european', bets: [{ type: 'red', amount: '10' }], currencyCode: 'INR', idempotencyKey: key }),
    ]);
    expect(a.roundId).toBe(b.roundId); // one round
    const after = await avail(userId);
    // Assert against the AUTHORITATIVE settled round payout, not a transient Promise.all branch: under
    // the create-race, the P2002 "loser" returns the round in its pre-settlement state, so a.payout can
    // be stale. The DB round row is the single source of truth (Phase 2C.12).
    const settledPayout = Number((await prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } }))!.payout);
    expect(after).toBeCloseTo(before - 10 + settledPayout, 6); // charged once
  }, 60_000);

  it('ROULETTE: a pending-settlement spin recovers via the centralized bridge recovery', async () => {
    const userId = await fundUser('200');
    const before = await avail(userId);
    // Build a real reserved round then mark it PENDING_SETTLEMENT with a payout (commit-failed).
    const round = await prisma.gameRound.create({ data: { userId, gameKey: 'roulette', variant: 'european', betType: 'red', currencyId: inrId, stake: '10', payout: '20', status: 'PENDING_SETTLEMENT', idempotencyKey: randomUUID(), result: { kind: 'roulette', pocket: 3, color: 'red', winningBets: ['red'], settlement: { bets: [], totalBet: '10', totalWin: '20', net: '10' } } } });
    const reserved = await wallet.reserve(userId, inrId, '10', `round:${round.id}`, `${round.id}:reserve`);
    await prisma.gameRound.update({ where: { id: round.id }, data: { reservationId: reserved.reservationId } });
    expect(await recovery.recoverOne(round.id)).toBe('recovered');
    expect(await avail(userId)).toBe(before - 10 + 20);
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 60_000);

  it('final reconcile is balanced (difference 0)', async () => {
    const rec = await ledgerBalanced(prisma);
    expect(rec.balanced).toBe(true);
  }, 30_000);
});
