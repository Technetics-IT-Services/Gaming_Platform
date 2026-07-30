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
 * Razorpay adapter (Phase 5B).
 *
 * Implements Razorpay's real verification schemes:
 *  - callback: HMAC-SHA256(`order_id|payment_id`, keySecret) === razorpay_signature
 *  - webhook:  HMAC-SHA256(rawBody, webhookSecret) === x-razorpay-signature
 * No network calls are made here (no live keys); `createDepositIntent` returns a
 * modeled order the client SDK would open. All Razorpay-specific logic is confined
 * to this file.
 */
export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

export class RazorpayProvider implements IPaymentProvider {
  readonly name = 'razorpay';
  constructor(private readonly config: RazorpayConfig) {}

  async createDepositIntent(req: DepositIntentRequest): Promise<ProviderIntent> {
    const providerRef = secureId('order');
    return {
      providerRef,
      checkoutUrl: `https://checkout.razorpay.com/v1/checkout.js#${providerRef}`,
      clientPayload: { orderId: providerRef, keyId: this.config.keyId, amount: req.amount, currency: req.currency },
    };
  }

  async verifyPayment(params: Record<string, string>): Promise<CallbackVerification> {
    const orderId = params.razorpay_order_id;
    const paymentId = params.razorpay_payment_id;
    const signature = params.razorpay_signature;
    if (!orderId || !paymentId || !signature) return { valid: false, reason: 'missing params' };
    const expected = await hmacSha256Hex(this.config.keySecret, `${orderId}|${paymentId}`);
    const valid = timingSafeEqual(expected, signature);
    return { valid, providerRef: orderId, outcome: valid ? 'succeeded' : 'failed', reason: valid ? undefined : 'bad signature' };
  }

  async verifyWebhook(raw: WebhookRaw): Promise<WebhookVerification> {
    const signature = raw.headers['x-razorpay-signature'];
    if (!signature) return { valid: false, reason: 'missing signature' };
    const expected = await hmacSha256Hex(this.config.webhookSecret, raw.body);
    if (!timingSafeEqual(expected, signature)) return { valid: false, reason: 'bad signature' };
    try {
      const body = JSON.parse(raw.body) as {
        event: string;
        payload: { payment: { entity: { id: string; order_id: string; amount: number } } };
      };
      const entity = body.payload.payment.entity;
      const outcome = body.event === 'payment.captured' ? 'succeeded' : body.event === 'payment.failed' ? 'failed' : 'expired';
      return {
        valid: true,
        event: {
          eventId: raw.headers['x-razorpay-event-id'] ?? entity.id,
          providerRef: entity.order_id,
          outcome,
          amount: entity.amount,
          at: Date.now(),
        },
      };
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
    return PaymentStatus.Captured;
  }
  async healthCheck(): Promise<boolean> {
    return Boolean(this.config.keyId && this.config.keySecret);
  }
}
