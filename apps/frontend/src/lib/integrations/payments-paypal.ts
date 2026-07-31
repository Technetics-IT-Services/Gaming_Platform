/**
 * PayPal payment adapter (Phase 9, STEP 1).
 *
 * A production `IPaymentProvider` (the FROZEN payment interface) for PayPal Orders v2:
 * OAuth2 client-credentials auth, create order (authorize), capture, refund, webhook
 * verification via PayPal's verify-webhook-signature API, per-request idempotency,
 * retry + failure handling and a health check. It implements the existing contract —
 * it never touches the ledger or changes payment business rules.
 */
import {
  type CallbackVerification,
  type DepositIntentRequest,
  type IPaymentProvider,
  type ProviderIntent,
  type ProviderResult,
  PaymentStatus,
  type WebhookRaw,
  type WebhookVerification,
} from '@/lib/payments';

import { type HttpTransport, ProviderError, requireConfig, toBase64, withRetry } from './transport';

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  /** API base, e.g. https://api-m.paypal.com (live) or sandbox. */
  baseUrl: string;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class PayPalProvider implements IPaymentProvider {
  readonly name = 'paypal';
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly cfg: PayPalConfig,
    private readonly http: HttpTransport,
    private readonly clock: () => number = () => Date.now(),
    private readonly retry: Parameters<typeof withRetry>[1] = {},
  ) {}

  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): PayPalProvider {
    return new PayPalProvider(
      {
        clientId: requireConfig(config, 'PAYPAL_CLIENT_ID', 'paypal'),
        clientSecret: requireConfig(config, 'PAYPAL_CLIENT_SECRET', 'paypal'),
        webhookId: requireConfig(config, 'PAYPAL_WEBHOOK_ID', 'paypal'),
        baseUrl: config.PAYPAL_BASE_URL ?? 'https://api-m.paypal.com',
      },
      http,
    );
  }

  /* ------------------------------ auth (OAuth2) --------------------------- */

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.clock() + 30_000) return this.token.value;
    const basic = toBase64(new TextEncoder().encode(`${this.cfg.clientId}:${this.cfg.clientSecret}`));
    const res = await this.call('POST', '/v1/oauth2/token', { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, 'grant_type=client_credentials');
    if (res.status !== 200) throw new ProviderError('paypal', 'auth', `token failed (${res.status})`, res.status, RETRYABLE_STATUS.has(res.status));
    const json = JSON.parse(res.body) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: this.clock() + json.expires_in * 1000 };
    return json.access_token;
  }

  private async call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, headers: Record<string, string>, body?: string): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    return withRetry(
      () => this.http.request({ method, url: `${this.cfg.baseUrl}${path}`, headers, body, timeoutMs: 15_000 }),
      { ...this.retry, isRetryable: (e) => e instanceof ProviderError && e.retryable },
    );
  }

  private async authed(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<{ status: number; body: string }> {
    const token = await this.accessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (idempotencyKey) headers['PayPal-Request-Id'] = idempotencyKey; // PayPal idempotency header
    const res = await this.call(method, path, headers, body === undefined ? undefined : JSON.stringify(body));
    if (RETRYABLE_STATUS.has(res.status)) throw new ProviderError('paypal', 'server', `retryable ${res.status}`, res.status, true);
    return res;
  }

  /* ------------------------------- lifecycle ------------------------------ */

  async createDepositIntent(req: DepositIntentRequest): Promise<ProviderIntent> {
    // Integer minor units → PayPal decimal string (never mutate the platform amount).
    const value = (req.amount / 100).toFixed(2);
    const res = await this.authed(
      'POST',
      '/v2/checkout/orders',
      { intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: req.currency, value }, custom_id: req.playerId }] },
      req.idempotencyKey,
    );
    if (res.status !== 201 && res.status !== 200) throw new ProviderError('paypal', 'invalid_request', `create order ${res.status}`, res.status);
    const order = JSON.parse(res.body) as { id: string; links?: { rel: string; href: string }[] };
    return { providerRef: order.id, checkoutUrl: order.links?.find((l) => l.rel === 'approve')?.href, clientPayload: { orderId: order.id } };
  }

  async capturePayment(providerRef: string, _amount: number): Promise<ProviderResult> {
    const res = await this.authed('POST', `/v2/checkout/orders/${providerRef}/capture`, {});
    const ok = res.status === 201 || res.status === 200;
    return { ok, status: ok ? PaymentStatus.Captured : PaymentStatus.Failed, reference: providerRef, reason: ok ? undefined : `capture ${res.status}` };
  }

  async cancelPayment(providerRef: string): Promise<ProviderResult> {
    // Orders auto-expire; there is no explicit void for an unapproved order.
    return { ok: true, status: PaymentStatus.Cancelled, reference: providerRef };
  }

  async refundPayment(providerRef: string, amount: number): Promise<ProviderResult> {
    // providerRef here is the capture id.
    const res = await this.authed('POST', `/v2/payments/captures/${providerRef}/refund`, { amount: { value: (amount / 100).toFixed(2) } });
    const ok = res.status === 201 || res.status === 200;
    return { ok, status: ok ? PaymentStatus.Refunded : PaymentStatus.Failed, reference: providerRef, reason: ok ? undefined : `refund ${res.status}` };
  }

  async queryStatus(providerRef: string): Promise<PaymentStatus> {
    const res = await this.authed('GET', `/v2/checkout/orders/${providerRef}`);
    if (res.status !== 200) return PaymentStatus.Failed;
    const order = JSON.parse(res.body) as { status: string };
    return mapOrderStatus(order.status);
  }

  /* ---------------------------- verification ------------------------------ */

  /** Client return is unsigned for PayPal — completion is webhook-driven. */
  async verifyPayment(params: Record<string, string>): Promise<CallbackVerification> {
    const providerRef = params.token ?? params.orderId;
    if (!providerRef) return { valid: false, reason: 'missing order token' };
    // Confirm the real state server-side; never trust the redirect alone.
    const status = await this.queryStatus(providerRef);
    return { valid: status === PaymentStatus.Succeeded || status === PaymentStatus.Captured, providerRef, outcome: status === PaymentStatus.Captured ? 'succeeded' : undefined, reason: 'confirm via webhook' };
  }

  /** Verify a webhook using PayPal's verify-webhook-signature API (authoritative). */
  async verifyWebhook(raw: WebhookRaw): Promise<WebhookVerification> {
    const h = lower(raw.headers);
    const required = ['paypal-transmission-id', 'paypal-transmission-time', 'paypal-transmission-sig', 'paypal-cert-url', 'paypal-auth-algo'];
    if (required.some((k) => !h[k])) return { valid: false, reason: 'missing signature headers' };
    let webhookEvent: unknown;
    try {
      webhookEvent = JSON.parse(raw.body);
    } catch {
      return { valid: false, reason: 'invalid json body' };
    }
    const res = await this.authed('POST', '/v1/notifications/verify-webhook-signature', {
      transmission_id: h['paypal-transmission-id'],
      transmission_time: h['paypal-transmission-time'],
      cert_url: h['paypal-cert-url'],
      auth_algo: h['paypal-auth-algo'],
      transmission_sig: h['paypal-transmission-sig'],
      webhook_id: this.cfg.webhookId,
      webhook_event: webhookEvent,
    });
    if (res.status !== 200) return { valid: false, reason: `verify ${res.status}` };
    const verdict = JSON.parse(res.body) as { verification_status: string };
    if (verdict.verification_status !== 'SUCCESS') return { valid: false, reason: 'signature not verified' };

    const evt = webhookEvent as { id: string; event_type: string; resource?: { id?: string; custom_id?: string; amount?: { value?: string }; supplementary_data?: unknown } };
    const outcome = mapEventType(evt.event_type);
    if (!outcome) return { valid: true, reason: `ignored event ${evt.event_type}` };
    const amountStr = evt.resource?.amount?.value;
    return {
      valid: true,
      event: {
        eventId: evt.id,
        providerRef: evt.resource?.id ?? '',
        outcome,
        amount: amountStr ? Math.round(parseFloat(amountStr) * 100) : undefined,
        at: this.clock(),
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.accessToken();
      return true;
    } catch {
      return false;
    }
  }
}

function lower(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}
function mapOrderStatus(s: string): PaymentStatus {
  switch (s) {
    case 'COMPLETED':
      return PaymentStatus.Captured;
    case 'APPROVED':
      return PaymentStatus.Authorized;
    case 'CREATED':
    case 'SAVED':
      return PaymentStatus.Pending;
    case 'VOIDED':
      return PaymentStatus.Cancelled;
    default:
      return PaymentStatus.Failed;
  }
}
function mapEventType(t: string): 'succeeded' | 'failed' | 'refunded' | undefined {
  if (t === 'PAYMENT.CAPTURE.COMPLETED' || t === 'CHECKOUT.ORDER.COMPLETED') return 'succeeded';
  if (t === 'PAYMENT.CAPTURE.DENIED' || t === 'PAYMENT.CAPTURE.REVERSED') return 'failed';
  if (t === 'PAYMENT.CAPTURE.REFUNDED') return 'refunded';
  return undefined;
}
