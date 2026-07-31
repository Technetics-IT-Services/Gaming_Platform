# Known Limitations & Accepted WARN Items — Enterprise Platform v1.4

None of the below is a blocker for General Availability. Each is either an operational tuning item, a
deployment-wiring step, or a post-GA attestation. **No frozen module requires a code change** to close
any of them.

## Accepted WARN items

| ID | Item | Impact | Owner | Plan |
|---|---|---|---|---|
| WARN-1 | API p95 ≈ 220ms vs 200ms target | Latency marginally over target (within warn band; p99 within target) | SRE | Edge caching / pool tuning post-GA; regression-gated |
| WARN-2 | External penetration test not yet executed | Security assurance (internal review complete: OWASP/ASVS pass) | CISO | Schedule external engagement in the first GA month |

## Deployment-wiring items (adapters ready; bind at deploy)

| Area | Ships as | Bind at deploy |
|---|---|---|
| Secrets/KMS | `ISecretProvider`/`IKMSProvider` adapters (AWS/Vault/Azure/GCP) | real credentials/roles + secret manager |
| Queue backend | `IAsyncQueue` Redis reliable queue | real Redis client (ioredis/node-redis) |
| SIEM | Splunk/Elastic/Datadog forwarders | endpoint + token |
| WebAuthn | `IWebAuthnProvider` + verifier seam | `@simplewebauthn/server` verifier |
| Payment rails | PayPal (new, full); Stripe/Razorpay/Cashfree/PhonePe (frozen 5B adapters) | gateway credentials + webhook ids |
| Resilience wrappers | `Resilience.run(...)` around integration call sites | wire at call sites (consumes module) |
| SLI feeds | `SLOTracker` inputs | pipe observability good/bad + latency events |

## In-memory reference stores (swap for persistence on backend lift)

Several modules ship with in-memory stores as the reference implementation behind their ports
(operations state, CRM engagement, partner data, security sessions/events, analytics events, infra
config/queue, perf baselines). Production binds the persistence port; **domain logic and interfaces do
not change.**

## Intentionally not implemented (by design / out of scope per phase rules)

- No KYC/AML/fraud **decisioning** models beyond the framework hooks (mock providers ship).
- No Finance/Admin/Partner **portal UI** (backend/API layers only).
- No BI dashboards UI (analytics is API-only).
- Bonus→cash and commission→cash **conversion** are deferred Treasury/Operations concerns (logical-only tracking).
- Deposit/login-side compliance gating is available but only the withdrawal path is wired end-to-end
  (deposits gate via `evaluate` when the payment layer opts in — preserves the "no payment change" rule).

## Standard post-GA follow-ups

- External pen-test (WARN-2); formal PCI DSS / SOC2 / ISO 27001 attestations.
- Continuous profiling (native `--prof`/heap) and real staging load runs feeding `qualify(...)`.
- Persist regression baselines and gate CI on the comparison.
