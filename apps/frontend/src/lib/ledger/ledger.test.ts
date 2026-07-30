import { describe, expect, it } from 'vitest';

import { Ledger, LedgerError } from './ledger';
import { EntryDirection, TransactionType } from './types';
import { WalletService } from './wallet-service';

/**
 * Production ledger + wallet (Phase 5A). Verifies double-entry correctness,
 * idempotency (exactly-once), negative-balance prevention, reserve/release,
 * rollback, history, and reconciliation.
 */

let clock = 1_000;
const tick = () => (clock += 1);
const freshLedger = () => new Ledger(tick);
const freshWallet = () => new WalletService(freshLedger());

const P = 'demo-player';

/** Assert a call throws a LedgerError with a specific code. */
function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error('expected a LedgerError');
  } catch (e) {
    expect((e as LedgerError).code).toBe(code);
  }
}

describe('Ledger — double entry', () => {
  it('posts a balanced transaction and derives balances', () => {
    const l = freshLedger();
    l.post({
      type: TransactionType.Deposit,
      postings: [
        { account: 'player:p:wallet', direction: EntryDirection.Credit, amount: 1000 },
        { account: 'external:world', direction: EntryDirection.Debit, amount: 1000 },
      ],
      allowNegativeAccounts: ['external:world'],
    });
    expect(l.balanceOf('player:p:wallet')).toBe(1000);
    expect(l.balanceOf('external:world')).toBe(-1000);
    const r = l.reconcile();
    expect(r.balanced).toBe(true);
    expect(r.systemSum).toBe(0); // double-entry: everything nets to zero
    expect(r.drifted).toEqual([]);
  });

  it('records balanceBefore/After on every entry (audit)', () => {
    const l = freshLedger();
    const tx = l.post({
      type: TransactionType.Bonus,
      postings: [
        { account: 'player:p:wallet', direction: EntryDirection.Credit, amount: 250 },
        { account: 'house:main', direction: EntryDirection.Debit, amount: 250 },
      ],
      allowNegativeAccounts: ['house:main'],
    });
    const walletEntry = tx.entries.find((e) => e.account === 'player:p:wallet')!;
    expect(walletEntry.balanceBefore).toBe(0);
    expect(walletEntry.balanceAfter).toBe(250);
  });

  it('rejects an unbalanced transaction', () => {
    const l = freshLedger();
    expect(() =>
      l.post({
        type: TransactionType.Adjustment,
        postings: [
          { account: 'a', direction: EntryDirection.Credit, amount: 100 },
          { account: 'b', direction: EntryDirection.Debit, amount: 90 },
        ],
      }),
    ).toThrowError(LedgerError);
  });

  it('rejects non-positive / non-integer amounts', () => {
    const l = freshLedger();
    for (const amount of [0, -5, 1.5]) {
      expect(() =>
        l.post({ type: TransactionType.Adjustment, postings: [{ account: 'a', direction: EntryDirection.Credit, amount }, { account: 'b', direction: EntryDirection.Debit, amount }] }),
      ).toThrowError(LedgerError);
    }
  });

  it('prevents overdrawing a guarded account', () => {
    const l = freshLedger();
    expectCode(
      () =>
        l.post({
          type: TransactionType.Bet,
          postings: [
            { account: 'player:p:wallet', direction: EntryDirection.Debit, amount: 100 },
            { account: 'house:main', direction: EntryDirection.Credit, amount: 100 },
          ],
          allowNegativeAccounts: ['house:main'],
        }),
      'INSUFFICIENT_FUNDS',
    );
  });

  it('reconcile proves cached balance === replayed balance', () => {
    const l = freshLedger();
    for (let i = 0; i < 50; i += 1) {
      l.post({
        type: TransactionType.Win,
        postings: [
          { account: 'player:p:wallet', direction: EntryDirection.Credit, amount: 10 },
          { account: 'house:main', direction: EntryDirection.Debit, amount: 10 },
        ],
        allowNegativeAccounts: ['house:main'],
      });
    }
    expect(l.balanceOf('player:p:wallet')).toBe(500);
    expect(l.deriveBalance('player:p:wallet')).toBe(500);
    expect(l.reconcile().balanced).toBe(true);
  });

  it('snapshot + hydrate reproduces balances from entries', () => {
    const l = freshLedger();
    l.post({ type: TransactionType.Deposit, postings: [{ account: 'player:p:wallet', direction: EntryDirection.Credit, amount: 300 }, { account: 'external:world', direction: EntryDirection.Debit, amount: 300 }], allowNegativeAccounts: ['external:world'] });
    const snap = l.snapshot();
    const l2 = freshLedger();
    l2.hydrate(snap);
    expect(l2.balanceOf('player:p:wallet')).toBe(300);
    expect(l2.reconcile().balanced).toBe(true);
  });
});

describe('Ledger — idempotency (exactly-once)', () => {
  it('a repeated key returns the same transaction and does not double-apply', () => {
    const l = freshLedger();
    const spec = {
      type: TransactionType.Win,
      idempotencyKey: 'win:round-1',
      postings: [
        { account: 'player:p:wallet', direction: EntryDirection.Credit, amount: 200 },
        { account: 'house:main', direction: EntryDirection.Debit, amount: 200 },
      ],
      allowNegativeAccounts: ['house:main'],
    };
    const a = l.post(spec);
    const b = l.post(spec); // retry
    expect(b.id).toBe(a.id);
    expect(l.balanceOf('player:p:wallet')).toBe(200); // credited exactly once
  });
});

