import { describe, expect, it } from 'vitest';

import { hmacSha256Base64, hmacSha256Hex, secureId, sha256Hex, timingSafeEqual } from './crypto';
import { CashfreeProvider } from './providers/cashfree';
import { PhonePeProvider } from './providers/phonepe';
import { RazorpayProvider } from './providers/razorpay';
import { StripeProvider } from './providers/stripe';
import { PaymentService } from './payment-service';
import { createGatewayRegistry } from './registry';
import { type IDepositLedger, PaymentStatus, type WebhookRaw } from './types';

/**
 * Payment platform (Phase 5B). Verifies each gateway's real signature scheme,
 * webhook verification/replay/dedup, the deposit lifecycle, ledger integration,
 * and exactly-once completion. Signatures are computed with the same crypto the
 * adapters use + a test secret, so verification is symmetric and honest.
 */

/** A mock ledger port that dedupes on the idempotency key (like the real ledger). */
function mockLedger() {
  const credits: { amount: number; key: string }[] = [];
  const byKey = new Map<string, string>();
  const port: IDepositLedger = {
    async credit(input) {
      const existing = byKey.get(input.idempotencyKey);
      if (existing) return { transactionId: existing };
      const id = `tx_${credits.length + 1}`;
      byKey.set(input.idempotencyKey, id);
      credits.push({ amount: input.amount, key: input.idempotencyKey });
      return { transactionId: id };
    },
    async debit() {
      return { transactionId: 'rev_1' };
    },
  };
  return { port, credits };
}

const CONFIGS = {
  razorpay: { keyId: 'k', keySecret: 'rzp-secret', webhookSecret: 'rzp-wh' },
  cashfree: { appId: 'a', secretKey: 'cf-secret' },
  stripe: { publishableKey: 'pk', secretKey: 'sk', webhookSecret: 'stripe-wh' },
  phonepe: { merchantId: 'M', saltKey: 'pp-salt', saltIndex: '1' },
};

describe('crypto helpers', () => {
  it('HMAC/SHA are deterministic and timing-safe compare works', async () => {
    expect(await hmacSha256Hex('s', 'msg')).toBe(await hmacSha256Hex('s', 'msg'));
    expect(await hmacSha256Hex('s', 'msg')).not.toBe(await hmacSha256Hex('s2', 'msg'));
    expect(await hmacSha256Base64('s', 'msg')).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect((await sha256Hex('abc')).length).toBe(64);
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
    expect(secureId('pi')).toMatch(/^pi_[0-9a-f]{32}$/);
  });
});

describe('Razorpay adapter', () => {
  const p = new RazorpayProvider(CONFIGS.razorpay);

  it('verifies a correct callback signature and rejects a bad one', async () => {
    const sig = await hmacSha256Hex('rzp-secret', 'order_1|pay_1');
    expect((await p.verifyPayment({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: sig })).valid).toBe(true);
    expect((await p.verifyPayment({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'bad' })).valid).toBe(false);
  });

  it('verifies a signed webhook and rejects a tampered body', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 50000 } } } });
    const raw: WebhookRaw = { headers: { 'x-razorpay-signature': await hmacSha256Hex('rzp-wh', body), 'x-razorpay-event-id': 'evt_1' }, body };
    const ok = await p.verifyWebhook(raw);
    expect(ok.valid).toBe(true);
    expect(ok.event?.outcome).toBe('succeeded');
    expect(ok.event?.providerRef).toBe('order_1');
    const tampered = await p.verifyWebhook({ ...raw, body: body.replace('50000', '99999') });
    expect(tampered.valid).toBe(false);
  });
});

describe('Stripe adapter', () => {
  const p = new StripeProvider(CONFIGS.stripe);
  const sign = async (body: string, t: number) => `t=${t},v1=${await hmacSha256Hex('stripe-wh', `${t}.${body}`)}`;

  it('verifies a fresh signed webhook and rejects replays + bad signatures', async () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', amount: 50000 } } });
    const now = Math.floor(Date.now() / 1000);
    expect((await p.verifyWebhook({ headers: { 'stripe-signature': await sign(body, now) }, body })).valid).toBe(true);
    // Replay: an hour-old timestamp is outside tolerance.
    expect((await p.verifyWebhook({ headers: { 'stripe-signature': await sign(body, now - 3600) }, body })).reason).toMatch(/replay/);
    expect((await p.verifyWebhook({ headers: { 'stripe-signature': `t=${now},v1=deadbeef` }, body })).valid).toBe(false);
  });
});

