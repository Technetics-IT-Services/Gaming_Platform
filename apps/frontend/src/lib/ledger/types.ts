/**
 * Production ledger types (Phase 5A).
 *
 * A double-entry, append-only financial model designed to scale to millions of
 * transactions. Balances are NEVER stored as the source of truth — they are
 * derived by summing ledger entries per account (a cached running total is kept
 * only as an index and is always re-derivable, see `Ledger.reconcile`).
 *
 * Amounts are integer minor units (the demo uses 1 unit = ₹1). Money is never a
 * float. This module is framework-agnostic (no React / no store) so it can be
 * lifted to a backend service + relational schema unchanged.
 */

export type AccountId = string;
export type TransactionId = string;
export type EntryId = string;
export type Timestamp = number;

/** Account roles. Player wallets + the house/system counterparty. */
export enum AccountType {
  /** Player spendable balance. */
  Wallet = 'wallet',
  /** Player reserved/held funds (staged bets, pending withdrawals). */
  Locked = 'locked',
  /** Player savings vault. */
  Vault = 'vault',
  /** The house/system counterparty (every player movement is balanced here). */
  House = 'house',
  /** External world (deposits arrive from / withdrawals leave to here). */
  External = 'external',
}

export interface LedgerAccount {
  id: AccountId;
  type: AccountType;
  /** Owning player (absent for house/external system accounts). */
  ownerId?: string;
  currency: string;
}

/** In double-entry, an account is credited (increased) or debited (decreased). */
export enum EntryDirection {
  Credit = 'credit',
  Debit = 'debit',
}

/** The business reason a transaction exists. */
export enum TransactionType {
  Deposit = 'deposit',
  Withdrawal = 'withdrawal',
  Bet = 'bet',
  Win = 'win',
  Refund = 'refund',
  Adjustment = 'adjustment',
  Bonus = 'bonus',
  Promotion = 'promotion',
  ManualCredit = 'manual_credit',
  ManualDebit = 'manual_debit',
  Jackpot = 'jackpot',
  Transfer = 'transfer',
  Reserve = 'reserve',
  Release = 'release',
  Reversal = 'reversal',
}

export enum TransactionStatus {
  Posted = 'posted',
  Reversed = 'reversed',
}

/** One side of a transaction on a single account. */
export interface LedgerEntry {
  id: EntryId;
  transactionId: TransactionId;
  account: AccountId;
  direction: EntryDirection;
  amount: number;
  /** Account balance immediately after this entry (audit convenience; derived). */
  balanceAfter: number;
  /** Account balance immediately before this entry. */
  balanceBefore: number;
  at: Timestamp;
}

/** A balanced set of entries (Σ credits === Σ debits) — the atomic money movement. */
export interface Transaction {
  id: TransactionId;
  type: TransactionType;
  status: TransactionStatus;
  at: Timestamp;
  entries: LedgerEntry[];
  /** Human/system reference (e.g. `stake:crash`). */
  reference?: string;
  /** Human reason (audit). */
  reason?: string;
  /** Actor who initiated it (playerId / 'system'). */
  actor?: string;
  /** Idempotency key — a repeat with the same key returns this transaction. */
  idempotencyKey?: string;
  /** Cross-service correlation id. */
  correlationId?: string;
  gameId?: string;
  roundId?: string;
  /** If this reverses another transaction. */
  reversalOf?: TransactionId;
  metadata?: Record<string, unknown>;
}

/** One posting instruction for `Ledger.post`. */
export interface PostingInstruction {
  account: AccountId;
  direction: EntryDirection;
  amount: number;
}

/** A full transaction to post (its entries must balance). */
export interface PostSpec {
  type: TransactionType;
  postings: PostingInstruction[];
  at?: Timestamp;
  reference?: string;
  reason?: string;
  actor?: string;
  idempotencyKey?: string;
  correlationId?: string;
  gameId?: string;
  roundId?: string;
  reversalOf?: TransactionId;
  metadata?: Record<string, unknown>;
  /** Accounts exempt from the negative-balance guard (the house/external side). */
  allowNegativeAccounts?: AccountId[];
}

export interface Balance {
  available: number;
  locked: number;
  total: number;
  currency: string;
}

export interface HistoryQuery {
  account?: AccountId;
  types?: TransactionType[];
  gameId?: string;
  /** Text match on reference/reason. */
  search?: string;
  /** Return items with `at` ≥ from / ≤ to. */
  from?: Timestamp;
  to?: Timestamp;
  limit?: number;
  /** Opaque cursor from a previous page (a transaction id). */
  cursor?: TransactionId;
}

export interface HistoryPage {
  items: Transaction[];
  nextCursor?: TransactionId;
  total: number;
}

/** Result of a reconciliation pass. */
export interface ReconcileReport {
  balanced: boolean;
  /** System-wide sum of every account balance (must be 0 in double-entry). */
  systemSum: number;
  /** Accounts whose cached balance ≠ replayed balance (must be empty). */
  drifted: { account: AccountId; cached: number; derived: number }[];
  /** Transactions whose entries don't sum to zero (must be empty). */
  unbalanced: TransactionId[];
  accounts: number;
  transactions: number;
  entries: number;
}