describe('Ledger — history', () => {
  const build = () => {
    const l = freshLedger();
    for (let i = 0; i < 30; i += 1) {
      l.post({
        type: i % 2 === 0 ? TransactionType.Bet : TransactionType.Win,
        reference: `round-${i}`,
        gameId: 'crash',
        postings: [
          { account: 'player:p:wallet', direction: i % 2 === 0 ? EntryDirection.Debit : EntryDirection.Credit, amount: 10 },
          { account: 'house:main', direction: i % 2 === 0 ? EntryDirection.Credit : EntryDirection.Debit, amount: 10 },
        ],
        allowNegativeAccounts: ['house:main', 'player:p:wallet'],
      });
    }
    return l;
  };

  it('paginates newest-first with a cursor', () => {
    const l = build();
    const page1 = l.history({ account: 'player:p:wallet', limit: 10 });
    expect(page1.items).toHaveLength(10);
    expect(page1.total).toBe(30);
    const page2 = l.history({ account: 'player:p:wallet', limit: 10, cursor: page1.nextCursor });
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
  });

  it('filters by type, game, and text search', () => {
    const l = build();
    expect(l.history({ types: [TransactionType.Bet], limit: 100 }).items.every((t) => t.type === TransactionType.Bet)).toBe(true);
    expect(l.history({ gameId: 'crash', limit: 100 }).total).toBe(30);
    expect(l.history({ search: 'round-2', limit: 100 }).items.length).toBeGreaterThan(0);
  });
});

describe('WalletService', () => {
  it('creates a wallet, credits a deposit, and reports the balance', () => {
    const w = freshWallet();
    w.createWallet(P);
    expect(w.getBalance(P).available).toBe(0);
    w.credit(P, 1000, { type: TransactionType.Deposit });
    expect(w.getBalance(P).available).toBe(1000);
    expect(w.reconcile().balanced).toBe(true);
  });

  it('debits a bet and prevents a negative balance', () => {
    const w = freshWallet();
    w.credit(P, 500, { type: TransactionType.Deposit });
    w.debit(P, 200, { type: TransactionType.Bet });
    expect(w.getBalance(P).available).toBe(300);
    expectCode(() => w.debit(P, 5000, { type: TransactionType.Bet }), 'INSUFFICIENT_FUNDS');
    expect(w.getBalance(P).available).toBe(300); // unchanged after the rejected debit
  });

  it('settles a win exactly once under duplicate submission', () => {
    const w = freshWallet();
    w.credit(P, 100, { type: TransactionType.Deposit });
    const opts = { type: TransactionType.Win, idempotencyKey: 'credit:round-9' };
    w.credit(P, 300, opts);
    w.credit(P, 300, opts); // duplicate settlement retry
    expect(w.getBalance(P).available).toBe(400); // 100 + 300 once
  });

  it('reserves and releases funds without changing the total', () => {
    const w = freshWallet();
    w.credit(P, 1000, { type: TransactionType.Deposit });
    w.reserve(P, 400);
    let b = w.getBalance(P);
    expect(b.available).toBe(600);
    expect(b.locked).toBe(400);
    expect(b.total).toBe(1000);
    w.release(P, 400);
    b = w.getBalance(P);
    expect(b.available).toBe(1000);
    expect(b.locked).toBe(0);
    expect(w.reconcile().balanced).toBe(true);
  });

  it('transfers between wallet and vault', () => {
    const w = freshWallet();
    w.credit(P, 1000, { type: TransactionType.Deposit });
    w.transfer(w.wallet(P), w.vault(P), 250);
    expect(w.getBalance(P).available).toBe(750);
    expect(w.getVault(P)).toBe(250);
  });

  it('rolls back a transaction and rejects a double rollback', () => {
    const w = freshWallet();
    w.credit(P, 1000, { type: TransactionType.Deposit });
    const bet = w.debit(P, 200, { type: TransactionType.Bet });
    expect(w.getBalance(P).available).toBe(800);
    w.rollback(bet.id);
    expect(w.getBalance(P).available).toBe(1000); // stake returned
    expectCode(() => w.rollback(bet.id), 'ALREADY_REVERSED');
  });

  it('serves player-scoped history and stays reconciled across many ops', () => {
    const w = freshWallet();
    w.credit(P, 10_000, { type: TransactionType.Deposit });
    for (let i = 0; i < 100; i += 1) {
      w.debit(P, 10, { type: TransactionType.Bet, gameId: 'dice' });
      if (i % 3 === 0) w.credit(P, 18, { type: TransactionType.Win, gameId: 'dice' });
    }
    const page = w.history(P, { limit: 20 });
    expect(page.items).toHaveLength(20);
    expect(page.total).toBeGreaterThan(100);
    const r = w.reconcile();
    expect(r.balanced).toBe(true);
    expect(r.systemSum).toBe(0);
  });

  it('models double-spend safety: sequential debits cannot overdraw', () => {
    const w = freshWallet();
    w.credit(P, 100, { type: TransactionType.Deposit });
    w.debit(P, 60, { type: TransactionType.Bet });
    expectCode(() => w.debit(P, 60, { type: TransactionType.Bet }), 'INSUFFICIENT_FUNDS');
    expect(w.getBalance(P).available).toBe(40);
  });
});
