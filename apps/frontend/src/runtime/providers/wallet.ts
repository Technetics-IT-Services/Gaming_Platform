'use client';

import type { IWalletProvider } from '@gaming-platform/types';

import { useDemoWallet } from '@/stores/demo-wallet';
import { RuntimeError, RuntimeErrorCode, WalletError } from '../errors';

/**
 * Wallet providers (Phase 2.2).
 *
 * `DemoWalletProvider` wraps the EXISTING `useDemoWallet` store, so the runtime's
 * debit/credit produce exactly the same balance + transaction-ledger effects the
 * game had before — the header balance, wallet summary, and transactions stay in
 * sync, and the single source of truth is preserved. The demo store holds integer
 * amounts; `Money` (decimal string) is parsed/formatted at the boundary.
 */
const toNumber = (money: string): number => {
  const n = Number(money);
  if (!Number.isFinite(n)) {
    throw new WalletError(RuntimeErrorCode.WALLET_FAILURE, `Invalid money value: ${money}`);
  }
  return n;
};
const toMoney = (n: number): string => String(Math.round(n));

export class DemoWalletProvider implements IWalletProvider {
  async getBalance(): Promise<string> {
    return toMoney(useDemoWallet.getState().balance);
  }

  async debit(input: { amount: string }): Promise<{ balanceAfter: string }> {
    const amount = toNumber(input.amount);
    const w = useDemoWallet.getState();
    if (amount > w.balance) {
      throw new WalletError(RuntimeErrorCode.INSUFFICIENT_BALANCE, 'Insufficient balance for debit.', {
        amount,
        balance: w.balance,
      });
    }
    w.spend(amount); // reduces balance + records a `bet` transaction (existing behaviour)
    return { balanceAfter: toMoney(useDemoWallet.getState().balance) };
  }

  async credit(input: { amount: string }): Promise<{ balanceAfter: string }> {
    const amount = toNumber(input.amount);
    useDemoWallet.getState().credit(amount); // adds balance + records a `win` transaction
    return { balanceAfter: toMoney(useDemoWallet.getState().balance) };
  }
}

/**
 * Real wallet provider — delegates to the backend double-entry wallet-engine
 * (paired LedgerEntry postings, idempotency, optimistic lock). Inactive in 2.2.
 */
export class RealWalletProvider implements IWalletProvider {
  private notActive(): never {
    throw new RuntimeError(
      RuntimeErrorCode.FEATURE_DISABLED,
      'Real wallet provider (backend ledger) is not active in Phase 2.2 (demo mode).',
    );
  }
  async getBalance(): Promise<string> {
    return this.notActive();
  }
  async debit(): Promise<{ balanceAfter: string }> {
    return this.notActive();
  }
  async credit(): Promise<{ balanceAfter: string }> {
    return this.notActive();
  }
}
