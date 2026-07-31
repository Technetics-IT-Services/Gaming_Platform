/**
 * Integration registry / factory (Phase 9).
 *
 * Selects and constructs the production adapter for each capability from environment
 * configuration, all behind the FROZEN platform interfaces. Swapping a provider is a
 * config change — no code in the platform changes. Deployments call these factories
 * during wiring; the returned objects satisfy the exact interfaces the platform expects.
 */
import { type INotificationProvider } from '@/lib/crm';
import { type IPaymentProvider } from '@/lib/payments';
import { type IKMSProvider, type ISecretProvider, type ISIEMForwarder } from '@/lib/security';

import { FCMPushProvider, SESEmailProvider, TwilioSMSProvider } from './notifications';
import { PayPalProvider } from './payments-paypal';
import { AwsSecretsManagerProvider, AzureKeyVaultSecretProvider, VaultSecretProvider } from './secrets';
import { AwsKMSProvider } from './kms';
import { DatadogForwarder, ElasticForwarder, SplunkHECForwarder } from './siem';
import { GCSStorage, type IObjectStorage, S3Storage } from './storage';
import { type HttpTransport } from './transport';

export type Config = Record<string, string | undefined>;

export function paymentProvider(name: string, config: Config, http: HttpTransport): IPaymentProvider {
  switch (name) {
    case 'paypal':
      return PayPalProvider.fromConfig(config, http);
    default:
      // Stripe/Razorpay/Cashfree/PhonePe ship as the frozen Phase-5B adapters; PayPal
      // is the new production gateway added here. New rails register in this switch.
      throw new Error(`unknown payment provider: ${name}`);
  }
}

export function notificationProvider(name: string, config: Config, http: HttpTransport): INotificationProvider {
  switch (name) {
    case 'ses':
      return SESEmailProvider.fromConfig(config, http);
    case 'twilio':
      return TwilioSMSProvider.fromConfig(config, http);
    case 'fcm':
      return FCMPushProvider.fromConfig(config, http);
    default:
      throw new Error(`unknown notification provider: ${name}`);
  }
}

export function objectStorage(name: string, config: Config, http: HttpTransport): IObjectStorage {
  switch (name) {
    case 's3':
      return S3Storage.fromConfig(config, http);
    case 'gcs':
      return new GCSStorage({ accessToken: config.GCS_TOKEN ?? '' }, http);
    default:
      throw new Error(`unknown storage provider: ${name}`);
  }
}

export function secretProvider(name: string, config: Config, http: HttpTransport): ISecretProvider {
  switch (name) {
    case 'aws-secrets-manager':
      return AwsSecretsManagerProvider.fromConfig(config, http);
    case 'vault':
      return VaultSecretProvider.fromConfig(config, http);
    case 'azure-key-vault':
      return AzureKeyVaultSecretProvider.fromConfig(config, http);
    default:
      throw new Error(`unknown secret provider: ${name}`);
  }
}

export function kmsProvider(name: string, config: Config, http: HttpTransport): IKMSProvider {
  switch (name) {
    case 'aws-kms':
      return AwsKMSProvider.fromConfig(config, http);
    default:
      throw new Error(`unknown kms provider: ${name}`);
  }
}

export function siemForwarder(name: string, config: Config, http: HttpTransport): ISIEMForwarder {
  switch (name) {
    case 'splunk':
      return SplunkHECForwarder.fromConfig(config, http);
    case 'elastic':
      return ElasticForwarder.fromConfig(config, http);
    case 'datadog':
      return DatadogForwarder.fromConfig(config, http);
    default:
      throw new Error(`unknown siem forwarder: ${name}`);
  }
}
