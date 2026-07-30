import { CashfreeProvider, type CashfreeConfig } from './providers/cashfree';
import { PhonePeProvider, type PhonePeConfig } from './providers/phonepe';
import { RazorpayProvider, type RazorpayConfig } from './providers/razorpay';
import { StripeProvider, type StripeConfig } from './providers/stripe';
import { type IPaymentProvider, type ProviderName } from './types';

/**
 * Gateway registry + provider factory (Phase 5B). New gateways register here (or
 * via `registerProvider`) without touching the payment service or the casino —
 * open/closed. No provider is imported anywhere but this factory + its adapter.
 */
export class GatewayRegistry {
  private readonly providers = new Map<ProviderName, IPaymentProvider>();

  register(provider: IPaymentProvider): this {
    this.providers.set(provider.name, provider);
    return this;
  }
  get(name: ProviderName): IPaymentProvider | undefined {
    return this.providers.get(name);
  }
  has(name: ProviderName): boolean {
    return this.providers.has(name);
  }
  list(): ProviderName[] {
    return [...this.providers.keys()];
  }
}

/** Config for the built-in adapters (each optional — only configured gateways register). */
export interface GatewayConfigs {
  razorpay?: RazorpayConfig;
  cashfree?: CashfreeConfig;
  stripe?: StripeConfig;
  phonepe?: PhonePeConfig;
}

/** Build a registry from configs. Secrets come from the caller (env in prod). */
export function createGatewayRegistry(configs: GatewayConfigs): GatewayRegistry {
  const registry = new GatewayRegistry();
  if (configs.razorpay) registry.register(new RazorpayProvider(configs.razorpay));
  if (configs.cashfree) registry.register(new CashfreeProvider(configs.cashfree));
  if (configs.stripe) registry.register(new StripeProvider(configs.stripe));
  if (configs.phonepe) registry.register(new PhonePeProvider(configs.phonepe));
  return registry;
}
