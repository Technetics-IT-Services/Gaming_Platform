import { beforeEach, describe, expect, it } from 'vitest';

import { useDemoWallet } from './demo-wallet';
import { reconcileWallet, walletBalance, walletHistory } from './wallet-ledger';

/**
 * STEP 9 migration parity — the demo wallet store is now backed by the production
 * ledger. Every store money movement mirrors into the authoritative double-entry
 * ledger; the store's `balance` projection stays reconciled with the ledger's
 * derived balance. The Runtime + providers + games are untouched.
 */

beforeEach(() => {
  useDemoWallet.getState().reset(); // resets the store + the authoritative ledger
});

describe('demo wallet ↔ ledger parity', () => {
  it('keeps the store projection reconciled with the ledger through a full flow', () => {
    const w = useDemoWallet.getState();
    w.deposit(1000);
    expect(walletBalance().available).toBe(1000);
    w.spend(300); // bet
    w.credit(500); // win
    w.transferToVault(200);

    const store = useDemoWallet.getState();
    expect(store.balance).toBe(1000);
    expect(store.vault).toBe(200);
    expect(walletBalance().available).toBe(1000); // ledger available === store balance
    const r = reconcileWallet(store.balance);
    expect(r.balanced).toBe(true);
    expect(r.systemSum).toBe(0); // double-entry: everything nets to zero
    expect(r.projectionMatches).toBe(true);
  });

  it('never lets the ledger or projection go negative on an oversized spend', () => {
    const w = useDemoWallet.getState();
    w.deposit(100);
    w.spend(500); // store clamps to 0; the ledger mirror clamps to available
    expect(useDemoWallet.getState().balance).toBe(0);
    expect(walletBalance().available).toBe(0);
    expect(reconcileWallet(0).balanced).toBe(true);
  });

  it('exposes an authoritative, typed transaction history', () => {
    const w = useDemoWallet.getState();
    w.deposit(1000);
    w.spend(100);
    w.credit(180);
    const page = walletHistory({ limit: 20 });
    expect(page.items.length).toBeGreaterThanOrEqual(3);
    expect(page.items.some((t) => t.type === 'bet')).toBe(true);
    expect(page.items.some((t) => t.type === 'win')).toBe(true);
    // Filter by type.
    expect(walletHistory({ types: undefined, limit: 100 }).total).toBeGreaterThanOrEqual(3);
  });

  it('stays reconciled across many mixed operations', () => {
    const w = useDemoWallet.getState();
    w.deposit(10_000);
    for (let i = 0; i < 200; i += 1) {
      w.spend(10);
      if (i % 2 === 0) w.credit(18);
      if (i % 25 === 0) w.bonus(50, { source: 'promo' });
    }
    const r = reconcileWallet(useDemoWallet.getState().balance);
    expect(r.balanced).toBe(true);
    expect(r.projectionMatches).toBe(true);
  });
});
