import { secureId } from './crypto';
import { type GatewayRegistry } from './registry';
import {
  type DepositIntentRequest,
  type IDepositLedger,
  type NormalizedEvent,
  type PaymentAuditRecord,
  type PaymentEvent,
  PaymentEventType,
  type PaymentIntent,
  type PaymentIntentId,
  PaymentStatus,
  type ProviderIntent,
  type ProviderName,
  type WebhookRaw,
} from './types';

export class PaymentError extends Error {
  constructor(
    readonly code: 'UNKNOWN_PROVIDER' | 'INVALID_REQUEST' | 'NOT_FOUND' | 'INVALID_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

/** Validate a deposit request before any gateway call (STEP 8). */
function validateDeposit(req: DepositIntentRequest): void {
  if (!req.playerId) throw new PaymentError('INVALID_REQUEST', 'playerId required');
  if (!Number.isInteger(req.amount) || req.amount <= 0) throw new PaymentError('INVALID_REQUEST', 'amount must be a positive integer');
  if (!req.currency) throw new PaymentError('INVALID_REQUEST', 'currency required');
}

const OUTCOME_STATUS: Record<NormalizedEvent['outcome'], PaymentStatus> = {
  succeeded: PaymentStatus.Succeeded,
  failed: PaymentStatus.Failed,
  cancelled: PaymentStatus.Cancelled,
  refunded: PaymentStatus.Refunded,
  expired: PaymentStatus.Expired,
};

const EVENT_FOR_STATUS: Partial<Record<PaymentStatus, PaymentEventType>> = {
  [PaymentStatus.Succeeded]: PaymentEventType.PaymentSucceeded,
  [PaymentStatus.Failed]: PaymentEventType.PaymentFailed,
  [PaymentStatus.Cancelled]: PaymentEventType.PaymentCancelled,
  [PaymentStatus.Refunded]: PaymentEventType.PaymentRefunded,
  [PaymentStatus.Expired]: PaymentEventType.PaymentExpired,
};

export interface WebhookResult {
  accepted: boolean;
  duplicate?: boolean;
  intentId?: PaymentIntentId;
  status?: PaymentStatus;
  reason?: string;
}

/**
 * Payment service / manager (Phase 5B) — orchestrates the deposit lifecycle across
 * any number of gateways. It NEVER moves money itself: on a verified success it
 * credits the injected ledger port (which the wallet/ledger fulfils). Exactly-once
 * is enforced three ways: webhook-event dedup, an intent status guard, and the
 * ledger's own idempotency key (`deposit:<intentId>`).
 */
export class PaymentService {
  private readonly intents = new Map<PaymentIntentId, PaymentIntent>();
  private readonly byRef = new Map<string, PaymentIntentId>();
  private readonly processedEvents = new Set<string>();
  private readonly audit: PaymentAuditRecord[] = [];
  private readonly listeners = new Set<(e: PaymentEvent) => void>();

  constructor(
    private readonly registry: GatewayRegistry,
    private readonly ledger: IDepositLedger,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /* --------------------------------- events -------------------------------- */

  onEvent(handler: (e: PaymentEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }
  private emit(intent: PaymentIntent, type: PaymentEventType): void {
    const event: PaymentEvent = { type, at: this.clock(), intentId: intent.id, provider: intent.provider, status: intent.status, correlationId: intent.correlationId, amount: intent.amount };
    this.listeners.forEach((h) => h(event));
  }
  private log(rec: Omit<PaymentAuditRecord, 'at'>): void {
    this.audit.push({ at: this.clock(), ...rec });
  }

  /* ------------------------------- lifecycle ------------------------------- */

  /** Create a deposit intent + open the gateway checkout. */
  async createDeposit(req: DepositIntentRequest): Promise<{ intent: PaymentIntent; gateway: ProviderIntent }> {
    validateDeposit(req);
    const provider = this.registry.get(req.provider);
    if (!provider) throw new PaymentError('UNKNOWN_PROVIDER', `No provider '${req.provider}'`);

    const now = this.clock();
    const intent: PaymentIntent = {
      id: secureId('pi'),
      playerId: req.playerId,
      amount: req.amount,
      currency: req.currency,
      provider: req.provider,
      status: PaymentStatus.Created,
      idempotencyKey: req.idempotencyKey,
      correlationId: req.correlationId ?? secureId('corr'),
      createdAt: now,
      updatedAt: now,
      metadata: req.metadata,
    };
    this.intents.set(intent.id, intent);
    this.emit(intent, PaymentEventType.IntentCreated);
    this.log({ type: PaymentEventType.IntentCreated, intentId: intent.id, provider: intent.provider, status: intent.status, correlationId: intent.correlationId });

    const gateway = await provider.createDepositIntent(req);
    intent.providerRef = gateway.providerRef;
    intent.status = PaymentStatus.Pending;
    intent.updatedAt = this.clock();
    this.byRef.set(gateway.providerRef, intent.id);
    this.emit(intent, PaymentEventType.PaymentPending);
    return { intent, gateway };
  }

  /** Process an inbound webhook — only verified events touch the ledger (STEP 5). */
  async handleWebhook(providerName: ProviderName, raw: WebhookRaw): Promise<WebhookResult> {
    const provider = this.registry.get(providerName);
    if (!provider) return { accepted: false, reason: 'unknown provider' };
    const verification = await provider.verifyWebhook(raw);
    if (!verification.valid || !verification.event) {
      this.log({ type: PaymentEventType.WebhookRejected, provider: providerName, detail: verification.reason });
      return { accepted: false, reason: verification.reason ?? 'invalid webhook' };
    }
    const event = verification.event;
    // Replay / duplicate protection.
    if (this.processedEvents.has(event.eventId)) {
      this.log({ type: 'webhook', provider: providerName, detail: `duplicate ${event.eventId}` });
      return { accepted: true, duplicate: true };
    }
    this.processedEvents.add(event.eventId);
    return this.applyOutcome(providerName, event);
  }

  /** Process a client redirect/callback (signed params). */
  async handleCallback(providerName: ProviderName, params: Record<string, string>): Promise<WebhookResult> {
    const provider = this.registry.get(providerName);
    if (!provider) return { accepted: false, reason: 'unknown provider' };
    const v = await provider.verifyPayment(params);
    if (!v.valid || !v.providerRef || !v.outcome) {
      this.log({ type: 'callback', provider: providerName, detail: v.reason });
      return { accepted: false, reason: v.reason ?? 'invalid callback' };
    }
    return this.applyOutcome(providerName, { eventId: `cb:${v.providerRef}`, providerRef: v.providerRef, outcome: v.outcome, at: this.clock() });
  }

  private async applyOutcome(providerName: ProviderName, event: NormalizedEvent): Promise<WebhookResult> {
    const intentId = this.byRef.get(event.providerRef);
    const intent = intentId ? this.intents.get(intentId) : undefined;
    if (!intent) {
      this.log({ type: 'webhook', provider: providerName, detail: `no intent for ref ${event.providerRef}` });
      return { accepted: false, reason: 'unknown reference' };
    }
    if (event.outcome === 'succeeded') {
      await this.settleSuccess(intent, event.amount ?? intent.amount);
    } else {
      intent.status = OUTCOME_STATUS[event.outcome];
      intent.updatedAt = this.clock();
      const type = EVENT_FOR_STATUS[intent.status];
      if (type) this.emit(intent, type);
      this.log({ type: 'webhook', intentId: intent.id, provider: providerName, status: intent.status });
    }
    return { accepted: true, intentId: intent.id, status: intent.status };
  }

  /** Credit the ledger exactly once for a successful deposit (STEP 9 flow). */
  private async settleSuccess(intent: PaymentIntent, amount: number): Promise<void> {
    if (intent.status === PaymentStatus.Succeeded) return; // idempotent — already credited
    const { transactionId } = await this.ledger.credit({
      playerId: intent.playerId,
      amount,
      reference: intent.id,
      idempotencyKey: `deposit:${intent.id}`, // ledger dedupes on this too
      correlationId: intent.correlationId,
      metadata: { provider: intent.provider, providerRef: intent.providerRef, ...intent.metadata },
    });
    intent.ledgerTransactionId = transactionId;
    intent.status = PaymentStatus.Succeeded;
    intent.updatedAt = this.clock();
    this.emit(intent, PaymentEventType.PaymentSucceeded);
    this.log({ type: PaymentEventType.PaymentSucceeded, intentId: intent.id, provider: intent.provider, status: intent.status, correlationId: intent.correlationId });
  }

  /** Refund a settled deposit (reverses the wallet credit if the port supports it). */
  async refund(intentId: PaymentIntentId, amount?: number): Promise<PaymentIntent> {
    const intent = this.intents.get(intentId);
    if (!intent) throw new PaymentError('NOT_FOUND', 'no such intent');
    if (intent.status !== PaymentStatus.Succeeded) throw new PaymentError('INVALID_STATE', 'only a succeeded deposit can be refunded');
    const provider = this.registry.get(intent.provider);
    await provider?.refundPayment(intent.providerRef ?? '', amount ?? intent.amount);
    if (this.ledger.debit) {
      await this.ledger.debit({ playerId: intent.playerId, amount: amount ?? intent.amount, reference: `refund:${intent.id}`, idempotencyKey: `refund:${intent.id}`, correlationId: intent.correlationId });
    }
    intent.status = PaymentStatus.Refunded;
    intent.updatedAt = this.clock();
    this.emit(intent, PaymentEventType.PaymentRefunded);
    this.log({ type: 'refund', intentId: intent.id, provider: intent.provider, status: intent.status });
    return intent;
  }

  /* -------------------------------- queries -------------------------------- */

  getIntent(id: PaymentIntentId): PaymentIntent | undefined {
    return this.intents.get(id);
  }
  getStatus(id: PaymentIntentId): PaymentStatus | undefined {
    return this.intents.get(id)?.status;
  }
  auditTrail(): readonly PaymentAuditRecord[] {
    return this.audit;
  }
}
