import { secureId, sha256Hex, timingSafeEqual } from '../crypto';
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
 * PhonePe adapter (Phase 5B).
 *
 * Implements PhonePe's real X-VERIFY scheme (SHA-256, not HMAC): the header is
 * `${sha256(base64Body + endpoint + saltKey)}###${saltIndex}`. The webhook body is
 * base64-encoded JSON, so we verify the hash, then decode + parse.
 */
export interface PhonePeConfig {
  merchantId: string;
  saltKey: string;
  saltIndex: string;
  /** The endpoint path folded into the checksum (callback route). */
  callbackPath?: string;
}

export class PhonePeProvider implements IPaymentProvider {
  readonly name = 'phonepe';
  private readonly endpoint: string;
  constructor(private readonly config: PhonePeConfig) {
    this.endpoint = config.callbackPath ?? '/pg/v1/status';
  }

  async createDepositIntent(req: DepositIntentRequest): Promise<ProviderIntent> {
    const providerRef = secureId('MT'); // merchantTransactionId
    return {
      providerRef,
      checkoutUrl: `https://mercury.phonepe.com/transact/pg#${providerRef}`,
      clientPayload: { merchantTransactionId: providerRef, merchantId: this.config.merchantId, amount: req.amount },
    };
  }

  private async xVerify(base64Body: string): Promise<string> {
    const hash = await sha256Hex(base64Body + this.endpoint + this.config.saltKey);
    return `${hash}###${this.config.saltIndex}`;
  }

  async verifyPayment(params: Record<string, string>): Promise<CallbackVerification> {
    const base64 = params.response;
    const header = params.xVerify;
    if (!base64 || !header) return { valid: false, reason: 'missing params' };
    const valid = timingSafeEqual(await this.xVerify(base64), header);
    if (!valid) return { valid: false, reason: 'bad checksum' };
    return this.parse(base64, { valid: true });
  }

  async verifyWebhook(raw: WebhookRaw): Promise<WebhookVerification> {
    const header = raw.headers['x-verify'];
    if (!header) return { valid: false, reason: 'missing signature' };
    // PhonePe posts base64(JSON) as the body.
    if (!timingSafeEqual(await this.xVerify(raw.body), header)) return { valid: false, reason: 'bad checksum' };
    return this.parseWebhook(raw.body);
  }

  private decode(base64: string): { merchantTransactionId: string; amount: number; state: string } {
    const json = JSON.parse(typeof atob !== 'undefined' ? atob(base64) : Buffer.from(base64, 'base64').toString('utf8')) as {
      data: { merchantTransactionId: string; amount: number; state: string };
    };
    return json.data;
  }

  private parse(base64: string, base: { valid: true }): CallbackVerification {
    try {
      const d = this.decode(base64);
      const outcome = d.state === 'COMPLETED' ? 'succeeded' : d.state === 'FAILED' ? 'failed' : 'expired';
      return { ...base, providerRef: d.merchantTransactionId, outcome };
    } catch {
      return { valid: false, reason: 'unparseable body' };
    }
  }

  private parseWebhook(base64: string): WebhookVerification {
    try {
      const d = this.decode(base64);
      const outcome = d.state === 'COMPLETED' ? 'succeeded' : d.state === 'FAILED' ? 'failed' : 'expired';
      return { valid: true, event: { eventId: d.merchantTransactionId, providerRef: d.merchantTransactionId, outcome, amount: d.amount, at: Date.now() } };
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
    return Boolean(this.config.merchantId && this.config.saltKey);
  }
}
