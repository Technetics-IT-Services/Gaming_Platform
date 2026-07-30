import { beforeEach, describe, expect, it } from 'vitest';

import { hmacSha256Hex, type WebhookRaw } from '@/lib/payments';
import { useDemoWallet } from './demo-wallet';
import { getPaymentService } from './deposit-adapter';

/**
 * Deposit → wallet end-to-end (Phase 5B). A verified gateway webhook flows through
 * the PaymentService → ledger port → demo wallet (which posts to the Phase 5A
 * ledger). Exactly-once: a duplicate webhook never double-credits. The Runtime +
 * game providers are never involved.
 */
beforeEach(() => {
  useDemoWallet.getState().reset();
});

describe('deposit lifecycle credits the demo wallet', () => {
  it('a verified webhook credits the wallet exactly once', async () => {
    const svc = getPaymentService();
    const { intent } = await svc.createDeposit({ playerId: 'demo-player', amount: 1000, currency: 'INR', provider: 'razorpay' });

    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_e2e', order_id: intent.providerRef, amount: 1000 } } } });
    const raw: WebhookRaw = {
      headers: { 'x-razorpay-signature': await hmacSha256Hex('demo-razorpay-webhook', body), 'x-razorpay-event-id': `evt_${intent.id}` },
      body,
    };

    await svc.handleWebhook('razorpay', raw);
    expect(useDemoWallet.getState().balance).toBe(1000);
    expect(useDemoWallet.getState().transactions[0]?.type).toBe('deposit');

    // Duplicate webhook (same event id) — deduped, no double credit.
    await svc.handleWebhook('razorpay', raw);
    expect(useDemoWallet.getState().balance).toBe(1000);
  });

  it('an invalid webhook never credits the wallet', async () => {
    const svc = getPaymentService();
    const { intent } = await svc.createDeposit({ playerId: 'demo-player', amount: 500, currency: 'INR', provider: 'razorpay' });
    const res = await svc.handleWebhook('razorpay', { headers: { 'x-razorpay-signature': 'forged' }, body: '{}' });
    expect(res.accepted).toBe(false);
    expect(useDemoWallet.getState().balance).toBe(0);
    expect(svc.getStatus(intent.id)).toBe('pending');
  });
});
