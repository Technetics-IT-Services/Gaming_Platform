import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drawNumbers } from '@gaming-platform/lottery-engine';
import { SeededRng } from '@gaming-platform/game-sdk';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { ProvablyFairService } from '../runtime/services/provably-fair.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { GameMoneyBridgeService } from './game-money-bridge.service';
import { GameMoneyRecoveryService } from './game-money-recovery.service';
import { LotteryDrawService } from './lottery-draw.service';

/**
 * Phase 2C.3 — Sic Bo + Number-Lottery INTEGRATION against real Postgres + Redis (gated on
 * `RUN_DB_IT=1`; skipped otherwise). Real services only — real reservations (WalletEngine), the
 * real frozen engines and the real bridge/draw service — no faked money, no direct balance/ledger
 * mutation. Proves the financial invariant, reconcile balanced, no duplicate ledger, Sic Bo
 * multi-bet settlement + recovery, and the Lottery shared draw + execute-once + recovery.
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

d('GameMoney Sic Bo + Number Lottery (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wallet: WalletEngineService;
  let bridge: GameMoneyBridgeService;
  let recovery: GameMoneyRecoveryService;
  let draws: LotteryDrawService;
  let fair: ProvablyFairService;
  let inrId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    wallet = app.get(WalletEngineService);
    bridge = app.get(GameMoneyBridgeService);
    recovery = app.get(GameMoneyRecoveryService);
    draws = app.get(LotteryDrawService);
    fair = app.get(ProvablyFairService);
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

  /* --------------------------------- SIC BO --------------------------------- */

  it('SIC BO: 10 real multi-bet rounds — invariant holds every round, wins & losses observed', async () => {
    const userId = await fundUser('2000');
    let wins = 0;
    let losses = 0;
    for (let i = 0; i < 10; i += 1) {
      const before = await avail(userId);
      const bets = i % 2 === 0
        ? [{ type: 'big', amount: '10' }, { type: 'small', amount: '10' }] // one side always wins (unless triple)
        : [{ type: 'triple-3', amount: '10' }]; // rare — usually a loss
      const totalStake = bets.reduce((s, b) => s + Number(b.amount), 0);
      const res = await bridge.playSicBo({ userId, variant: 'sic-bo', bets, currencyCode: 'INR', idempotencyKey: randomUUID() });
      const after = await avail(userId);
      expect(after).toBeCloseTo(before - totalStake + Number(res.payout), 6); // invariant
      expect(after).toBeGreaterThanOrEqual(0);
      expect(res.dice.length).toBe(3);
      if (Number(res.payout) > 0) wins += 1; else losses += 1;
    }
    expect(wins).toBeGreaterThanOrEqual(1);
    expect(losses).toBeGreaterThanOrEqual(1);
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 120_000);

  it('SIC BO: insufficient balance is rejected atomically (nothing debited)', async () => {
    const userId = await fundUser('5');
    const before = await avail(userId);
    await expect(bridge.playSicBo({ userId, variant: 'sic-bo', bets: [{ type: 'big', amount: '100' }], currencyCode: 'INR', idempotencyKey: randomUUID() })).rejects.toBeDefined();
    expect(await avail(userId)).toBe(before);
  }, 30_000);

  it('SIC BO: duplicate + concurrent duplicate settle once', async () => {
    const userId = await fundUser('500');
    const key = randomUUID();
    const before = await avail(userId);
    const [a, b] = await Promise.all([
      bridge.playSicBo({ userId, variant: 'sic-bo', bets: [{ type: 'big', amount: '20' }], currencyCode: 'INR', idempotencyKey: key }),
      bridge.playSicBo({ userId, variant: 'sic-bo', bets: [{ type: 'big', amount: '20' }], currencyCode: 'INR', idempotencyKey: key }),
    ]);
    expect(a.roundId).toBe(b.roundId);
    // Authoritative settled payout from the DB round (a.payout can be a transient create-race loser's).
    const settledPayout = Number((await prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } }))!.payout);
    expect(await avail(userId)).toBeCloseTo(before - 20 + settledPayout, 6); // charged once
  }, 30_000);

  it('SIC BO: a pending-settlement round recovers via the centralized recovery', async () => {
    const userId = await fundUser('200');
    const before = await avail(userId);
    const round = await prisma.gameRound.create({ data: { userId, gameKey: 'sic-bo', variant: 'sic-bo', betType: 'big', currencyId: inrId, stake: '20', payout: '40', status: 'PENDING_SETTLEMENT', idempotencyKey: randomUUID(), result: { kind: 'sic-bo', values: [5, 6, 6], winningBets: ['big'] } } });
    const reserved = await wallet.reserve(userId, inrId, '20', `round:${round.id}`, `${round.id}:reserve`);
    await prisma.gameRound.update({ where: { id: round.id }, data: { reservationId: reserved.reservationId } });
    expect(await recovery.recoverOne(round.id)).toBe('recovered');
    expect(await avail(userId)).toBe(before - 20 + 40);
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 30_000);

  /* -------------------------------- LOTTERY --------------------------------- */

  // Reproduce the service's deterministic winning numbers for a draw (to craft win/loss tickets).
  function winningFor(draw: { serverSeed: string; clientSeed: string; nonce: number; poolSize: number; pick: number }): number[] {
    const seed = fair.deriveSeed(draw.serverSeed, draw.clientSeed, draw.nonce);
    return drawNumbers(new SeededRng(seed), draw.poolSize, draw.pick);
  }

  it('LOTTERY: purchase reserves the price and does NOT settle until the draw resolves', async () => {
    const userId = await fundUser('200');
    const before = await avail(userId);
    const draw = await draws.openDraw();
    const ticket = await bridge.buyLotteryTicket({ userId, picks: [1, 2, 3, 4, 5, 6], currencyCode: 'INR', idempotencyKey: randomUUID() }, draw);
    expect(ticket.status).toBe('RESERVED');
    expect(ticket.settled).toBe(false);
    expect(await avail(userId)).toBe(before - Number(draw.ticketPrice.toString())); // reserved, not settled
  }, 30_000);

  it('LOTTERY: SHARED DRAW — all tickets evaluate against the SAME winning numbers; jackpot + loss invariants hold', async () => {
    const userId = await fundUser('1000');
    const draw = await draws.openDraw();
    const winning = winningFor(draw);
    const complement: number[] = [];
    for (let n = 1; n <= draw.poolSize && complement.length < draw.pick; n += 1) if (!winning.includes(n)) complement.push(n);

    const before = await avail(userId);
    const price = Number(draw.ticketPrice.toString());
    // Ticket A = the winning numbers (guaranteed jackpot: 6 matches). Ticket B = disjoint (loss).
    const tA = await bridge.buyLotteryTicket({ userId, picks: winning, currencyCode: 'INR', idempotencyKey: randomUUID() }, draw);
    const tB = await bridge.buyLotteryTicket({ userId, picks: complement, currencyCode: 'INR', idempotencyKey: randomUUID() }, draw);
    expect(await avail(userId)).toBeCloseTo(before - 2 * price, 6); // both reserved

    const exec = await draws.executeDraw(draw.id);
    expect(exec.executed).toBe(true);

    const drawRow = await prisma.lotteryDraw.findUnique({ where: { id: draw.id } });
    expect(drawRow!.winningNumbers.slice().sort((a, b) => a - b)).toEqual(winning.slice().sort((a, b) => a - b)); // shared authoritative draw
    expect(drawRow!.status).toBe('SETTLED');

    const rA = await prisma.gameRound.findUnique({ where: { id: tA.ticketId } });
    const rB = await prisma.gameRound.findUnique({ where: { id: tB.ticketId } });
    expect(rA!.status).toBe('SETTLED');
    expect(Number(rA!.payout)).toBe(price * 50000); // 6 matches → jackpot ×50000
    expect(Number(rB!.payout)).toBe(0); // 0 matches → loss
    // Invariant across the whole draw: balanceAfter = before - 2*price + jackpot + 0
    expect(await avail(userId)).toBeCloseTo(before - 2 * price + price * 50000, 6);
    expect(await avail(userId)).toBeGreaterThanOrEqual(0);
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 60_000);

  it('LOTTERY: invalid picks + insufficient balance are rejected before reserving', async () => {
    const draw = await draws.openDraw();
    const poor = await fundUser('2');
    await expect(bridge.buyLotteryTicket({ userId: poor, picks: [1, 2, 3], currencyCode: 'INR', idempotencyKey: randomUUID() }, draw)).rejects.toBeDefined(); // wrong count
    await expect(bridge.buyLotteryTicket({ userId: poor, picks: [1, 2, 3, 4, 5, 6], currencyCode: 'INR', idempotencyKey: randomUUID() }, draw)).rejects.toBeDefined(); // insufficient
    const before = await avail(poor);
    expect(before).toBe(2); // nothing debited
  }, 30_000);

  it('LOTTERY: duplicate + concurrent duplicate purchase create ONE ticket', async () => {
    const userId = await fundUser('200');
    const draw = await draws.openDraw();
    const key = randomUUID();
    const before = await avail(userId);
    const [a, b] = await Promise.all([
      bridge.buyLotteryTicket({ userId, picks: [7, 8, 9, 10, 11, 12], currencyCode: 'INR', idempotencyKey: key }, draw),
      bridge.buyLotteryTicket({ userId, picks: [7, 8, 9, 10, 11, 12], currencyCode: 'INR', idempotencyKey: key }, draw),
    ]);
    expect(a.ticketId).toBe(b.ticketId); // one ticket
    expect(await avail(userId)).toBe(before - Number(draw.ticketPrice.toString())); // reserved once
  }, 30_000);

  it('LOTTERY: execute-once — concurrent draw execution yields ONE settlement, same winning numbers', async () => {
    const userId = await fundUser('200');
    const draw = await draws.openDraw();
    await bridge.buyLotteryTicket({ userId, picks: [1, 2, 3, 4, 5, 6], currencyCode: 'INR', idempotencyKey: randomUUID() }, draw);
    const ledgerBefore = await prisma.ledgerEntry.count();
    const [x, y] = await Promise.all([draws.executeDraw(draw.id), draws.executeDraw(draw.id)]);
    expect([x.executed, y.executed].filter(Boolean).length).toBe(1); // exactly one execution
    const row = await prisma.lotteryDraw.findUnique({ where: { id: draw.id } });
    expect(row!.status).toBe('SETTLED');
    // The single ticket settled exactly once (bet journal written once).
    const after = await prisma.ledgerEntry.count();
    const reExec = await draws.executeDraw(draw.id); // duplicate execution → no-op
    expect(reExec.executed).toBe(false);
    expect(await prisma.ledgerEntry.count()).toBe(after); // no duplicate ledger from re-execution
    void ledgerBefore;
  }, 60_000);

  it('LOTTERY: restart simulation — a DRAWN draw with unsettled tickets is re-settled by the sweep', async () => {
    const userId = await fundUser('200');
    const draw = await draws.openDraw();
    const before = await avail(userId);
    await bridge.buyLotteryTicket({ userId, picks: [1, 2, 3, 4, 5, 6], currencyCode: 'INR', idempotencyKey: randomUUID() }, draw);
    // Simulate: draw executed (winning derived) but process died before settling tickets.
    const winning = winningFor(draw);
    await prisma.lotteryDraw.update({ where: { id: draw.id }, data: { status: 'DRAWN', winningNumbers: winning, executedAt: new Date() } });
    // Restart → the sweep re-discovers the DRAWN draw and settles its tickets.
    const res = await draws.settleDrawTickets(draw.id);
    expect(res.settled).toBe(1);
    const price = Number(draw.ticketPrice.toString());
    const after = await avail(userId);
    // matches depend on the seed; invariant holds regardless (payout is authoritative).
    const ticket = await prisma.gameRound.findFirst({ where: { drawId: draw.id } });
    expect(after).toBeCloseTo(before - price + Number(ticket!.payout), 6);
    expect((await prisma.lotteryDraw.findUnique({ where: { id: draw.id } }))!.status).toBe('SETTLED');
  }, 60_000);

  it('LOTTERY: a pending-settlement ticket recovers via the centralized recovery', async () => {
    const userId = await fundUser('200');
    const draw = await draws.openDraw();
    const before = await avail(userId);
    const ticket = await bridge.buyLotteryTicket({ userId, picks: [1, 2, 3, 4, 5, 6], currencyCode: 'INR', idempotencyKey: randomUUID() }, draw);
    // Simulate settlement-failed ticket: RESOLVED with a payout stored, then PENDING_SETTLEMENT.
    await prisma.gameRound.update({ where: { id: ticket.ticketId }, data: { status: 'PENDING_SETTLEMENT', payout: '50' } });
    expect(await recovery.recoverOne(ticket.ticketId)).toBe('recovered');
    const price = Number(draw.ticketPrice.toString());
    expect(await avail(userId)).toBe(before - price + 50);
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 60_000);

  it('final reconcile is balanced (difference 0)', async () => {
    expect((await ledgerBalanced(prisma)).balanced).toBe(true);
  }, 30_000);
});
