/**
 * Production service integrations (Phase 9) — public surface.
 *
 * Production adapters that implement the FROZEN platform interfaces (payments,
 * notifications, secrets, KMS, SIEM, identity, device trust, queues). Architecture
 * and interfaces are unchanged — only adapters. Every adapter takes an injectable
 * `HttpTransport`/client, so it is contract-testable without live network and swaps
 * by configuration via the registry factories.
 */
export {
  type HttpTransport,
  type HttpRequest,
  type HttpResponse,
  FetchTransport,
  ProviderError,
  withRetry,
  sha256Hex,
  hmacSha256Hex,
  hmacSha1Base64,
  timingSafeEqual,
  requireConfig,
} from './transport';
export { PayPalProvider, type PayPalConfig } from './payments-paypal';
export { SESEmailProvider, TwilioSMSProvider, FCMPushProvider } from './notifications';
export { S3Storage, GCSStorage, type IObjectStorage, type LifecycleRule } from './storage';
export { AwsSecretsManagerProvider, VaultSecretProvider, AzureKeyVaultSecretProvider } from './secrets';
export { AwsKMSProvider, LocalKMSProvider, envelopeEncrypt, envelopeDecrypt, type Envelope } from './kms';
export { SplunkHECForwarder, ElasticForwarder, DatadogForwarder, OTelExporter, PrometheusExporter, type ITelemetryExporter } from './siem';
export { WebAuthnServerProvider, IpReputationDeviceProvider, OIDCProvider, type IOIDCProvider, type ISAMLProvider, type WebAuthnVerifier } from './identity';
export {
  RedisReliableQueue,
  type RedisClient,
  type IAsyncQueue,
  type AsyncQueueMessage,
  redisHealthProbe,
  postgresHealthProbe,
  type DatabasePool,
} from './backend';
export * as registry from './registry';
