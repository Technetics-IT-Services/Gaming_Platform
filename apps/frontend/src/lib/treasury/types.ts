/**
 * Withdrawal & treasury contracts (Phase 5C).
 *
 * The cash-out layer above the Phase 5A ledger. Money flows Wallet → Ledger →
 * Withdrawal Service → Treasury Engine → Payout Gateway → external. The Runtime
 * never knows withdrawals exist. Every movement is double-entry through the
 * ledger; balances are never touched directly. Framework-agnostic (no React).
 */

export type WithdrawalId = string;

/** The withdrawal approval + settlement lifecycle (STEP 4). */
export enum WithdrawalStatus {
  Draft = 'draft',
  Requested = 'requested',
  PendingReview = 'pending_review',
  Approved = 'approved',
  Rejected = 'rejected',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Reversed = 'reversed',
}

/** Which treasury account a balance belongs to (all live in the ledger). */
export enum TreasuryAccount {
  /** Player funds reserved against a pending withdrawal (`player:{id}:locked`). */
  Reserve = 'reserve',
  /** Committed withdrawals awaiting settlement (`treasury:pending`). */
  Pending = 'treasury:pending',
  /** Settled funds owed to the outside world (`treasury:settlement`). */
  Settlement = 'treasury:settlement',
  /** The external world funds are disbursed to (`external:world`). */
  External = 'external:world',
}

export interface WithdrawalRequest {
  playerId: string;
  /** Integer minor units. */
  amount: number;
  currency: string;
  /** Payout rail (upi/bank/card…) — opaque to the platform. */
  method?: string;
  /** Masked destination handle (never full account data). */
  destination?: string;
  idempotencyKey?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalMetadata {
  actor: string;
  at: number;
  note?: string;
}

/** The ledger transaction ids each lifecycle step produced (audit/reconcile). */
export interface WithdrawalLedgerRefs {
  reserve?: string;
  commit?: string;
  settle?: string;
  disburse?: string;
  release?: string;
  reverse?: string;
}

export interface Withdrawal {
  id: WithdrawalId;
  /** Human reference, e.g. `WD-000001`. */
  reference: string;
  playerId: string;
  amount: number;
  currency: string;
  status: WithdrawalStatus;
  method?: string;
  destination?: string;
  correlationId: string;
  idempotencyKey?: string;
  reason?: string;
  /** Gateway payout reference once disbursed. */
  payoutRef?: string;
  approval?: ApprovalMetadata;
  rejection?: ApprovalMetadata;
  ledgerRefs: WithdrawalLedgerRefs;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface WithdrawalLimits {
  /** Minimum per withdrawal. */
  min: number;
  /** Maximum per single withdrawal. */
  perTransaction: number;
  /** Maximum total per player per rolling day. */
  dailyMax: number;
}

/** The payout rail — a provider adapter fulfils it (injected, like the deposit port). */
export interface IPayoutGateway {
  payout(input: {
    withdrawalId: WithdrawalId;
    playerId: string;
    amount: number;
    currency: string;
    method?: string;
    destination?: string;
  }): Promise<{ ok: boolean; reference?: string; reason?: string }>;
}

/** Authorization hook for privileged actions (approve/reject/manual) — STEP 9. */
export type Authorizer = (action: string, ctx: { actor: string; withdrawalId?: WithdrawalId }) => boolean;

/** Rate-limit hook (return false to reject) — STEP 9. */
export type RateLimiter = (playerId: string) => boolean;

export interface WithdrawalAuditRecord {
  at: number;
  action: string;
  withdrawalId?: WithdrawalId;
  actor?: string;
  status?: WithdrawalStatus;
  correlationId?: string;
  /** Non-sensitive detail only. */
  detail?: string;
}

export interface HistoryQuery {
  playerId?: string;
  statuses?: WithdrawalStatus[];
  from?: number;
  to?: number;
  search?: string;
  limit?: number;
  cursor?: WithdrawalId;
}

export interface HistoryPage {
  items: Withdrawal[];
  nextCursor?: WithdrawalId;
  total: number;
}

export interface TreasurySummary {
  reservedTotal: number;
  pending: number;
  settlement: number;
  external: number;
  /** Ledger-wide double-entry sum (must be 0). */
  systemSum: number;
  balanced: boolean;
}
