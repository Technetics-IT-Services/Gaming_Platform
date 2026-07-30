import { hmacSha256Base64, secureId, timingSafeEqual } from '../crypto';
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
 * Cashfree adapter (Phase 5B).
 *
 * Implements Cashfree's real webhook scheme: `x-webhook-signature` is
 * base64(HMAC-SHA256(`${x-webhook-timestamp}${rawBody}`, secretKey)), with a
 * replay-tolerance window on the timestamp.
 */
export interface CashfreeConfig {
  appId: string;
  secretKey: string;
  toleranceMs?: number;
}

export class CashfreeProvider implements IPaymentProvider {
  readonly name = 'cashfree';
  constructor(private readonly config: CashfreeConfig) {}

  async createDepositIntent(req: DepositIntentRequest): Promise<ProviderIntent> {
    const providerRef = secureId('cforder');
    return {
      providerRef,
      checkoutUrl: `https://payments.cashfree.com/order/#${providerRef}`,
      clientPayload: { orderId: providerRef, appId: this.config.appId, orderAmount: req.amount, orderCurrency: req.currency },
    };
  }

  async verifyPayment(params: Record<string, string>): Promise<CallbackVerification> {
    // Cashfree return-URL params are echoed with a signature over orderId+status.
    const orderId = params.orderId;
    const signature = params.signature;
    if (!orderId || !signature) return { valid: false, reason: 'missing params' };
    const expected = await hmacSha256Base64(this.config.secretKey, `${orderId}${params.orderStatus ?? ''}`);
    const valid = timingSafeEqual(expected, signature);
    return { valid, providerRef: orderId, outcome: valid ? 'succeeded' : 'failed' };
  }

  async verifyWebhook(raw: WebhookRaw): Promise<WebhookVerification> {
    const signature = raw.headers['x-webhook-signature'];
    const timestamp = raw.headers['x-webhook-timestamp'];
    if (!signature || !timestamp) return { valid: false, reason: 'missing signature/timestamp' };
    const tolerance = this.config.toleranceMs ?? 5 * 60_000;
    if (Math.abs(Date.now() - Number(timestamp)) > tolerance) return { valid: false, reason: 'timestamp outside tolerance (replay)' };
    const expected = await hmacSha256Base64(this.config.secretKey, `${timestamp}${raw.body}`);
    if (!timingSafeEqual(expected, signature)) return { valid: false, reason: 'bad signature' };
    try {
      const body = JSON.parse(raw.body) as {
        type: string;
        data: { order: { order_id: string }; payment: { payment_amount: number; payment_status: string; cf_payment_id: string } };
      };
      const outcome = body.data.payment.payment_status === 'SUCCESS' ? 'succeeded' : body.data.payment.payment_status === 'FAILED' ? 'failed' : 'expired';
      return {
        valid: true,
        event: { eventId: String(body.data.payment.cf_payment_id), providerRef: body.data.order.order_id, outcome, amount: body.data.payment.payment_amount, at: Date.now() },
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
    return Boolean(this.config.appId && this.config.secretKey);
  }
}
