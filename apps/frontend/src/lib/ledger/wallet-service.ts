/**
 * Wallet service (Phase 5A) — the money API layered over the double-entry ledger.
 *
 * Every player movement is a balanced pair of postings: the player account and a
 * system counterparty (house for game money, external for deposits/withdrawals).
 * Player accounts are guarded against negative balances; the system side may go
 * negative (it mirrors total player liability). All operations are idempotent on
 * their key and re-entrant/retry-safe. Framework-agnostic — no React/store.
 */
import { Ledger, LedgerError } from './ledger';
import {
  type AccountId,
  type Balance,
  EntryDirection,
  type HistoryPage,
  type HistoryQuery,
  type Transaction,
  TransactionType,
} from './types';

const HOUSE: AccountId = 'house:main';
const EXTERNAL: AccountId = 'external:world';

export interface MoneyOptions {
  type?: TransactionType;
  reference?: string;
  reason?: string;
  idempotencyKey?: string;
  correlationId?: string;
  gameId?: string;
  roundId?: string;
  metadata?: Record<string, unknown>;
  at?: number;
}

export class WalletService {
  constructor(
    private readonly ledger: Ledger,
    private readonly currency = 'INR',
  ) {}

  /* ------------------------------- accounts ------------------------------- */

  wallet(playerId: string): AccountId {
    return `player:${playerId}:wallet`;
  }
  locked(playerId: string): AccountId {
    return `player:${playerId}:locked`;
  }
  vault(playerId: string): AccountId {
    return `player:${playerId}:vault`;
  }

  /** No-op create — accounts are lazily created on first posting; here for API parity. */
  createWallet(playerId: string): AccountId {
    return this.wallet(playerId);
  }

  getBalance(playerId: string): Balance {
    const available = this.ledger.balanceOf(this.wallet(playerId));
    const locked = this.ledger.balanceOf(this.locked(playerId));
    return { available, locked, total: available + locked, currency: this.currency };
  }

  getVault(playerId: string): number {
    return this.ledger.balanceOf(this.vault(playerId));
  }

  /* ------------------------------ operations ------------------------------ */

  /** Credit the player (win/bonus/refund/deposit…). Money enters from a system account. */
  credit(playerId: string, amount: number, opts: MoneyOptions = {}): Transaction {
    const type = opts.type ?? TransactionType.ManualCredit;
    const counterparty = type === TransactionType.Deposit ? EXTERNAL : HOUSE;
    return this.ledger.post({
      type,
      postings: [
        { account: this.wallet(playerId), direction: EntryDirection.Credit, amount },
        { account: counterparty, direction: EntryDirection.Debit, amount },
      ],
      allowNegativeAccounts: [HOUSE, EXTERNAL],
      actor: playerId,
      ...opts,
    });
  }

  /** Debit the player (bet/withdrawal/manual debit…). Player balance is guarded. */
  debit(playerId: string, amount: number, opts: MoneyOptions = {}): Transaction {
    const type = opts.type ?? TransactionType.ManualDebit;
    const counterparty = type === TransactionType.Withdrawal ? EXTERNAL : HOUSE;
    return this.ledger.post({
      type,
      postings: [
        { account: this.wallet(playerId), direction: EntryDirection.Debit, amount },
        { account: counterparty, direction: EntryDirection.Credit, amount },
      ],
      allowNegativeAccounts: [HOUSE, EXTERNAL],
      actor: playerId,
      ...opts,
    });
  }

  /** Move funds between two of a player's accounts (e.g. wallet ↔ vault). */
  transfer(from: AccountId, to: AccountId, amount: number, opts: MoneyOptions = {}): Transaction {
    return this.ledger.post({
      type: opts.type ?? TransactionType.Transfer,
      postings: [
        { account: from, direction: EntryDirection.Debit, amount },
        { account: to, direction: EntryDirection.Credit, amount },
      ],
      ...opts,
    });
  }

  /** Reserve spendable funds into the player's locked account (staged bets). */
  reserve(playerId: string, amount: number, opts: MoneyOptions = {}): Transaction {
    return this.ledger.post({
      type: TransactionType.Reserve,
      postings: [
        { account: this.wallet(playerId), direction: EntryDirection.Debit, amount },
        { account: this.locked(playerId), direction: EntryDirection.Credit, amount },
      ],
      actor: playerId,
      ...opts,
    });
  }

  /** Release reserved funds back to spendable (or forfeit via `debit` of locked). */
  release(playerId: string, amount: number, opts: MoneyOptions = {}): Transaction {
    return this.ledger.post({
      type: TransactionType.Release,
      postings: [
        { account: this.locked(playerId), direction: EntryDirection.Debit, amount },
        { account: this.wallet(playerId), direction: EntryDirection.Credit, amount },
      ],
      actor: playerId,
      ...opts,
    });
  }

  /** Reverse a posted transaction (rollback) — posts the mirror image. */
  rollback(transactionId: string, opts: MoneyOptions = {}): Transaction {
    const orig = this.ledger.getTransaction(transactionId);
    if (!orig) throw new LedgerError('NOT_FOUND', 'No such transaction.', { transactionId });
    if (orig.status === 'reversed') throw new LedgerError('ALREADY_REVERSED', 'Already reversed.', { transactionId });
    return this.ledger.post({
      type: TransactionType.Reversal,
      reversalOf: transactionId,
      reason: opts.reason ?? `reversal of ${transactionId}`,
      postings: orig.entries.map((e) => ({
        account: e.account,
        direction: e.direction === EntryDirection.Credit ? EntryDirection.Debit : EntryDirection.Credit,
        amount: e.amount,
      })),
      // Reversals may transiently overdraw either side — they undo a prior state.
      allowNegativeAccounts: orig.entries.map((e) => e.account),
      ...opts,
    });
  }

  /** Player-scoped transaction history (all of a player's accounts). */
  history(playerId: string, query: Omit<HistoryQuery, 'account'> = {}): HistoryPage {
    return this.ledger.history({ ...query, account: this.wallet(playerId) });
  }

  /** Prove the whole ledger is consistent (double-entry invariants hold). */
  reconcile() {
    return this.ledger.reconcile();
  }
}
