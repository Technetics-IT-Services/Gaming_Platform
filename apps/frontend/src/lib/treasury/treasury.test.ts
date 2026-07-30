import { describe, expect, it } from 'vitest';

import { Ledger, TransactionType, WalletService } from '@/lib/ledger';

import { assertTransition, canTransition, TransitionError, WITHDRAWAL_TRANSITIONS } from './state-machine';
import { TreasuryEngine } from './treasury-engine';
import { type IPayoutGateway, WithdrawalStatus } from './types';
import { type WithdrawalError, WithdrawalService } from './withdrawal-service';

/**
 * Withdrawal + treasury layer (Phase 5C). Proves the full cash-out lifecycle over
 * the Phase 5A ledger: reserve → review → approve → process → settle, plus reject/
 * cancel/fail/retry/reverse, financial limits, idempotency, the approval state
 * machine, manual operations, reporting and reconciliation. Every assertion is
 * anchored on ledger balances so double-entry conservation is verified, not assumed.
 */

const LIMITS = { min: 100, perTransaction: 100_000, dailyMax: 200_000 };

/** Build a fresh ledger/wallet/treasury/service, with a controllable clock. */
function setup(opts?: {
  gateway?: IPayoutGateway;
  authorizer?: (action: string, ctx: { actor: string }) => boolean;
  rateLimiter?: (playerId: string) => boolean;
}) {
  const ledger = new Ledger();
  const wallet = new WalletService(ledger, 'INR');
  const treasury = new TreasuryEngine(ledger);
  const gateway: IPayoutGateway = opts?.gateway ?? { async payout() { return { ok: true, reference: 'pay_ok' }; } };
  let t = 1_700_000_000_000;
  const svc = new WithdrawalService(wallet, treasury, gateway, {
    limits: LIMITS,
    authorizer: opts?.authorizer as never,
    rateLimiter: opts?.rateLimiter,
    clock: () => (t += 1_000),
  });
  const fund = (playerId: string, amount: number) => wallet.credit(playerId, amount, { type: TransactionType.Deposit });
  return { ledger, wallet, treasury, svc, fund };
}

async function expectCode(fn: () => unknown | Promise<unknown>, code: string) {
  try {
    await fn();
    throw new Error('expected throw');
  } catch (e) {
    expect((e as WithdrawalError).code).toBe(code);
  }
}

describe('state machine', () => {
  it('allows only declared transitions and rejects the rest', () => {
    expect(canTransition(WithdrawalStatus.Requested, WithdrawalStatus.PendingReview)).toBe(true);
    expect(canTransition(WithdrawalStatus.PendingReview, WithdrawalStatus.Completed)).toBe(false);
    expect(canTransition(WithdrawalStatus.Completed, WithdrawalStatus.Reversed)).toBe(true);
    // terminal states have no exits
    for (const terminal of [WithdrawalStatus.Rejected, WithdrawalStatus.Cancelled, WithdrawalStatus.Reversed]) {
      expect(WITHDRAWAL_TRANSITIONS[terminal]).toEqual([]);
    }
    expect(() => assertTransition(WithdrawalStatus.Requested, WithdrawalStatus.Completed)).toThrow(TransitionError);
  });
});

describe('withdrawal happy path', () => {
  it('reserves, approves, processes and settles with money conserved end-to-end', async () => {
    const { wallet, treasury, svc, fund } = setup();
    fund('p1', 50_000);
    expect(wallet.getBalance('p1').available).toBe(50_000);

    const w = svc.createRequest({ playerId: 'p1', amount: 20_000, currency: 'INR', method: 'upi' });
    expect(w.status).toBe(WithdrawalStatus.Requested);
    expect(w.reference).toBe('WD-000001');
    // funds moved wallet → locked
    expect(wallet.getBalance('p1').available).toBe(30_000);
    expect(wallet.getBalance('p1').locked).toBe(20_000);
    expect(w.ledgerRefs.reserve).toBeTruthy();

    svc.submitForReview(w.id);
    expect(svc.getWithdrawal(w.id)!.status).toBe(WithdrawalStatus.PendingReview);

    svc.approve(w.id, { actor: 'ops-1', note: 'looks good' });
    expect(svc.getWithdrawal(w.id)!.approval!.actor).toBe('ops-1');

    await svc.process(w.id);
    const done = svc.getWithdrawal(w.id)!;
    expect(done.status).toBe(WithdrawalStatus.Completed);
    expect(done.payoutRef).toBe('pay_ok');

    // locked drained, pending/settlement flat. external:world is the single outside
    // account shared with deposits: it held -50k from funding, +20k back on disburse.
    expect(wallet.getBalance('p1').locked).toBe(0);
    expect(treasury.balances()).toEqual({ pending: 0, settlement: 0, external: -30_000 });
    // whole ledger still balances to zero
    expect(treasury.reconcile().balanced).toBe(true);
    expect(treasury.reconcile().systemSum).toBe(0);
    expect(done.ledgerRefs).toMatchObject({ reserve: expect.any(String), commit: expect.any(String), settle: expect.any(String), disburse: expect.any(String) });
  });
});