describe('Cashfree adapter', () => {
  const p = new CashfreeProvider(CONFIGS.cashfree);
  it('verifies a base64-HMAC webhook and rejects a bad signature', async () => {
    const body = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: 'cf_1' }, payment: { payment_amount: 500, payment_status: 'SUCCESS', cf_payment_id: 991 } } });
    const ts = String(Date.now());
    const sig = await hmacSha256Base64('cf-secret', `${ts}${body}`);
    const ok = await p.verifyWebhook({ headers: { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts }, body });
    expect(ok.valid).toBe(true);
    expect(ok.event?.outcome).toBe('succeeded');
    expect((await p.verifyWebhook({ headers: { 'x-webhook-signature': 'bad', 'x-webhook-timestamp': ts }, body })).valid).toBe(false);
  });
});

describe('PhonePe adapter', () => {
  const p = new PhonePeProvider(CONFIGS.phonepe);
  it('verifies the SHA-256 X-VERIFY checksum and rejects tampering', async () => {
    const payload = { data: { merchantTransactionId: 'MT_1', amount: 50000, state: 'COMPLETED' } };
    const base64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    const header = `${await sha256Hex(base64 + '/pg/v1/status' + 'pp-salt')}###1`;
    const ok = await p.verifyWebhook({ headers: { 'x-verify': header }, body: base64 });
    expect(ok.valid).toBe(true);
    expect(ok.event?.providerRef).toBe('MT_1');
    expect((await p.verifyWebhook({ headers: { 'x-verify': 'nope###1' }, body: base64 })).valid).toBe(false);
  });
});

