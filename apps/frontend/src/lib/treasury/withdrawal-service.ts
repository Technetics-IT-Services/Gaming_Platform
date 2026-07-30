/**
 * Withdrawal service / manager (Phase 5C, STEP 2).
 *
 * Orchestrates the full cash-out lifecycle above the Phase 5A ledger: validate →
 * reserve → review → approve → process (commit + payout) → complete (settle) with
 * reject/cancel/fail/retry/reverse branches, plus manual operations, reporting and
 * reconciliation. It moves money ONLY through the WalletService (reserve/release)
 * and TreasuryEngine (commit/settle/reverse) — never a balance directly. Every
 * transition is validated by the state machine; every action is audited.
 */
import { TransactionType, type WalletService } from '@/lib/ledger';

import { assertTransition } from './state-machine';
import { type TreasuryEngine } from './treasury-engine';
import {
  type Authorizer,
  type HistoryPage,
  type HistoryQuery,
  type IPayoutGateway,
  type RateLimiter,
  type TreasurySummary,
  type Withdrawal,
  type WithdrawalAuditRecord,
  type WithdrawalId,
  type WithdrawalLimits,
  type WithdrawalRequest,
  WithdrawalStatus,
} from './types';

export class WithdrawalError extends Error {
  constructor(
    readonly code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'LIMIT_EXCEEDED' | 'INSUFFICIENT_FUNDS' | 'FORBIDDEN' | 'RATE_LIMITED',
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WithdrawalError';
  }
}

/** Statuses that still hold or have spent player funds (count toward daily limit). */
const ACTIVE_FOR_LIMIT = new Set([
  WithdrawalStatus.Requested,
  WithdrawalStatus.PendingReview,
  WithdrawalStatus.Approved,
  WithdrawalStatus.Processing,
  WithdrawalStatus.Completed,
  WithdrawalStatus.Failed,
]);

const DAY_MS = 24 * 60 * 60_000;

export interface WithdrawalServiceOptions {
  limits: WithdrawalLimits;
  authorizer?: Authorizer;
  rateLimiter?: RateLimiter;
  clock?: () => number;
}

export class WithdrawalService {
  private readonly items = new Map<WithdrawalId, Withdrawal>();
  private readonly byIdempotency = new Map<string, WithdrawalId>();
  private readonly audit: WithdrawalAuditRecord[] = [];
  private readonly clock: () => number;
  private readonly limits: WithdrawalLimits;
  private readonly authorize: Authorizer;
  private readonly rateLimiter: RateLimiter;
  private seq = 0;

  constructor(
    private readonly wallet: WalletService,
    private readonly treasury: TreasuryEngine,
    private readonly payout: IPayoutGateway,
    opts: WithdrawalServiceOptions,
  ) {
    this.limits = opts.limits;
    this.authorize = opts.authorizer ?? (() => true);
    this.rateLimiter = opts.rateLimiter ?? (() => true);
    this.clock = opts.clock ?? (() => Date.now());
  }