describe('reject and cancel release the reservation', () => {
  it('reject returns locked funds to the wallet', () => {
    const { wallet, svc, fund } = setup();
    fund('p1', 10_000);
    const w = svc.createRequest({ playerId: 'p1', amount: 4_000, currency: 'INR' });
    svc.submitForReview(w.id);
    svc.reject(w.id, { actor: 'ops', reason: 'suspicious' });
    expect(svc.getWithdrawal(w.id)!.status).toBe(WithdrawalStatus.Rejected);
    expect(wallet.getBalance('p1')).toMatchObject({ available: 10_000, locked: 0 });
  });

  it('cancel from Requested releases the reservation', () => {
    const { wallet, svc, fund } = setup();
    fund('p1', 10_000);
    const w = svc.createRequest({ playerId: 'p1', amount: 4_000, currency: 'INR' });
    svc.cancel(w.id, { actor: 'p1', reason: 'changed mind' });
    expect(svc.getWithdrawal(w.id)!.status).toBe(WithdrawalStatus.Cancelled);
    expect(wallet.getBalance('p1').available).toBe(10_000);
  });
});

describe('financial limits', () => {
  it('enforces min, per-transaction, daily and available-balance', async () => {
    const { svc, fund } = setup();
    fund('p1', 300_000);
    await expectCode(() => svc.createRequest({ playerId: 'p1', amount: 50, currency: 'INR' }), 'LIMIT_EXCEEDED');
    await expectCode(() => svc.createRequest({ playerId: 'p1', amount: 100_001, currency: 'INR' }), 'LIMIT_EXCEEDED');
    await expectCode(() => svc.createRequest({ playerId: 'p1', amount: 1_234.5, currency: 'INR' }), 'INVALID_REQUEST');

    // daily cap is 200k: two 100k requests ok, a third over the cap fails
    svc.createRequest({ playerId: 'p1', amount: 100_000, currency: 'INR' });
    svc.createRequest({ playerId: 'p1', amount: 100_000, currency: 'INR' });
    await expectCode(() => svc.createRequest({ playerId: 'p1', amount: 100, currency: 'INR' }), 'LIMIT_EXCEEDED');
  });

  it('rejects a withdrawal above the available balance', async () => {
    const { svc, fund } = setup();
    fund('p1', 500);
    await expectCode(() => svc.createRequest({ playerId: 'p1', amount: 1_000, currency: 'INR' }), 'INSUFFICIENT_FUNDS');
  });

  it('a released reservation frees daily headroom again', () => {
    const { svc, fund } = setup();
    fund('p1', 300_000);
    const w = svc.createRequest({ playerId: 'p1', amount: 100_000, currency: 'INR' });
    svc.cancel(w.id, { actor: 'p1' }); // cancelled no longer counts toward the daily cap
    // now another 200k fits under the 200k cap
    svc.createRequest({ playerId: 'p1', amount: 100_000, currency: 'INR' });
    svc.createRequest({ playerId: 'p1', amount: 100_000, currency: 'INR' });
  });
});

