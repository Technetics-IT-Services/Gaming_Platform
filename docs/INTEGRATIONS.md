# Production Service Integrations (Phase 9)

> Only adapters. Architecture and interfaces are frozen — every adapter implements an
> existing platform interface and swaps by configuration. Module:
> `apps/frontend/src/lib/integrations/`. No business, financial or architectural logic changed.

## Adapter matrix

| Capability | Interface (frozen) | Adapters | Notes |
|---|---|---|---|
| Payments | `IPaymentProvider` (payments) | **PayPal** (new, full) | Stripe/Razorpay/Cashfree/PhonePe ship as the frozen Phase-5B adapters |
| Email | `INotificationProvider` (crm) | **SES**, SMTP | SNS bounce/delivery webhook verify |
| SMS | `INotificationProvider` | **Twilio** | authentic `X-Twilio-Signature` (HMAC-SHA1) verify |
| Push | `INotificationProvider` | **FCM**, OneSignal | HTTP v1 |
| Object storage | `IObjectStorage` (new) | **S3** (SigV4 presign), **GCS**, Azure Blob | uploads/downloads/signed-URL/SSE/versioning/lifecycle |
| Secrets | `ISecretProvider` (security) | **AWS Secrets Manager**, **Vault**, **Azure KV**, GCP | Vault also implements `IVaultProvider` |
| KMS | `IKMSProvider` (security) | **AWS KMS**, GCP KMS, Azure Keys, **LocalKMS** | envelope AES-256-GCM |
| SIEM | `ISIEMForwarder` (security) | **Splunk HEC**, **Elastic**, **Datadog**, Sentinel | + OTel/Prometheus exporters |
| Identity | `IWebAuthnProvider` (security), `IDeviceTrustProvider` (compliance) | **WebAuthn server**, **IP-reputation**, **OIDC** | SAML interface for a downstream adapter |
| Queue | `IAsyncQueue` (new) | **Redis reliable queue** + DLQ | `LMOVE` reserve, retry, dead-letter |
| Database | health probe | **Postgres pool** probe | `SELECT 1` + pool saturation |

Every adapter takes an injectable `HttpTransport` (or client), so it is **contract-testable
without live network** and is selected via `registry.ts` factories from environment config.

## Design invariants

- **Interfaces frozen** — adapters `implement` the existing interface; the platform is unaware which
  concrete adapter is wired.
- **Idempotency preserved** — e.g. PayPal sends `PayPal-Request-Id`; the frozen payment platform's
  exactly-once ledger credit is unchanged.
- **Retries** — `withRetry` (exponential backoff) wraps transient (5xx/429/network) failures; auth/4xx
  are non-retryable.
- **Verification** — webhooks are verified by the provider's authentic scheme (PayPal verify-signature
  API, Twilio HMAC-SHA1, SNS topic-ARN) before the platform acts.
- **No money movement** — payment adapters never touch the ledger; that stays the frozen `IDepositLedger` port.

## Credentials & configuration

Adapters read credentials from an injected config map (backed by the Phase-8 secret providers, never
committed). Required keys per provider:

| Provider | Keys |
|---|---|
| PayPal | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_BASE_URL` |
| SES | `SES_REGION`, `SES_FROM` |
| Twilio | `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` |
| FCM | `FCM_PROJECT_ID`, `FCM_ACCESS_TOKEN` |
| S3 | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| AWS Secrets Manager / KMS | `AWS_REGION` (+ IAM role) |
| Vault | `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_MOUNT` |
| Azure KV | `AZURE_KV_URL`, `AZURE_KV_TOKEN` |
| Splunk / Elastic / Datadog | `SPLUNK_HEC_URL`+`_TOKEN` / `ELASTIC_URL`+`_API_KEY` / `DATADOG_API_KEY` |
| IP reputation | `IPREP_URL`, `IPREP_API_KEY` |

Prefer IAM roles / workload identity / Vault dynamic secrets over static keys where the cloud allows.

## Deployment & operations

- Wire adapters at process start via `registry.*(name, config, transport)`; the returned object
  satisfies the exact frozen interface the platform expects.
- **Workers** (Phase 7) drive the Redis reliable queue: `reserve → handle → ack` / `nack` (retry) /
  dead-letter on exhaustion; the frozen infra retry/backoff/scheduler concepts apply unchanged.
- **Health** — `redisHealthProbe` / `postgresHealthProbe` plug into the Phase-7 `HealthRegistry`
  readiness endpoint.
- **Monitoring** — security events forward to SIEM (`ISIEMForwarder`); OTel/Prometheus exporters feed
  the observability stack.

## Rotation

- **Secrets** — rotate via the Phase-8 `SecretManager` (new version; old readable for grace decryption);
  adapters read the current version each call, so rotation is transparent.
- **KMS keys** — CMK rotation is provider-managed; envelope data keys are per-object, so rotating the
  CMK re-wraps new data keys without re-encrypting existing blobs.
- **Payment/webhook secrets** — rotate the gateway secret + `PAYPAL_WEBHOOK_ID`; verification reads the
  current config.
- **API tokens** (Twilio/SES/Datadog/Splunk) — rotate in the secret store; restart or hot-reload config.

## Disaster recovery

- Adapters are stateless — recovery is redeploy + reconnect. The reliable queue's `processing` list
  makes in-flight jobs recoverable after a worker crash. Object-storage lifecycle + versioning protect
  backups. Ledger/treasury recovery is unchanged (see `docs/DISASTER_RECOVERY.md`); post-recovery
  validation still asserts `ledger.reconcile().systemSum === 0`.

## Testing

`integrations.test.ts` contract-tests every adapter against the frozen interfaces with a mock transport
+ fake Redis: retry/failover, PayPal order/capture/webhook + idempotency header, Twilio HMAC-SHA1
signature, S3 SigV4 presign determinism, secret round-trips, envelope AES-GCM encrypt/decrypt, SIEM
forward, WebAuthn challenge lifecycle, and the reliable queue + DLQ + health probes (15 tests).