describe('PaymentService — deposit lifecycle', () => {
  const build = () => {
    const ledger = mockLedger();
    const svc = new PaymentService(createGatewayRegistry(CONFIGS), ledger.port);
    return { svc, ledger };
  };
  const razorpayWebhook = async (orderRef: string, eventId: string, event = 'payment.captured') => {
    const body = JSON.stringify({ event, payload: { payment: { entity: { id: 'pay_x', order_id: orderRef, amount: 50000 } } } });
    return { headers: { 'x-razorpay-signature': await hmacSha256Hex('rzp-wh', body), 'x-razorpay-event-id': eventId }, body } as WebhookRaw;
  };

  it('creates an intent, then a verified webhook credits the ledger and succeeds', async () => {
    const { svc, ledger } = build();
    const { intent } = await svc.createDeposit({ playerId: 'p', amount: 50000, currency: 'INR', provider: 'razorpay' });
    expect(intent.status).toBe(PaymentStatus.Pending);
    const res = await svc.handleWebhook('razorpay', await razorpayWebhook(intent.providerRef!, 'evt_1'));
    expect(res.accepted).toBe(true);
    expect(svc.getStatus(intent.id)).toBe(PaymentStatus.Succeeded);
    expect(ledger.credits).toHaveLength(1);
    expect(ledger.credits[0]!.amount).toBe(50000);
    expect(svc.getIntent(intent.id)?.ledgerTransactionId).toBeDefined();
  });

  it('credits exactly once under duplicate + replayed webhooks', async () => {
    const { svc, ledger } = build();
    const { intent } = await svc.createDeposit({ playerId: 'p', amount: 50000, currency: 'INR', provider: 'razorpay' });
    await svc.handleWebhook('razorpay', await razorpayWebhook(intent.providerRef!, 'evt_1'));
    // Same event id → deduped.
    const dup = await svc.handleWebhook('razorpay', await razorpayWebhook(intent.providerRef!, 'evt_1'));
    expect(dup.duplicate).toBe(true);
    // Different event id, same intent → status guard + ledger key ⇒ still once.
    await svc.handleWebhook('razorpay', await razorpayWebhook(intent.providerRef!, 'evt_2'));
    expect(ledger.credits).toHaveLength(1);
  });

  it('rejects an unsigned/invalid webhook without touching the ledger', async () => {
    const { svc, ledger } = build();
    const { intent } = await svc.createDeposit({ playerId: 'p', amount: 50000, currency: 'INR', provider: 'razorpay' });
    const bad = await svc.handleWebhook('razorpay', { headers: { 'x-razorpay-signature': 'wrong' }, body: '{}' });
    expect(bad.accepted).toBe(false);
    expect(svc.getStatus(intent.id)).toBe(PaymentStatus.Pending);
    expect(ledger.credits).toHaveLength(0);
  });

  it('records a failed payment without crediting', async () => {
    const { svc, ledger } = build();
    const { intent } = await svc.createDeposit({ playerId: 'p', amount: 50000, currency: 'INR', provider: 'razorpay' });
    await svc.handleWebhook('razorpay', await razorpayWebhook(intent.providerRef!, 'evt_f', 'payment.failed'));
    expect(svc.getStatus(intent.id)).toBe(PaymentStatus.Failed);
    expect(ledger.credits).toHaveLength(0);
  });

  it('completes via a signed callback (Razorpay redirect)', async () => {
    const { svc, ledger } = build();
    const { intent } = await svc.createDeposit({ playerId: 'p', amount: 25000, currency: 'INR', provider: 'razorpay' });
    const sig = await hmacSha256Hex('rzp-secret', `${intent.providerRef}|pay_cb`);
    const res = await svc.handleCallback('razorpay', { razorpay_order_id: intent.providerRef!, razorpay_payment_id: 'pay_cb', razorpay_signature: sig });
    expect(res.accepted).toBe(true);
    expect(svc.getStatus(intent.id)).toBe(PaymentStatus.Succeeded);
    expect(ledger.credits).toHaveLength(1);
  });

  it('refunds a succeeded deposit', async () => {
    const { svc } = build();
    const { intent } = await svc.createDeposit({ playerId: 'p', amount: 50000, currency: 'INR', provider: 'razorpay' });
    await svc.handleWebhook('razorpay', await razorpayWebhook(intent.providerRef!, 'evt_1'));
    const refunded = await svc.refund(intent.id);
    expect(refunded.status).toBe(PaymentStatus.Refunded);
    // Already refunded → no longer succeeded → rejected.
    await expect(svc.refund(intent.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('validates the request and unknown providers', async () => {
    const { svc } = build();
    await expect(svc.createDeposit({ playerId: 'p', amount: -5, currency: 'INR', provider: 'razorpay' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(svc.createDeposit({ playerId: 'p', amount: 100, currency: 'INR', provider: 'paytm' })).rejects.toMatchObject({ code: 'UNKNOWN_PROVIDER' });
  });

  it('emits lifecycle events + writes an audit trail', async () => {
    const { svc } = build();
    const seen: string[] = [];
    svc.onEvent((e) => seen.push(e.type));
    const { intent } = await svc.createDeposit({ playerId: 'p', amount: 50000, currency: 'INR', provider: 'stripe' });
    // Stripe: complete via a signed webhook.
    const body = JSON.stringify({ id: 'evt_s', type: 'payment_intent.succeeded', data: { object: { id: intent.providerRef, amount: 50000 } } });
    const t = Math.floor(Date.now() / 1000);
    await svc.handleWebhook('stripe', { headers: { 'stripe-signature': `t=${t},v1=${await hmacSha256Hex('stripe-wh', `${t}.${body}`)}` }, body });
    expect(seen).toContain('intent.created');
    expect(seen).toContain('payment.succeeded');
    expect(svc.auditTrail().some((a) => a.type === 'payment.succeeded')).toBe(true);
    // No secrets in the audit trail.
    expect(JSON.stringify(svc.auditTrail())).not.toContain('stripe-wh');
  });
});

describe('multi-gateway registry', () => {
  it('registers all four gateways and stays open to new ones', () => {
    const reg = createGatewayRegistry(CONFIGS);
    expect(reg.list().sort()).toEqual(['cashfree', 'phonepe', 'razorpay', 'stripe']);
    expect(reg.has('razorpay')).toBe(true);
    expect(reg.get('paytm')).toBeUndefined();
  });
});