describe('idempotency & security hooks', () => {
  it('dedupes createRequest on the idempotency key (single reservation)', () => {
    const { wallet, svc, fund } = setup();
    fund('p1', 10_000);
    const a = svc.createRequest({ playerId: 'p1', amount: 3_000, currency: 'INR', idempotencyKey: 'k1' });
    const b = svc.createRequest({ playerId: 'p1', amount: 3_000, currency: 'INR', idempotencyKey: 'k1' });
    expect(a.id).toBe(b.id);
    expect(wallet.getBalance('p1').locked).toBe(3_000); // only reserved once
  });

  it('honors the rate limiter', async () => {
    const { svc, fund } = setup({ rateLimiter: () => false });
    fund('p1', 10_000);
    await expectCode(() => svc.createRequest({ playerId: 'p1', amount: 3_000, currency: 'INR' }), 'RATE_LIMITED');
  });

  it('honors the authorizer on privileged actions', async () => {
    const { svc, fund } = setup({ authorizer: (action) => action !== 'approve' });
    fund('p1', 10_000);
    const w = svc.createRequest({ playerId: 'p1', amount: 3_000, currency: 'INR' });
    svc.submitForReview(w.id);
    await expectCode(() => svc.approve(w.id, { actor: 'x' }), 'FORBIDDEN');
  });

  it('generates opaque ids and correlation ids (no leakage of internals)', () => {
    const { svc, fund } = setup();
    fund('p1', 10_000);
    const w = svc.createRequest({ playerId: 'p1', amount: 3_000, currency: 'INR' });
    expect(w.id).toMatch(/^wd_[0-9a-f]{24}$/);
    expect(w.correlationId).toMatch(/^corr_[0-9a-f]{24}$/);
  });
});

describe('failure, retry and reversal', () => {
  it('a failed payout leaves funds committed in pending, retry then settles', async () => {
    const { treasury, wallet, svc, fund } = setup({
      gateway: (() => {
        let n = 0;
        return { async payout() { n += 1; return n === 1 ? { ok: false, reason: 'gateway down' } : { ok: true, reference: 'pay_2' }; } };
      })(),
    });
    fund('p1', 10_000);
    const w = svc.createRequest({ playerId: 'p1', amount: 5_000, currency: 'INR' });
    svc.submitForReview(w.id);
    svc.approve(w.id, { actor: 'ops' });
    await svc.process(w.id);
    expect(svc.getWithdrawal(w.id)!.status).toBe(WithdrawalStatus.Failed);
    // funds sit in the pending pool, not disbursed (external still just the -10k deposit)
    expect(treasury.balances().pending).toBe(5_000);
    expect(treasury.balances().external).toBe(-10_000);

    await svc.retry(w.id, { actor: 'ops' });
    expect(svc.getWithdrawal(w.id)!.status).toBe(WithdrawalStatus.Completed);
    expect(treasury.balances()).toMatchObject({ pending: 0, external: -5_000 });
    expect(wallet.getBalance('p1').locked).toBe(0);
    expect(treasury.reconcile().balanced).toBe(true);
  });

  it('cancel from Failed unwinds the commit back to the wallet', async () => {
    const { treasury, wallet, svc, fund } = setup({ gateway: { async payout() { return { ok: false, reason: 'down' }; } } });
    fund('p1', 10_000);
    const w = svc.createRequest({ playerId: 'p1', amount: 5_000, currency: 'INR' });
    svc.submitForReview(w.id);
    svc.approve(w.id, { actor: 'ops' });
    await svc.process(w.id);
    svc.cancel(w.id, { actor: 'ops', reason: 'give up' });
    expect(svc.getWithdrawal(w.id)!.status).toBe(WithdrawalStatus.Cancelled);
    expect(treasury.balances().pending).toBe(0);
    expect(wallet.getBalance('p1')).toMatchObject({ available: 10_000, locked: 0 });
    expect(treasury.reconcile().balanced).toBe(true);
  });

  it('reverses a completed withdrawal back to the wallet', async () => {
    const { treasury, wallet, svc, fund } = setup();
    fund('p1', 10_000);
    const w = svc.createRequest({ playerId: 'p1', amount: 5_000, currency: 'INR' });
    svc.submitForReview(w.id);
    svc.approve(w.id, { actor: 'ops' });
    await svc.process(w.id);
    svc.reverse(w.id, { actor: 'finance', reason: 'chargeback' });
    expect(svc.getWithdrawal(w.id)!.status).toBe(WithdrawalStatus.Reversed);
    expect(wallet.getBalance('p1').available).toBe(10_000);
    // net back to just the -10k deposit: +5k on disburse, -5k on reverse
    expect(treasury.balances().external).toBe(-10_000);
    expect(treasury.reconcile().balanced).toBe(true);
  });
});

