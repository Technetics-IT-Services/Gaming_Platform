/**
 * Payment platform contracts (Phase 5B).
 *
 * Provider-agnostic: the casino never depends on Razorpay/Cashfree/Stripe/PhonePe.
 * Each gateway is an adapter implementing `IPaymentProvider`; the `PaymentService`
 * orchestrates the lifecycle and credits money ONLY through the ledger port
 * (`IDepositLedger`) — never a balance directly. Framework-agnostic (no React).
 */

export type ProviderName = string; // 'razorpay' | 'cashfree' | 'stripe' | 'phonepe' | …
export type PaymentIntentId = string;

/** The full payment lifecycle (STEP 6). */
export enum PaymentStatus {
  Created = 'created',
  Pending = 'pending',
  Authorized = 'authorized',
  Captured = 'captured',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Expired = 'expired',
  Refunded = 'refunded',
  Reversed = 'reversed',
}

export enum PaymentEventType {
  IntentCreated = 'intent.created',
  PaymentPending = 'payment.pending',
  PaymentSucceeded = 'payment.succeeded',
  PaymentFailed = 'payment.failed',
  PaymentCancelled = 'payment.cancelled',
  PaymentRefunded = 'payment.refunded',
  PaymentExpired = 'payment.expired',
  WebhookRejected = 'webhook.rejected',
}

/* ------------------------------- requests ------------------------------- */

export interface DepositIntentRequest {
  playerId: string;
  /** Integer minor units (never a float). */
  amount: number;
  currency: string;
  provider: ProviderName;
  idempotencyKey?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/** What a gateway returns when an order/intent is created (checkout handles). */
export interface ProviderIntent {
  providerRef: string;
  checkoutUrl?: string;
  /** Opaque gateway payload for the client SDK (order id, session token…). */
  clientPayload?: Record<string, unknown>;
}

/** Raw inbound webhook (headers + exact body bytes for signature checks). */
export interface WebhookRaw {
  headers: Record<string, string>;
  body: string;
}

/** A gateway event normalized to the platform's vocabulary. */
export interface NormalizedEvent {
  eventId: string;
  providerRef: string;
  /** Terminal outcome the platform acts on. */
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'refunded' | 'expired';
  amount?: number;
  at: number;
}

export interface WebhookVerification {
  valid: boolean;
  event?: NormalizedEvent;
  reason?: string;
}

/** Client-return (callback/redirect) verification params. */
export interface CallbackVerification {
  valid: boolean;
  providerRef?: string;
  outcome?: NormalizedEvent['outcome'];
  reason?: string;
}

export interface ProviderResult {
  ok: boolean;
  status: PaymentStatus;
  reference?: string;
  reason?: string;
}

/* ---------------------------- provider adapter --------------------------- */

/**
 * Every gateway implements this. No provider-specific logic lives outside its
 * adapter. All ops are async (they model network calls); none touch the ledger.
 */
export interface IPaymentProvider {
  readonly name: ProviderName;
  createDepositIntent(req: DepositIntentRequest): Promise<ProviderIntent>;
  /** Verify a client redirect/callback (signed params). */
  verifyPayment(params: Record<string, string>): Promise<CallbackVerification>;
  capturePayment(providerRef: string, amount: number): Promise<ProviderResult>;
  cancelPayment(providerRef: string): Promise<ProviderResult>;
  refundPayment(providerRef: string, amount: number): Promise<ProviderResult>;
  /** Verify a webhook signature + parse it into a normalized event. */
  verifyWebhook(raw: WebhookRaw): Promise<WebhookVerification>;
  queryStatus(providerRef: string): Promise<PaymentStatus>;
  healthCheck(): Promise<boolean>;
}

/* ------------------------------- intents -------------------------------- */

export interface PaymentIntent {
  id: PaymentIntentId;
  playerId: string;
  amount: number;
  currency: string;
  provider: ProviderName;
  providerRef?: string;
  status: PaymentStatus;
  idempotencyKey?: string;
  correlationId: string;
  createdAt: number;
  updatedAt: number;
  /** The ledger transaction id once the deposit is credited (exactly-once). */
  ledgerTransactionId?: string;
  metadata?: Record<string, unknown>;
}

/* --------------------------- ledger credit port -------------------------- */

/**
 * The ONLY way the payment platform moves money — an injected port to the ledger/
 * wallet. Credits are idempotent on `idempotencyKey` (exactly-once), so a repeated
 * webhook/callback credits once. Refunds reverse via `debit`.
 */
export interface IDepositLedger {
  credit(input: {
    playerId: string;
    amount: number;
    reference: string;
    idempotencyKey: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ transactionId: string }>;
  debit?(input: {
    playerId: string;
    amount: number;
    reference: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<{ transactionId: string }>;
}

/* -------------------------------- audit --------------------------------- */

export interface PaymentAuditRecord {
  at: number;
  type: PaymentEventType | 'callback' | 'webhook' | 'refund' | 'cancel';
  intentId?: PaymentIntentId;
  provider?: ProviderName;
  status?: PaymentStatus;
  correlationId?: string;
  /** Non-sensitive detail only — never secrets. */
  detail?: string;
}

export interface PaymentEvent {
  type: PaymentEventType;
  at: number;
  intentId: PaymentIntentId;
  provider: ProviderName;
  status: PaymentStatus;
  correlationId: string;
  amount?: number;
}
