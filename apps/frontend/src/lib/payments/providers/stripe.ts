import { hmacSha256Hex, secureId, timingSafeEqual } from '../crypto';
import {
  type CallbackVerification,
  type DepositIntentRequest,
  type IPaymentProvider,
  PaymentStatus,
  type ProviderIntent,
  type ProviderResult,
  type WebhookRaw,
  type WebhookVerification,
} from '../types';

/**
 * Stripe adapter (Phase 5B).
 *
 * Implements Stripe's real webhook scheme: the `Stripe-Signature` header is
 * `t=<unix>,v1=<hmac>`, verified as HMAC-SHA256(`${t}.${rawBody}`, endpointSecret)
 * with a replay-tolerance window on `t`. Stripe redirects are NOT signed, so the
 * callback path defers to the webhook (the authoritative source of truth).
 */
export interface StripeConfig {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
  /** Max age of a webhook (replay protection), default 5 minutes. */
  toleranceMs?: number;
}

export class StripeProvider implements IPaymentProvider {
  readonly name = 'stripe';
  constructor(private readonly config: StripeConfig) {}

  async createDepositIntent(req: DepositIntentRequest): Promise<ProviderIntent> {
    const providerRef = secureId('pi'); // Stripe PaymentIntent id
    return {
      providerRef,
      checkoutUrl: `https://checkout.stripe.com/pay/${providerRef}`,
      clientPayload: { paymentIntent: providerRef, clientSecret: `${providerRef}_secret`, amount: req.amount, currency: req.currency },
    };
  }

  async verifyPayment(_params: Record<string, string>): Promise<CallbackVerification> {
    // Stripe redirects are unsigned — completion is confirmed by the webhook.
    return { valid: false, reason: 'callback not signed; awaiting webhook' };
  }

  async verifyWebhook(raw: WebhookRaw): Promise<WebhookVerification> {
    const header = raw.headers['stripe-signature'];
    if (!header) return { valid: false, reason: 'missing signature' };
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
    const t = Number(parts.t);
    const v1 = parts.v1;
    if (!Number.isFinite(t) || !v1) return { valid: false, reason: 'malformed signature' };
    const tolerance = this.config.toleranceMs ?? 5 * 60_000;
    if (Math.abs(Date.now() - t * 1000) > tolerance) return { valid: false, reason: 'timestamp outside tolerance (replay)' };
    const expected = await hmacSha256Hex(this.config.webhookSecret, `${t}.${raw.body}`);
    if (!timingSafeEqual(expected, v1)) return { valid: false, reason: 'bad signature' };
    try {
      const body = JSON.parse(raw.body) as {
        id: string;
        type: string;
        data: { object: { id: string; amount: number } };
      };
      const obj = body.data.object;
      const outcome =
        body.type === 'payment_intent.succeeded'
          ? 'succeeded'
          : body.type === 'payment_intent.payment_failed'
            ? 'failed'
            : body.type === 'payment_intent.canceled'
              ? 'cancelled'
              : body.type === 'charge.refunded'
                ? 'refunded'
                : 'expired';
      return { valid: true, event: { eventId: body.id, providerRef: obj.id, outcome, amount: obj.amount, at: Date.now() } };
    } catch {
      return { valid: false, reason: 'unparseable body' };
    }
  }

  async capturePayment(providerRef: string, _amount: number): Promise<ProviderResult> {
    return { ok: true, status: PaymentStatus.Captured, reference: providerRef };
  }
  async cancelPayment(providerRef: string): Promise<ProviderResult> {
    return { ok: true, status: PaymentStatus.Cancelled, reference: providerRef };
  }
  async refundPayment(providerRef: string, _amount: number): Promise<ProviderResult> {
    return { ok: true, status: PaymentStatus.Refunded, reference: providerRef };
  }
  async queryStatus(_providerRef: string): Promise<PaymentStatus> {
    return PaymentStatus.Succeeded;
  }
  async healthCheck(): Promise<boolean> {
    return Boolean(this.config.secretKey);
  }
}