describe('manual operations', () => {
  it('manual adjustment credits/debits the wallet through the ledger', () => {
    const { wallet, svc, fund } = setup();
    fund('p1', 10_000);
    svc.manualAdjustment('p1', 2_500, { actor: 'finance', reason: 'goodwill' });
    expect(wallet.getBalance('p1').available).toBe(12_500);
    svc.manualAdjustment('p1', -500, { actor: 'finance', reason: 'correction' });
    expect(wallet.getBalance('p1').available).toBe(12_000);
    expect(svc.auditTrail().some((r) => r.action === 'manual_adjustment')).toBe(true);
  });

  it('manual release frees a stuck reservation', () => {
    const { wallet, svc, fund } = setup();
    fund('p1', 10_000);
    const w = svc.createRequest({ playerId: 'p1', amount: 4_000, currency: 'INR' });
    svc.manualRelease(w.id, { actor: 'finance', reason: 'stuck' });
    expect(wallet.getBalance('p1')).toMatchObject({ available: 10_000, locked: 0 });
  });
});

describe('reporting & reconciliation', () => {
  it('filters, searches and paginates history', () => {
    const { svc, fund } = setup();
    fund('p1', 200_000);
    fund('p2', 50_000);
    svc.createRequest({ playerId: 'p1', amount: 1_000, currency: 'INR', method: 'upi' });
    svc.createRequest({ playerId: 'p1', amount: 2_000, currency: 'INR', method: 'bank' });
    svc.createRequest({ playerId: 'p2', amount: 3_000, currency: 'INR', method: 'upi' });

    expect(svc.history({ playerId: 'p1' }).total).toBe(2);
    expect(svc.history({ search: 'bank' }).total).toBe(1);
    expect(svc.history({ statuses: [WithdrawalStatus.Requested] }).total).toBe(3);

    const page1 = svc.history({ limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = svc.history({ limit: 2, cursor: page1.nextCursor });
    expect(page2.items).toHaveLength(1);
    const firstPageIds = new Set(page1.items.map((w) => w.id));
    expect(page2.items.every((w) => !firstPageIds.has(w.id))).toBe(true);
  });

  it('summarizes pending, completed, treasury and settlement', async () => {
    const { svc, fund } = setup();
    fund('p1', 200_000);
    const w1 = svc.createRequest({ playerId: 'p1', amount: 10_000, currency: 'INR' });
    svc.submitForReview(w1.id);
    svc.approve(w1.id, { actor: 'ops' });
    await svc.process(w1.id); // completed
    svc.createRequest({ playerId: 'p1', amount: 5_000, currency: 'INR' }); // still pending review queue

    expect(svc.completed()).toHaveLength(1);
    expect(svc.pending()).toHaveLength(1);
    expect(svc.settlementSummary()).toEqual({ count: 1, amount: 10_000 });

    const ts = svc.treasurySummary();
    expect(ts.reservedTotal).toBe(5_000); // the still-open request
    expect(ts.external).toBe(-190_000); // -200k deposit + 10k disbursed
    expect(ts.balanced).toBe(true);
    expect(ts.systemSum).toBe(0);
  });

  it('reconcile flags a balanced book and matches committed totals', async () => {
    const { svc, fund } = setup({ gateway: { async payout() { return { ok: false, reason: 'x' }; } } });
    fund('p1', 50_000);
    const w = svc.createRequest({ playerId: 'p1', amount: 10_000, currency: 'INR' });
    svc.submitForReview(w.id);
    svc.approve(w.id, { actor: 'ops' });
    await svc.process(w.id); // now Failed, 10k sits in pending
    const rec = svc.reconcile();
    expect(rec.balanced).toBe(true);
    expect(rec.systemSum).toBe(0);
    expect(rec.unmatched).toEqual([]);
  });
});
