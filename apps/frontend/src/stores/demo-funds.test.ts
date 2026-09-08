import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_STARTING_BALANCE, useDemoWallet } from './demo-wallet';

/**
 * Client demo funds — ₹5,000 of play-money for a fresh browser.
 *
 * The whole point of these tests is that this money can never become real money. It lives in the
 * localStorage-backed demo store, the grant is idempotent, and nothing in the chain
 * (store → wallet-ledger → runtime providers) is allowed to reach the network.
 */

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

beforeEach(() => {
  useDemoWallet.getState().reset();
});

/* ------------------------------------------------------------ 1. fresh grant */

describe('a fresh browser receives the starting play-money', () => {
  it('grants exactly 5,000', () => {
    expect(DEMO_STARTING_BALANCE).toBe(5_000);
    useDemoWallet.getState().initializeDemoFunds();
    expect(useDemoWallet.getState().balance).toBe(5_000);
  });

  it('records the grant in the demo ledger rather than setting a bare number', () => {
    useDemoWallet.getState().initializeDemoFunds();
    const { transactions } = useDemoWallet.getState();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.type).toBe('bonus');
    expect(transactions[0]!.amount).toBe(5_000);
    expect(transactions[0]!.balanceAfter).toBe(5_000);
  });
});

/* -------------------------------------------------- 2 + 3. never re-granted */

describe('an existing demo balance is preserved, never reset', () => {
  it('does nothing on a wallet that already holds funds', () => {
    const w = useDemoWallet.getState();
    w.initializeDemoFunds();
    w.spend(650); // client plays down to 4,350
    expect(useDemoWallet.getState().balance).toBe(4_350);

    // A reload runs initialization again — the balance must not jump back to 5,000.
    useDemoWallet.getState().initializeDemoFunds();
    expect(useDemoWallet.getState().balance).toBe(4_350);
  });

  it('does NOT top a client back up after they spend everything', () => {
    const w = useDemoWallet.getState();
    w.initializeDemoFunds();
    w.spend(5_000);
    expect(useDemoWallet.getState().balance).toBe(0);

    // Balance is 0 again, but the wallet is no longer untouched: txnSeq has moved.
    useDemoWallet.getState().initializeDemoFunds();
    expect(useDemoWallet.getState().balance).toBe(0);
  });

  it('does nothing when funds are sitting in the vault rather than the balance', () => {
    const w = useDemoWallet.getState();
    w.initializeDemoFunds();
    w.transferToVault(5_000);
    expect(useDemoWallet.getState().balance).toBe(0);
    expect(useDemoWallet.getState().vault).toBe(5_000);

    useDemoWallet.getState().initializeDemoFunds();
    expect(useDemoWallet.getState().balance).toBe(0);
    expect(useDemoWallet.getState().vault).toBe(5_000);
  });

  it('is idempotent however many times it runs', () => {
    for (let i = 0; i < 5; i++) useDemoWallet.getState().initializeDemoFunds();
    expect(useDemoWallet.getState().balance).toBe(5_000);
    expect(useDemoWallet.getState().transactions).toHaveLength(1);
  });
});

/* --------------------------------------- 3. persistence (see the hydration suite) */

describe('the balance is persisted, not held in memory', () => {
  it('persists under the expected key, in localStorage', () => {
    const src = read('stores/demo-wallet.ts');
    expect(src).toContain("name: 'gp-wallet'");
    expect(src).toContain('createJSONStorage(() => localStorage)');
  });

  it('grants on hydration completing, never before the stored state has landed', () => {
    // Strip comments first: the store's own docblock explains why the pre-merge hook was
    // rejected, and a bare substring search would flag that explanation as the defect.
    const code = read('stores/demo-wallet.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('onFinishHydration');
    // The pre-merge hook fired before stored state landed and reset returning clients to 5,000.
    expect(code).not.toContain('onRehydrateStorage');
  });
});

/* ------------------------------------------------------- 4. game spend works */

describe('demo game play moves the demo balance', () => {
  it('a stake debits and a win credits, through the ledger', () => {
    const w = useDemoWallet.getState();
    w.initializeDemoFunds();
    w.spend(100);
    expect(useDemoWallet.getState().balance).toBe(4_900);
    useDemoWallet.getState().credit(250);
    expect(useDemoWallet.getState().balance).toBe(5_150); // 5000 − 100 stake + 250 payout
    const types = useDemoWallet.getState().transactions.map((t) => t.type);
    expect(types).toEqual(['win', 'bet', 'bonus']);
  });

  it('a losing round cannot push the demo balance below zero', () => {
    const w = useDemoWallet.getState();
    w.initializeDemoFunds();
    w.spend(999_999);
    expect(useDemoWallet.getState().balance).toBe(0);
  });
});

/* ------------------------------- 5-9. it can never become real money */

describe('the demo money is sealed off from the real money system', () => {
  it('makes no network call during a complete demo session', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const w = useDemoWallet.getState();
      w.initializeDemoFunds();
      w.spend(500);
      useDemoWallet.getState().credit(900);
      useDemoWallet.getState().transferToVault(1_000);
      useDemoWallet.getState().transferFromVault(400);
      useDemoWallet.getState().recordBet({ game: 'plinko', stake: 100, win: false, net: -100 });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    'stores/demo-wallet.ts',
    'stores/wallet-ledger.ts',
    'runtime/providers/wallet.ts',
    'runtime/providers/index.ts',
    'app/(dashboard)/vault/page.tsx',
  ])('%s reaches no API, cashier, admin or payment endpoint', (rel) => {
    const src = read(rel);
    for (const forbidden of [
      'apiClient', 'axios', 'fetch(', '/api/v1', 'walletApi', 'cashierApi', 'adminApi',
      'depositApi', 'withdrawalApi', 'useMutation', 'useQuery',
    ]) {
      expect(`${rel} :: ${forbidden} :: ${src.includes(forbidden)}`).toBe(
        `${rel} :: ${forbidden} :: false`,
      );
    }
  });

  it('carries no payment-provider integration of any kind', () => {
    for (const rel of ['stores/demo-wallet.ts', 'app/(dashboard)/vault/page.tsx']) {
      const src = read(rel).toLowerCase();
      for (const provider of ['stripe', 'razorpay', 'payu', 'paytm', 'gateway', 'acquirer']) {
        expect(`${rel} :: ${provider} :: ${src.includes(provider)}`).toBe(
          `${rel} :: ${provider} :: false`,
        );
      }
    }
  });

  it('the demo surface never links to the real-money cashier', () => {
    const src = read('app/(dashboard)/vault/page.tsx');
    // `/deposit` and `/withdraw` are the server-authoritative cashier. A demo screen must not
    // offer them: a client testing with play-money could otherwise open a real deposit.
    expect(src).not.toContain('href="/deposit"');
    expect(src).not.toContain("href='/deposit'");
    expect(src).not.toContain('href="/withdraw"');
  });
});

/* --------------------------------------------------- 10. it is labelled DEMO */

describe('the client can never mistake it for real money', () => {
  it('the vault labels the balance as demo play-money', () => {
    const src = read('app/(dashboard)/vault/page.tsx');
    expect(src).toContain('DEMO BALANCE');
    expect(src).toContain('Play-money for testing only');
  });

  it('states plainly that it is not real and cannot be withdrawn', () => {
    const src = read('app/(dashboard)/vault/page.tsx');
    expect(src).toContain('not real currency');
    expect(src).toContain('never withdrawable');
    // And it must never make the opposite claim.
    expect(src).not.toMatch(/is\s+withdrawable|real\s+cash|withdraw\s+to\s+bank/i);
  });
});
