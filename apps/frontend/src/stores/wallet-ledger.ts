'use client';

import { Ledger, type HistoryQuery, TransactionType, WalletService } from '@/lib/ledger';

/**
 * Demo wallet → production ledger bridge (Phase 5A).
 *
 * The `useDemoWallet` store keeps a fast UI projection (balance + transaction/bet
 * lists), but the SINGLE FINANCIAL SOURCE OF TRUTH is the double-entry ledger
 * below: every money movement is posted here as a balanced pair of entries, so
 * balances are derived (never stored) and the whole thing is auditable +
 * reconcilable. The store's `balance` is a derived projection kept in lock-step
 * (see `reconcileWallet`). Session-scoped: seeded once from the restored balance
 * so cross-reload persistence is unchanged; the ledger is authoritative in-session.
 *
 * Games never reach this — money flows Game → Runtime → Wallet Provider →
 * `useDemoWallet` → this ledger. The Runtime + providers are untouched.
 */

const PLAYER = 'demo-player';
const OPENING_KEY = 'opening-balance';
const VAULT_KEY = 'opening-vault';

let ledger = new Ledger();
let svc = new WalletService(ledger);
let seeded = false;

/** Seed the authoritative ledger from a restored projection (idempotent). */
export function ensureSeeded(balance: number, vault: number): void {
  if (seeded) return;
  seeded = true;
  const opening = Math.max(0, Math.round(balance)) + Math.max(0, Math.round(vault));
  if (opening > 0) {
    svc.credit(PLAYER, opening, { type: TransactionType.Deposit, reason: 'opening balance', idempotencyKey: OPENING_KEY });
  }
  if (vault > 0) {
    svc.transfer(svc.wallet(PLAYER), svc.vault(PLAYER), Math.round(vault), { reason: 'opening vault', idempotencyKey: VAULT_KEY });
  }
}

/** The demo store's transaction types, mapped to authoritative ledger postings. */
export type DemoLedgerType =
  | 'deposit' | 'withdraw' | 'bet' | 'win' | 'refund' | 'bonus' | 'vault_in' | 'vault_out';

/**
 * Mirror a demo-store money movement into the ledger. `preBalance`/`preVault` are
 * the projection's values BEFORE the movement (used to seed on first use). The
 * mirror never throws into the UI — a ledger inconsistency is logged, not fatal.
 */
export function recordLedger(
  type: DemoLedgerType,
  amount: number,
  ctx: { preBalance: number; preVault: number; game?: string; reason?: string },
): void {
  ensureSeeded(ctx.preBalance, ctx.preVault);
  const amt = Math.max(0, Math.round(amount));
  if (amt <= 0) return;
  try {
    switch (type) {
      case 'deposit':
        svc.credit(PLAYER, amt, { type: TransactionType.Deposit, reason: ctx.reason });
        break;
      case 'withdraw':
        svc.debit(PLAYER, amt, { type: TransactionType.Withdrawal, reason: ctx.reason });
        break;
      case 'bet':
        // Clamp to available so the mirror matches the projection's max(0, …) clamp.
        svc.debit(PLAYER, Math.min(amt, svc.getBalance(PLAYER).available), { type: TransactionType.Bet, gameId: ctx.game, reason: ctx.reason });
        break;
      case 'win':
        svc.credit(PLAYER, amt, { type: TransactionType.Win, gameId: ctx.game, reason: ctx.reason });
        break;
      case 'refund':
        svc.credit(PLAYER, amt, { type: TransactionType.Refund, gameId: ctx.game, reason: ctx.reason });
        break;
      case 'bonus':
        svc.credit(PLAYER, amt, { type: TransactionType.Bonus, reason: ctx.reason });
        break;
      case 'vault_in':
        svc.transfer(svc.wallet(PLAYER), svc.vault(PLAYER), amt, { reason: ctx.reason });
        break;
      case 'vault_out':
        svc.transfer(svc.vault(PLAYER), svc.wallet(PLAYER), amt, { reason: ctx.reason });
        break;
    }
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[wallet-ledger] mirror skipped:', err);
  }
}

/** Reset the authoritative ledger (on demo wallet reset). */
export function resetWalletLedger(): void {
  ledger = new Ledger();
  svc = new WalletService(ledger);
  seeded = false;
}

/* ------------------------- authoritative financial APIs ------------------ */

export function walletBalance() {
  return svc.getBalance(PLAYER);
}
export function walletHistory(query: Omit<HistoryQuery, 'account'> = {}) {
  return svc.history(PLAYER, query);
}
/** Prove the ledger is consistent + the store projection matches it. */
export function reconcileWallet(projectedBalance?: number) {
  const report = svc.reconcile();
  const available = svc.getBalance(PLAYER).available;
  return {
    ...report,
    projectionMatches: projectedBalance === undefined ? true : projectedBalance === available,
    available,
  };
}
