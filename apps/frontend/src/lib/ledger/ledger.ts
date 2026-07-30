/**
 * Double-entry ledger (Phase 5A) — the single financial source of truth.
 *
 * Append-only entries; every transaction balances (Σ credits === Σ debits).
 * Balances are derived from entries (a cached running total is an index only and
 * is always re-derivable — `reconcile()` proves cached === replayed and the
 * system sum is 0). Idempotency keys give exactly-once, retry-safe posting.
 */
import {
  type AccountId,
  type Balance,
  EntryDirection,
  type HistoryPage,
  type HistoryQuery,
  type LedgerEntry,
  type PostSpec,
  type ReconcileReport,
  type Transaction,
  TransactionStatus,
  type TransactionId,
} from './types';

/** A typed ledger error — no raw throws leak. */
export class LedgerError extends Error {
  constructor(
    readonly code:
      | 'UNBALANCED'
      | 'INVALID_AMOUNT'
      | 'INSUFFICIENT_FUNDS'
      | 'EMPTY'
      | 'NOT_FOUND'
      | 'ALREADY_REVERSED',
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

const isPositiveInt = (n: number): boolean => Number.isInteger(n) && n > 0;

export interface LedgerSnapshot {
  entries: LedgerEntry[];
  transactions: Transaction[];
  txnSeq: number;
  entrySeq: number;
}

export class Ledger {
  private entries: LedgerEntry[] = [];
  private txns: Transaction[] = [];
  private readonly txById = new Map<TransactionId, Transaction>();
  private readonly balances = new Map<AccountId, number>();
  private readonly byIdempotency = new Map<string, TransactionId>();
  private txnSeq = 0;
  private entrySeq = 0;

  /** Injectable clock keeps tests deterministic. */
  constructor(private readonly clock: () => number = () => Date.now()) {}

  /** Post a balanced transaction. Idempotent on `idempotencyKey`. */
  post(spec: PostSpec): Transaction {
    if (spec.idempotencyKey) {
      const existing = this.byIdempotency.get(spec.idempotencyKey);
      if (existing) return this.txById.get(existing)!; // exactly-once
    }
    if (!spec.postings.length) throw new LedgerError('EMPTY', 'A transaction needs at least one posting.');

    // Validate amounts + double-entry balance.
    let credits = 0;
    let debits = 0;
    for (const p of spec.postings) {
      if (!isPositiveInt(p.amount)) {
        throw new LedgerError('INVALID_AMOUNT', 'Amounts must be positive integers.', { amount: p.amount });
      }
      if (p.direction === EntryDirection.Credit) credits += p.amount;
      else debits += p.amount;
    }
    if (credits !== debits) {
      throw new LedgerError('UNBALANCED', 'Debits must equal credits.', { credits, debits });
    }

    // Two-phase: project balances, guard against negatives, then commit atomically.
    const exempt = new Set(spec.allowNegativeAccounts ?? []);
    const projected = new Map<AccountId, number>();
    for (const p of spec.postings) {
      const cur = projected.get(p.account) ?? this.balances.get(p.account) ?? 0;
      const next = cur + (p.direction === EntryDirection.Credit ? p.amount : -p.amount);
      if (next < 0 && !exempt.has(p.account)) {
        throw new LedgerError('INSUFFICIENT_FUNDS', 'Posting would overdraw an account.', {
          account: p.account,
          balance: cur,
          amount: p.amount,
        });
      }
      projected.set(p.account, next);
    }

    const at = spec.at ?? this.clock();
    this.txnSeq += 1;
    const id: TransactionId = `txn_${this.txnSeq}`;
    const entries: LedgerEntry[] = spec.postings.map((p) => {
      const before = this.balances.get(p.account) ?? 0;
      const after = before + (p.direction === EntryDirection.Credit ? p.amount : -p.amount);
      this.balances.set(p.account, after);
      this.entrySeq += 1;
      return {
        id: `ent_${this.entrySeq}`,
        transactionId: id,
        account: p.account,
        direction: p.direction,
        amount: p.amount,
        balanceBefore: before,
        balanceAfter: after,
        at,
      };
    });

    const txn: Transaction = {
      id,
      type: spec.type,
      status: TransactionStatus.Posted,
      at,
      entries,
      reference: spec.reference,
      reason: spec.reason,
      actor: spec.actor,
      idempotencyKey: spec.idempotencyKey,
      correlationId: spec.correlationId,
      gameId: spec.gameId,
      roundId: spec.roundId,
      reversalOf: spec.reversalOf,
      metadata: spec.metadata,
    };
    this.entries.push(...entries);
    this.txns.push(txn);
    this.txById.set(id, txn);
    if (spec.idempotencyKey) this.byIdempotency.set(spec.idempotencyKey, id);
    if (spec.reversalOf) {
      const orig = this.txById.get(spec.reversalOf);
      if (orig) orig.status = TransactionStatus.Reversed;
    }
    return txn;
  }

  /** Derived (cached) balance of an account. */
  balanceOf(account: AccountId): number {
    return this.balances.get(account) ?? 0;
  }

  /** Replay every entry to recompute a balance from scratch (source of truth). */
  deriveBalance(account: AccountId): number {
    let bal = 0;
    for (const e of this.entries) {
      if (e.account !== account) continue;
      bal += e.direction === EntryDirection.Credit ? e.amount : -e.amount;
    }
    return bal;
  }

  balance(account: AccountId, currency: string, locked = 0): Balance {
    const available = this.balanceOf(account);
    return { available, locked, total: available + locked, currency };
  }

  getTransaction(id: TransactionId): Transaction | undefined {
    return this.txById.get(id);
  }

  /** All accounts that have ever been posted to. */
  accounts(): AccountId[] {
    return [...this.balances.keys()];
  }

  /** Paginated, filterable transaction history (most recent first). */
  history(query: HistoryQuery = {}): HistoryPage {
    const { account, types, gameId, search, from, to, limit = 25, cursor } = query;
    const typeSet = types ? new Set(types) : null;
    const q = search?.trim().toLowerCase();
    let all = this.txns.filter((t) => {
      if (account && !t.entries.some((e) => e.account === account)) return false;
      if (typeSet && !typeSet.has(t.type)) return false;
      if (gameId && t.gameId !== gameId) return false;
      if (from !== undefined && t.at < from) return false;
      if (to !== undefined && t.at > to) return false;
      if (q && !`${t.reference ?? ''} ${t.reason ?? ''} ${t.type}`.toLowerCase().includes(q)) return false;
      return true;
    });
    all = all.slice().reverse(); // newest first
    let start = 0;
    if (cursor) {
      const idx = all.findIndex((t) => t.id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const items = all.slice(start, start + limit);
    const nextIndex = start + limit;
    return { items, total: all.length, nextCursor: nextIndex < all.length ? items[items.length - 1]?.id : undefined };
  }

  /** Prove the ledger is internally consistent (STEP 5/6). */
  reconcile(): ReconcileReport {
    const drifted: ReconcileReport['drifted'] = [];
    for (const account of this.balances.keys()) {
      const cached = this.balanceOf(account);
      const derived = this.deriveBalance(account);
      if (cached !== derived) drifted.push({ account, cached, derived });
    }
    const unbalanced = this.txns
      .filter((t) => {
        let s = 0;
        for (const e of t.entries) s += e.direction === EntryDirection.Credit ? e.amount : -e.amount;
        return s !== 0;
      })
      .map((t) => t.id);
    let systemSum = 0;
    for (const account of this.balances.keys()) systemSum += this.balanceOf(account);
    return {
      balanced: systemSum === 0 && drifted.length === 0 && unbalanced.length === 0,
      systemSum,
      drifted,
      unbalanced,
      accounts: this.balances.size,
      transactions: this.txns.length,
      entries: this.entries.length,
    };
  }

  /** Serialize for persistence (localStorage / DB export). */
  snapshot(): LedgerSnapshot {
    return { entries: this.entries, transactions: this.txns, txnSeq: this.txnSeq, entrySeq: this.entrySeq };
  }

  /** Rebuild an in-memory ledger from a snapshot (balances re-derived). */
  hydrate(snap: LedgerSnapshot): void {
    this.entries = snap.entries;
    this.txns = snap.transactions;
    this.txnSeq = snap.txnSeq;
    this.entrySeq = snap.entrySeq;
    this.txById.clear();
    this.byIdempotency.clear();
    this.balances.clear();
    for (const t of this.txns) {
      this.txById.set(t.id, t);
      if (t.idempotencyKey) this.byIdempotency.set(t.idempotencyKey, t.id);
    }
    for (const e of this.entries) {
      this.balances.set(e.account, (this.balances.get(e.account) ?? 0) + (e.direction === EntryDirection.Credit ? e.amount : -e.amount));
    }
  }
}
