/**
 * Payment platform (Phase 5B) — provider-agnostic deposit orchestration on top of
 * the Phase 5A ledger. The casino never depends on a gateway vendor; each is an
 * adapter behind `IPaymentProvider`, and money moves only through the ledger port.
 */
export * from './types';
export { PaymentService, PaymentError, type WebhookResult } from './payment-service';
export { GatewayRegistry, createGatewayRegistry, type GatewayConfigs } from './registry';
export { RazorpayProvider, type RazorpayConfig } from './providers/razorpay';
export { CashfreeProvider, type CashfreeConfig } from './providers/cashfree';
export { StripeProvider, type StripeConfig } from './providers/stripe';
export { PhonePeProvider, type PhonePeConfig } from './providers/phonepe';
export { hmacSha256Hex, hmacSha256Base64, sha256Hex, timingSafeEqual, secureId } from './crypto';
