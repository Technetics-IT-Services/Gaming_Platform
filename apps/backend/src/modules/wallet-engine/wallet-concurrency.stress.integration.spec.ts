import { randomUUID } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { WalletEngineService } from './services/wallet-engine.service';
import { GameMoneyBridgeService } from '../gaming-money/game-money-bridge.service';
import { GameMoneyRecoveryService } from '../gaming-money/game-money-recovery.service';

/**
 * Phase 2C.12 — financial concurrency STRESS harness (gated on `RUN_STRESS=1`). Uses the REAL
 * WalletEngine + GameMoneyBridge + Postgres + Redis — NO mocks on the financial path. Its job is to
 * PROVE or DISPROVE a duplicate-financial-effect under concurrency. Every scenario asserts:
 *   - the wallet invariant (balance reflects exactly the applied effects),
 *   - ledger debit === credit,
 *   - no negative balance,
 *   - EXACTLY ONE financial effect per idempotency key / reference / reservation.
 * Run alone against a fresh DB so results are attributable (not cross-suite contention).
 */
const RUN = process.env.RUN_STRESS === '1';
const d = RUN ? describe : describe.skip;

d('WalletEngine concurrency stress', () => {
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

  afterAll(async () => { await app?.close(); });

  const fund = async (amount: string) => {
    const u = await prisma.user.create({ data: { email: `st_${randomUUID()}@t.local`, username: ('st' + randomUUID().replace(/-/g, '')).slice(0, 16), status: 'ACTIVE', authProvider: 'LOCAL' } });
    await wallet.credit(u.id, inrId, { amount, typeCode: 'DEPOSIT', description: 'fund', idempotencyKey: randomUUID() });
    return u.id;
  };
  const avail = async (userId: string) => Number((await wallet.getOrCreateWallet(userId, inrId)).available);
  const settled = async (result: PromiseSettledResult<unknown>[]) => result.filter((r) => r.status === 'fulfilled').length;
  async function ledgerBalanced(): Promise<{ debit: number; credit: number; balanced: boolean }> {
    const rows = await prisma.ledgerEntry.groupBy({ by: ['direction'], _sum: { amount: true } });
    let debit = 0, credit = 0;
    for (const r of rows) { const v = Number(r._sum.amount ?? 0); if (r.direction === 'DEBIT') debit = v; else credit = v; }
    return { debit, credit, balanced: Math.abs(debit - credit) < 1e-6 };
  }
  const txnCount = async (idempotencyKey: string) => prisma.walletTransaction.count({ where: { idempotencyKey } });

  // ---- S1: N concurrent IDENTICAL credit (same key) → exactly ONE effect ----
  for (const N of [2, 10, 50, 100]) {
    it(`S1(${N}): ${N} concurrent same-key credits apply EXACTLY once`, async () => {
      const userId = await fund('1000');
      const b0 = await avail(userId);
      const key = randomUUID();
      await Promise.allSettled(Array.from({ length: N }, () => wallet.credit(userId, inrId, { amount: '25', typeCode: 'DEPOSIT', idempotencyKey: key })));
      expect(await txnCount(key)).toBe(1);            // one financial effect
      expect(await avail(userId)).toBeCloseTo(b0 + 25, 6); // credited once, not N times
    }, 120_000);
  }

  // ---- S2: N concurrent DISTINCT-key debits on one wallet → exact, no loss, no negative ----
  it('S2: 100 concurrent distinct-key debits — exact sum, no negative, ledger balanced', async () => {
    const userId = await fund('100000');
    const b0 = await avail(userId);
    const res = await Promise.allSettled(Array.from({ length: 100 }, () => wallet.debit(userId, inrId, { amount: '10', typeCode: 'WITHDRAWAL', idempotencyKey: randomUUID() })));
    const ok = await settled(res);
    const after = await avail(userId);
    expect(after).toBeCloseTo(b0 - 10 * ok, 6);   // exactly the successful debits, no double
    expect(after).toBeGreaterThanOrEqual(0);
    expect((await ledgerBalanced()).balanced).toBe(true);
  }, 120_000);

  // ---- S3: N concurrent commitReservation on ONE reservation → exactly ONE settlement ----
  // (commitReservation has NO Redis lock — the prime suspect. Guarded by LOCKED status + UNIQUE refs.)
  for (const N of [2, 10, 50]) {
    it(`S3(${N}): ${N} concurrent commits of ONE reservation settle EXACTLY once`, async () => {
      const userId = await fund('1000');
      const b0 = await avail(userId);
      const reserved = await wallet.reserve(userId, inrId, '10', `stressres-${randomUUID()}`, randomUUID());
      const ref = `round:stress-${randomUUID()}`;
      const res = await Promise.allSettled(Array.from({ length: N }, () => wallet.commitReservation(reserved.reservationId, '20', ref, `${ref}:commit`)));
      // exactly one bet txn + one win txn for this ref, regardless of how many concurrent commits ran
      const betTxns = await prisma.walletTransaction.count({ where: { reference: `${ref}:bet` } });
      const winTxns = await prisma.walletTransaction.count({ where: { reference: `${ref}:win` } });
      expect(betTxns).toBe(1);
      expect(winTxns).toBe(1);
      expect(await avail(userId)).toBeCloseTo(b0 - 10 + 20, 6); // − stake + payout, ONCE
      expect((await ledgerBalanced()).balanced).toBe(true);
      expect(await settled(res)).toBeGreaterThanOrEqual(1);
    }, 120_000);
  }

  // ---- S4: the EXACT bridge concurrent-duplicate scenario, repeated ×K ----
  it('S4: 60× (2 concurrent same-key plays) → always ONE round, ONE settlement, invariant holds', async () => {
    let breaks = 0;
    for (let i = 0; i < 60; i += 1) {
      const userId = await fund('500');
      const b0 = await avail(userId);
      const key = randomUUID();
      const [a, b] = await Promise.all([
        bridge.playInstant({ userId, gameKey: 'coin-flip', selection: { side: 'heads' }, stake: '10', currencyCode: 'INR', idempotencyKey: key }),
        bridge.playInstant({ userId, gameKey: 'coin-flip', selection: { side: 'heads' }, stake: '10', currencyCode: 'INR', idempotencyKey: key }),
      ]);
      const after = await avail(userId);
      const settledPayout = Number((a.status === 'SETTLED' ? a : b).payout);
      if (a.roundId !== b.roundId) breaks += 1;
      if (Math.abs(after - (b0 - 10 + settledPayout)) > 1e-6) breaks += 1;
      if (after < 0) breaks += 1;
      const roundTxns = await prisma.walletTransaction.count({ where: { reference: { startsWith: `round:${a.roundId}` } } });
      if (roundTxns > 3) breaks += 1; // reserve + bet + win (win only on payout>0) → ≤ 3
    }
    expect(breaks).toBe(0);
  }, 180_000);

  // ---- S5: 500+ mixed operations across many wallets → reconcile balanced, no negative ----
  it('S5: 500 mixed operations (bounded concurrency) — reconcile balanced, no negative, no orphan reservations', async () => {
    // Sequential setup so the setup is not itself the throughput bottleneck.
    const users: string[] = [];
    for (let i = 0; i < 20; i += 1) users.push(await fund('5000'));
    const tasks: Array<() => Promise<unknown>> = [];
    for (let i = 0; i < 500; i += 1) {
      const u = users[i % users.length]!;
      const kind = i % 4;
      if (kind === 0) tasks.push(() => bridge.playInstant({ userId: u, gameKey: 'wheel', selection: { risk: 'low' }, stake: '10', currencyCode: 'INR', idempotencyKey: randomUUID() }).catch(() => null));
      else if (kind === 1) tasks.push(() => bridge.playInstant({ userId: u, gameKey: 'limbo', selection: { target: 2 }, stake: '10', currencyCode: 'INR', idempotencyKey: randomUUID() }).catch(() => null));
      else if (kind === 2) tasks.push(() => bridge.playPlinko({ userId: u, rows: 16, risk: 'medium', stake: '10', currencyCode: 'INR', idempotencyKey: randomUUID() }).catch(() => null));
      else tasks.push(() => wallet.credit(u, inrId, { amount: '5', typeCode: 'DEPOSIT', idempotencyKey: randomUUID() }).catch(() => null));
    }
    // Run with bounded concurrency (12 in flight) — realistic load within the retry budget.
    const CONC = 12;
    let idx = 0;
    await Promise.all(Array.from({ length: CONC }, async () => { while (idx < tasks.length) { const my = idx++; await tasks[my]!(); } }));

    // Under contention, some settlements correctly PARK as PENDING_SETTLEMENT (2C.1) instead of
    // double-applying — drive the real recovery to drain them (proves contention→recovery→settled).
    const parked = await prisma.gameRound.count({ where: { userId: { in: users }, status: 'PENDING_SETTLEMENT' } });
    for (let s = 0; s < 10; s += 1) {
      const remaining = await prisma.gameRound.findMany({ where: { userId: { in: users }, status: 'PENDING_SETTLEMENT' }, select: { id: true } });
      if (remaining.length === 0) break;
      for (const r of remaining) await recovery.recoverOne(r.id);
    }

    for (const u of users) expect(await avail(u)).toBeGreaterThanOrEqual(0); // no negative
    expect((await ledgerBalanced()).balanced).toBe(true);                    // ledger balanced
    const stuck = await prisma.gameRound.count({ where: { userId: { in: users }, status: 'PENDING_SETTLEMENT' } });
    expect(stuck).toBe(0);                                                   // all recovered
    const failed = await prisma.gameRound.count({ where: { userId: { in: users }, status: 'RECOVERY_FAILED' } });
    expect(failed).toBe(0);                                                  // none unrecoverable
    // eslint-disable-next-line no-console
    console.log(`[S5] parked-then-recovered PENDING_SETTLEMENT rounds: ${parked}`);
  }, 300_000);
});
