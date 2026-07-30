'use client';

import { type GatewayConfigs, type IDepositLedger, PaymentService, createGatewayRegistry } from '@/lib/payments';

import { useDemoWallet } from './demo-wallet';

/**
 * Deposit → wallet bridge (Phase 5B).
 *
 * The payment platform credits money ONLY through this ledger port. It fulfils a
 * verified deposit by crediting the demo wallet (which posts a Deposit into the
 * authoritative ledger from Phase 5A). Exactly-once is guaranteed upstream by the
 * PaymentService (webhook dedup + intent status + the `deposit:<id>` key), so a
 * repeated webhook never double-credits. The Runtime + game providers are untouched.
 */
export const demoDepositLedger: IDepositLedger = {
  async credit(input) {
    useDemoWallet.getState().deposit(input.amount);
    const txn = useDemoWallet.getState().transactions[0];
    return { transactionId: txn?.id ?? `deposit:${input.reference}` };
  },
  async debit(input) {
    // Refund of a deposit — withdraw the funds back out.
    useDemoWallet.getState().withdraw(input.amount);
    const txn = useDemoWallet.getState().transactions[0];
    return { transactionId: txn?.id ?? `refund:${input.reference}` };
  },
};

/**
 * Demo secrets (NOT real credentials — the demo never processes real money). In
 * production these come from env / a secrets manager, never the bundle.
 */
const DEMO_CONFIGS: GatewayConfigs = {
  razorpay: { keyId: 'rzp_test_demo', keySecret: 'demo-razorpay-secret', webhookSecret: 'demo-razorpay-webhook' },
  cashfree: { appId: 'cf_test_demo', secretKey: 'demo-cashfree-secret' },
  stripe: { publishableKey: 'pk_test_demo', secretKey: 'sk_test_demo', webhookSecret: 'demo-stripe-webhook' },
  phonepe: { merchantId: 'PGTESTDEMO', saltKey: 'demo-phonepe-salt', saltIndex: '1' },
};

let service: PaymentService | null = null;

/** The shared demo payment service (all four gateways registered). */
export function getPaymentService(): PaymentService {
  if (!service) {
    service = new PaymentService(createGatewayRegistry(DEMO_CONFIGS), demoDepositLedger);
  }
  return service;
}
