import { randomUUID } from 'node:crypto';

import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { WalletTransactionService } from '../wallet-engine/services/wallet-transaction.service';
import { GameMoneyBridgeService } from './game-money-bridge.service';
import { GameMoneyHistoryService } from './game-money-history.service';

/**
 * Phase 2C.4 — history/traceability INTEGRATION against real Postgres + Redis (gated on
 * `RUN_DB_IT=1`). Creates genuine real-money rounds through the existing bridge, then verifies the
 * read-only history/traceability joins over the persisted records. Asserts ownership isolation,
 * admin assembly, wallet history (stored balances), pagination, date filters, that reading creates
 * NO new financial records, and that the ledger stays balanced.
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

d('GameMoney History + Traceability (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wallet: WalletEngineService;
  let bridge: GameMoneyBridgeService;
  let history: GameMoneyHistoryService;
  let txns: WalletTransactionService;
  let inrId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    wallet = app.get(WalletEngineService);
    bridge = app.get(GameMoneyBridgeService);
    history = app.get(GameMoneyHistoryService);
    txns = app.get(WalletTransactionService);
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
  async function playRound(userId: string, stake = '10') {
    return bridge.playDice({ userId, variant: 'sic-bo', betType: 'big', stake, currencyCode: 'INR', clientSeed: 'c', idempotencyKey: randomUUID() });
  }

  it('game history lists the caller rounds with netResult = payout − stake', async () => {
    const userId = await fundUser('500');
    const r = await playRound(userId, '10');
    const list = await history.listRounds(userId, { page: 1, limit: 20 });
    expect(list.total).toBeGreaterThanOrEqual(1);
    const item = list.items.find((i) => i.roundId === r.roundId)!;
    expect(item).toBeDefined();
    expect(item.stake).toBe('10');
    expect(item.netResult).toBe(String(Number(r.payout) - 10)); // consistent with stored stake/payout
  }, 60_000);

  it('round details assembles round → reservation → transactions → ledger from persisted links', async () => {
    const userId = await fundUser('500');
    const r = await playRound(userId, '10');
    const details = await history.roundDetails(userId, r.roundId);
    expect(details.round.id).toBe(r.roundId);
    expect(details.round.stake).toBe('10');
    expect(details.reservation).not.toBeNull(); // LockedFunds via reservationId
    expect(details.walletTransactions.length).toBeGreaterThanOrEqual(1); // RESERVE + settlement
    expect(details.settlement).not.toBeNull(); // betTransactionId txn
    expect(details.settlement!.balanceBefore).toBeTruthy();
    expect(details.settlement!.balanceAfter).toBeTruthy();
    expect(details.ledger.length).toBeGreaterThanOrEqual(1); // double-entry journal
    expect(details.ledger[0]!.entries.length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("enforces ownership — a player cannot read another player's round", async () => {
    const a = await fundUser('200');
    const b = await fundUser('200');
    const r = await playRound(a, '10');
    await expect(history.roundDetails(b, r.roundId)).rejects.toBeInstanceOf(ForbiddenException);
  }, 60_000);

  it('admin details include player + wallet + recovery state', async () => {
    const userId = await fundUser('200');
    const r = await playRound(userId, '10');
    const admin = await history.adminRoundDetails(r.roundId);
    expect(admin.player!.id).toBe(userId);
    expect(admin.wallet).not.toBeNull();
    expect(admin.recovery.status).toBeTruthy();
    expect(typeof admin.recovery.recoveryAttempts).toBe('number');
    expect(admin.ledger[0]?.entries[0]?.walletId).toBeTruthy(); // admin sees walletId
  }, 60_000);

  it('wallet history returns stored balanceBefore/After for the round transactions', async () => {
    const userId = await fundUser('500');
    const r = await playRound(userId, '10');
    const page = await txns.list(userId, { page: 1, limit: 50 });
    const roundTx = page.items.filter((t) => t.reference.startsWith(`round:${r.roundId}`));
    expect(roundTx.length).toBeGreaterThanOrEqual(1);
    for (const t of roundTx) {
      expect(t.balanceBefore).toBeTruthy();
      expect(t.balanceAfter).toBeTruthy();
      expect(t.currency).toBe('INR');
    }
  }, 60_000);

  it('date filters + pagination work; reading creates NO new financial records; ledger stays balanced', async () => {
    const userId = await fundUser('500');
    await playRound(userId, '10');
    const roundsBefore = await prisma.gameRound.count();
    const txBefore = await prisma.walletTransaction.count();
    const ledgerBefore = await prisma.ledgerEntry.count();

    // Future window → empty; wide past window → present.
    const future = await history.listRounds(userId, { from: '2999-01-01T00:00:00.000Z' });
    expect(future.total).toBe(0);
    const past = await history.listRounds(userId, { from: '2020-01-01T00:00:00.000Z', page: 1, limit: 1 });
    expect(past.total).toBeGreaterThanOrEqual(1);
    expect(past.items.length).toBe(1); // limit respected
    await txns.list(userId, { from: '2020-01-01T00:00:00.000Z', currency: 'INR' });

    // Read-only: counts unchanged.
    expect(await prisma.gameRound.count()).toBe(roundsBefore);
    expect(await prisma.walletTransaction.count()).toBe(txBefore);
    expect(await prisma.ledgerEntry.count()).toBe(ledgerBefore);
    expect(await ledgerBalanced(prisma)).toBe(true);
  }, 60_000);
});
