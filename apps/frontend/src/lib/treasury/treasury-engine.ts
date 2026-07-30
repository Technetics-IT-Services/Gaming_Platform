/**
 * Treasury engine (Phase 5C, STEP 3).
 *
 * The double-entry money movements of the withdrawal lifecycle, over the Phase 5A
 * ledger. Funds travel wallet → locked (reserve) → treasury:pending (commit) →
 * treasury:settlement → external:world (settle/disburse), and reverse back on
 * cancellation/reversal. Every posting balances; nothing touches a balance
 * directly. Account naming matches `WalletService` by contract.
 */
import { EntryDirection, type Ledger, TransactionType } from '@/lib/ledger';

const PENDING = 'treasury:pending';
const SETTLEMENT = 'treasury:settlement';
const EXTERNAL = 'external:world';

export interface TreasuryOpts {
  reference?: string;
  correlationId?: string;
  idempotencyKey?: string;
  reason?: string;
  actor?: string;
}

export class TreasuryEngine {
  constructor(private readonly ledger: Ledger) {}

  private wallet(playerId: string): string {
    return `player:${playerId}:wallet`;
  }
  private locked(playerId: string): string {
    return `player:${playerId}:locked`;
  }

  /** Approved → Processing: move the reserve into the pending-withdrawal pool. */
  commit(playerId: string, amount: number, opts: TreasuryOpts = {}): string {
    const tx = this.ledger.post({
      type: TransactionType.Transfer,
      postings: [
        { account: this.locked(playerId), direction: EntryDirection.Debit, amount },
        { account: PENDING, direction: EntryDirection.Credit, amount },
      ],
      reason: opts.reason ?? 'commit to pending',
      reference: opts.reference,
      correlationId: opts.correlationId,
      idempotencyKey: opts.idempotencyKey,
      actor: opts.actor,
    });
    return tx.id;
  }

  /** Processing → Completed: recognize the settlement, then disburse to external. */
  settle(_playerId: string, amount: number, opts: TreasuryOpts = {}): { settle: string; disburse: string } {
    const recognize = this.ledger.post({
      type: TransactionType.Transfer,
      postings: [
        { account: PENDING, direction: EntryDirection.Debit, amount },
        { account: SETTLEMENT, direction: EntryDirection.Credit, amount },
      ],
      reason: 'settlement recognized',
      reference: opts.reference,
      correlationId: opts.correlationId,
      idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:recognize` : undefined,
    });
    const disburse = this.ledger.post({
      type: TransactionType.Withdrawal,
      postings: [
        { account: SETTLEMENT, direction: EntryDirection.Debit, amount },
        { account: EXTERNAL, direction: EntryDirection.Credit, amount },
      ],
      allowNegativeAccounts: [EXTERNAL],
      reason: 'disbursed to external',
      reference: opts.reference,
      correlationId: opts.correlationId,
      idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}:disburse` : undefined,
    });
    return { settle: recognize.id, disburse: disburse.id };
  }

  /** Undo a commit (Failed → Cancelled): pending → locked. */
  releasePending(playerId: string, amount: number, opts: TreasuryOpts = {}): string {
    const tx = this.ledger.post({
      type: TransactionType.Transfer,
      postings: [
        { account: PENDING, direction: EntryDirection.Debit, amount },
        { account: this.locked(playerId), direction: EntryDirection.Credit, amount },
      ],
      reason: opts.reason ?? 'release pending to reserve',
      reference: opts.reference,
      correlationId: opts.correlationId,
      idempotencyKey: opts.idempotencyKey,
    });
    return tx.id;
  }

  /** Reverse a completed disbursement (Completed → Reversed): external → wallet. */
  reverse(playerId: string, amount: number, opts: TreasuryOpts = {}): string {
    const tx = this.ledger.post({
      type: TransactionType.Reversal,
      postings: [
        { account: EXTERNAL, direction: EntryDirection.Debit, amount },
        { account: this.wallet(playerId), direction: EntryDirection.Credit, amount },
      ],
      allowNegativeAccounts: [EXTERNAL],
      reason: opts.reason ?? 'withdrawal reversal',
      reference: opts.reference,
      correlationId: opts.correlationId,
      idempotencyKey: opts.idempotencyKey,
      actor: opts.actor,
    });
    return tx.id;
  }

  balances(): { pending: number; settlement: number; external: number } {
    return {
      pending: this.ledger.balanceOf(PENDING),
      settlement: this.ledger.balanceOf(SETTLEMENT),
      external: this.ledger.balanceOf(EXTERNAL),
    };
  }

  reservedOf(playerId: string): number {
    return this.ledger.balanceOf(this.locked(playerId));
  }

  /** Prove the whole ledger (incl. treasury accounts) is consistent. */
  reconcile() {
    return this.ledger.reconcile();
  }
}