  private log(rec: Omit<WithdrawalAuditRecord, 'at'>): void {
    this.audit.push({ at: this.clock(), ...rec });
  }
  private secureId(prefix: string): string {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  private transition(w: Withdrawal, to: WithdrawalStatus): void {
    assertTransition(w.status, to);
    w.status = to;
    w.updatedAt = this.clock();
  }
  private get(id: WithdrawalId): Withdrawal {
    const w = this.items.get(id);
    if (!w) throw new WithdrawalError('NOT_FOUND', 'No such withdrawal.', { id });
    return w;
  }

  /* ------------------------------ validation ------------------------------ */

  private dailyUsed(playerId: string): number {
    const since = this.clock() - DAY_MS;
    let total = 0;
    for (const w of this.items.values()) {
      if (w.playerId === playerId && w.createdAt >= since && ACTIVE_FOR_LIMIT.has(w.status)) total += w.amount;
    }
    return total;
  }

  private validate(req: WithdrawalRequest): void {
    if (!req.playerId) throw new WithdrawalError('INVALID_REQUEST', 'playerId required');
    if (!Number.isInteger(req.amount) || req.amount <= 0) throw new WithdrawalError('INVALID_REQUEST', 'amount must be a positive integer');
    if (!req.currency) throw new WithdrawalError('INVALID_REQUEST', 'currency required');
    if (!this.rateLimiter(req.playerId)) throw new WithdrawalError('RATE_LIMITED', 'Too many requests.');
    if (req.amount < this.limits.min) throw new WithdrawalError('LIMIT_EXCEEDED', `Below minimum (${this.limits.min}).`);
    if (req.amount > this.limits.perTransaction) throw new WithdrawalError('LIMIT_EXCEEDED', `Above per-transaction limit (${this.limits.perTransaction}).`);
    if (this.dailyUsed(req.playerId) + req.amount > this.limits.dailyMax) throw new WithdrawalError('LIMIT_EXCEEDED', 'Daily limit exceeded.');
    const available = this.wallet.getBalance(req.playerId).available;
    if (req.amount > available) throw new WithdrawalError('INSUFFICIENT_FUNDS', 'Insufficient available balance.', { available, amount: req.amount });
  }

  /* ------------------------------- lifecycle ------------------------------ */

  /** Create a request (validate → reserve funds → Requested). Idempotent. */
  createRequest(req: WithdrawalRequest): Withdrawal {
    if (req.idempotencyKey) {
      const existing = this.byIdempotency.get(req.idempotencyKey);
      if (existing) return this.get(existing);
    }
    this.validate(req);
    const now = this.clock();
    this.seq += 1;
    const id = this.secureId('wd');
    const correlationId = req.correlationId ?? this.secureId('corr');
    const reserveTx = this.wallet.reserve(req.playerId, req.amount, {
      type: TransactionType.Reserve,
      reference: id,
      reason: 'withdrawal reserve',
      idempotencyKey: `wd-reserve:${id}`,
      correlationId,
    });
    const w: Withdrawal = {
      id,
      reference: `WD-${String(this.seq).padStart(6, '0')}`,
      playerId: req.playerId,
      amount: req.amount,
      currency: req.currency,
      status: WithdrawalStatus.Requested,
      method: req.method,
      destination: req.destination,
      correlationId,
      idempotencyKey: req.idempotencyKey,
      ledgerRefs: { reserve: reserveTx.id },
      createdAt: now,
      updatedAt: now,
      metadata: req.metadata,
    };
    this.items.set(id, w);
    if (req.idempotencyKey) this.byIdempotency.set(req.idempotencyKey, id);
    this.log({ action: 'create', withdrawalId: id, status: w.status, correlationId });
    return w;
  }

  submitForReview(id: WithdrawalId): Withdrawal {
    const w = this.get(id);
    this.transition(w, WithdrawalStatus.PendingReview);
    this.log({ action: 'submit', withdrawalId: id, status: w.status, correlationId: w.correlationId });
    return w;
  }

  approve(id: WithdrawalId, by: { actor: string; note?: string }): Withdrawal {
    if (!this.authorize('approve', { actor: by.actor, withdrawalId: id })) throw new WithdrawalError('FORBIDDEN', 'Not authorized to approve.');
    const w = this.get(id);
    this.transition(w, WithdrawalStatus.Approved);
    w.approval = { actor: by.actor, at: this.clock(), note: by.note };
    this.log({ action: 'approve', withdrawalId: id, actor: by.actor, status: w.status, correlationId: w.correlationId });
    return w;
  }

  reject(id: WithdrawalId, by: { actor: string; reason: string }): Withdrawal {
    if (!this.authorize('reject', { actor: by.actor, withdrawalId: id })) throw new WithdrawalError('FORBIDDEN', 'Not authorized to reject.');
    const w = this.get(id);
    this.transition(w, WithdrawalStatus.Rejected);
    w.rejection = { actor: by.actor, at: this.clock(), note: by.reason };
    w.reason = by.reason;
    w.ledgerRefs.release = this.releaseReserve(w).id;
    this.log({ action: 'reject', withdrawalId: id, actor: by.actor, status: w.status, correlationId: w.correlationId, detail: by.reason });
    return w;
  }

  cancel(id: WithdrawalId, by: { actor: string; reason?: string }): Withdrawal {
    const w = this.get(id);
    const fromFailed = w.status === WithdrawalStatus.Failed;
    this.transition(w, WithdrawalStatus.Cancelled);
    // If funds were already committed to pending (Failed), pull them back first.
    if (fromFailed) w.ledgerRefs.release = this.treasury.releasePending(w.playerId, w.amount, { reference: w.id, correlationId: w.correlationId, idempotencyKey: `wd-uncommit:${w.id}` });
    w.ledgerRefs.release = this.releaseReserve(w).id;
    w.reason = by.reason;
    this.log({ action: 'cancel', withdrawalId: id, actor: by.actor, status: w.status, correlationId: w.correlationId });
    return w;
  }

  /** Approved → Processing: commit the reserve to pending + attempt the payout. */
  async process(id: WithdrawalId): Promise<Withdrawal> {
    const w = this.get(id);
    this.transition(w, WithdrawalStatus.Processing);
    w.ledgerRefs.commit = this.treasury.commit(w.playerId, w.amount, { reference: w.id, correlationId: w.correlationId, idempotencyKey: `wd-commit:${w.id}` });
    this.log({ action: 'process', withdrawalId: id, status: w.status, correlationId: w.correlationId });
    return this.attemptPayout(w);
  }

  /** Failed → Processing: re-attempt the payout (funds already committed). */
  async retry(id: WithdrawalId, by?: { actor: string }): Promise<Withdrawal> {
    if (by && !this.authorize('retry', { actor: by.actor, withdrawalId: id })) throw new WithdrawalError('FORBIDDEN', 'Not authorized to retry.');
    const w = this.get(id);
    this.transition(w, WithdrawalStatus.Processing);
    this.log({ action: 'retry', withdrawalId: id, actor: by?.actor, status: w.status, correlationId: w.correlationId });
    return this.attemptPayout(w);
  }

  private async attemptPayout(w: Withdrawal): Promise<Withdrawal> {
    const result = await this.payout.payout({ withdrawalId: w.id, playerId: w.playerId, amount: w.amount, currency: w.currency, method: w.method, destination: w.destination });
    if (result.ok) {
      this.transition(w, WithdrawalStatus.Completed);
      w.payoutRef = result.reference;
      const refs = this.treasury.settle(w.playerId, w.amount, { reference: w.id, correlationId: w.correlationId, idempotencyKey: `wd-settle:${w.id}` });
      w.ledgerRefs.settle = refs.settle;
      w.ledgerRefs.disburse = refs.disburse;
      this.log({ action: 'complete', withdrawalId: w.id, status: w.status, correlationId: w.correlationId });
    } else {
      this.transition(w, WithdrawalStatus.Failed);
      w.reason = result.reason;
      this.log({ action: 'fail', withdrawalId: w.id, status: w.status, correlationId: w.correlationId, detail: result.reason });
    }
    return w;
  }

  /** Completed → Reversed: return the disbursed funds to the wallet. */
  reverse(id: WithdrawalId, by: { actor: string; reason: string }): Withdrawal {
    if (!this.authorize('reverse', { actor: by.actor, withdrawalId: id })) throw new WithdrawalError('FORBIDDEN', 'Not authorized to reverse.');
    const w = this.get(id);
    this.transition(w, WithdrawalStatus.Reversed);
    w.ledgerRefs.reverse = this.treasury.reverse(w.playerId, w.amount, { reference: w.id, correlationId: w.correlationId, idempotencyKey: `wd-reverse:${w.id}`, actor: by.actor, reason: by.reason });
    w.reason = by.reason;
    this.log({ action: 'reverse', withdrawalId: id, actor: by.actor, status: w.status, correlationId: w.correlationId });
    return w;
  }

  private releaseReserve(w: Withdrawal) {
    return this.wallet.release(w.playerId, w.amount, { type: TransactionType.Release, reference: w.id, reason: 'withdrawal released', idempotencyKey: `wd-release:${w.id}`, correlationId: w.correlationId });
  }

  /* --------------------------- manual operations -------------------------- */

  manualAdjustment(playerId: string, amount: number, by: { actor: string; reason: string }): void {
    if (!this.authorize('manual_adjustment', { actor: by.actor })) throw new WithdrawalError('FORBIDDEN', 'Not authorized.');
    if (amount === 0 || !Number.isInteger(amount)) throw new WithdrawalError('INVALID_REQUEST', 'amount must be a non-zero integer');
    // WalletService records the player as ledger actor; the finance actor is captured
    // in the reason + the audit trail below.
    const reason = `${by.reason} (by ${by.actor})`;
    if (amount > 0) this.wallet.credit(playerId, amount, { type: TransactionType.Adjustment, reason });
    else this.wallet.debit(playerId, -amount, { type: TransactionType.Adjustment, reason });
    this.log({ action: 'manual_adjustment', actor: by.actor, detail: `${amount} · ${by.reason}` });
  }

  /** Force-release a stuck reservation back to the wallet (with full audit). */
  manualRelease(id: WithdrawalId, by: { actor: string; reason: string }): Withdrawal {
    if (!this.authorize('manual_release', { actor: by.actor, withdrawalId: id })) throw new WithdrawalError('FORBIDDEN', 'Not authorized.');
    const w = this.get(id);
    this.transition(w, WithdrawalStatus.Cancelled);
    w.ledgerRefs.release = this.releaseReserve(w).id;
    w.reason = by.reason;
    this.log({ action: 'manual_release', withdrawalId: id, actor: by.actor, status: w.status, detail: by.reason });
    return w;
  }

  async manualRetry(id: WithdrawalId, by: { actor: string }): Promise<Withdrawal> {
    return this.retry(id, by);
  }
  manualReversal(id: WithdrawalId, by: { actor: string; reason: string }): Withdrawal {
    return this.reverse(id, by);
  }

  /* -------------------------------- reporting ------------------------------ */

  getWithdrawal(id: WithdrawalId): Withdrawal | undefined {
    return this.items.get(id);
  }

  history(query: HistoryQuery = {}): HistoryPage {
    const { playerId, statuses, from, to, search, limit = 25, cursor } = query;
    const statusSet = statuses ? new Set(statuses) : null;
    const q = search?.trim().toLowerCase();
    let all = [...this.items.values()].filter((w) => {
      if (playerId && w.playerId !== playerId) return false;
      if (statusSet && !statusSet.has(w.status)) return false;
      if (from !== undefined && w.createdAt < from) return false;
      if (to !== undefined && w.createdAt > to) return false;
      if (q && !`${w.reference} ${w.method ?? ''} ${w.reason ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    all = all.sort((a, b) => b.createdAt - a.createdAt);
    let start = 0;
    if (cursor) {
      const idx = all.findIndex((w) => w.id === cursor);
      if (idx >= 0) start = idx + 1;
    }
    const items = all.slice(start, start + limit);
    const nextIndex = start + limit;
    return { items, total: all.length, nextCursor: nextIndex < all.length ? items[items.length - 1]?.id : undefined };
  }

  pending(): Withdrawal[] {
    return [...this.items.values()].filter((w) => [WithdrawalStatus.Requested, WithdrawalStatus.PendingReview, WithdrawalStatus.Approved, WithdrawalStatus.Processing].includes(w.status));
  }
  completed(): Withdrawal[] {
    return [...this.items.values()].filter((w) => w.status === WithdrawalStatus.Completed);
  }
  rejected(): Withdrawal[] {
    return [...this.items.values()].filter((w) => w.status === WithdrawalStatus.Rejected);
  }

  treasurySummary(): TreasurySummary {
    const bal = this.treasury.balances();
    const reconcile = this.treasury.reconcile();
    let reservedTotal = 0;
    for (const w of this.items.values()) {
      if ([WithdrawalStatus.Requested, WithdrawalStatus.PendingReview, WithdrawalStatus.Approved].includes(w.status)) reservedTotal += w.amount;
    }
    return { reservedTotal, pending: bal.pending, settlement: bal.settlement, external: bal.external, systemSum: reconcile.systemSum, balanced: reconcile.balanced };
  }

  settlementSummary(): { count: number; amount: number } {
    const done = this.completed();
    return { count: done.length, amount: done.reduce((s, w) => s + w.amount, 0) };
  }

  auditTrail(): readonly WithdrawalAuditRecord[] {
    return this.audit;
  }

  /* ----------------------------- reconciliation ---------------------------- */

  /** Cross-check withdrawals against the ledger + flag unmatched (STEP 6). */
  reconcile(): { balanced: boolean; systemSum: number; unmatched: WithdrawalId[] } {
    const report = this.treasury.reconcile();
    const bal = this.treasury.balances();
    // Pending ledger balance must equal the sum of Processing/Failed withdrawals.
    const committed = [...this.items.values()].filter((w) => [WithdrawalStatus.Processing, WithdrawalStatus.Failed].includes(w.status));
    const committedTotal = committed.reduce((s, w) => s + w.amount, 0);
    const unmatched = bal.pending !== committedTotal ? committed.map((w) => w.id) : [];
    return { balanced: report.balanced && unmatched.length === 0, systemSum: report.systemSum, unmatched };
  }
}
