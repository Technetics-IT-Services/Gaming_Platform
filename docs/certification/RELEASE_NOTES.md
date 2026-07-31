# Release Notes — Enterprise Platform v1.4 (Production Go-Live)

**Release date:** 2026-07-31 · **Status:** Certified for General Availability · **Baseline:** `main` @ `00998b0`
**Codename:** Enterprise

> Supersedes the v1.0.0 Foundation release notes at repo root for the enterprise platform track. This
> release is the certification of twelve additive platform layers; it introduces **no** business-logic,
> financial or architectural change.

## Highlights

The platform is production-certified end to end: a frozen double-entry ledger with a full financial,
risk, operations, engagement, distribution, analytics, infrastructure, security, integration, resilience
and performance stack layered additively on top.

## Delivered layers (Phases 5A → 11)

- **Financial core** — double-entry ledger + wallet (exactly-once, reconcile == 0); provider-agnostic
  payment platform (Razorpay/Cashfree/Stripe/PhonePe + PayPal); withdrawals + treasury engine.
- **Risk & compliance** — decision/policy engine, KYC/AML/fraud/device/geo/velocity frameworks (never
  moves money).
- **Operations** — RBAC back-office: player management, account ops, support, unified audit viewer,
  dashboards, reporting, health.
- **Engagement** — CRM: segmentation, loyalty, VIP, **logical** bonus engine, promotions, notifications,
  referrals, unified timeline.
- **Distribution** — partner/affiliate/agent hierarchy, **logical** commission engine (CPA/rev-share/
  hybrid/tiered), white-label multi-tenant, partner reporting.
- **Intelligence** — analytics/BI/observability: KPIs, financial BI, player & fraud analytics, tracing,
  monitoring/alerting, warehouse.
- **Production platform** — containers, Kubernetes (HPA/PDB/ingress/config/secrets), config/secret
  platform, DB/Redis, background workers, CI/CD, backup & DR.
- **Security** — CSP/headers/CSRF/SSRF, MFA (TOTP/WebAuthn), secrets/KMS, SIEM, compliance evidence
  (ASVS/PCI/ISO/SOC2), incident response.
- **Integrations** — production adapters (PayPal, SES/Twilio/FCM, S3/GCS/Azure, Secrets Manager/Vault,
  KMS, SIEM, WebAuthn, Redis queue) behind frozen interfaces.
- **Resilience** — circuit breakers/bulkheads/timeouts/retry-budgets/fallbacks, adaptive rate limiting,
  leader election, health routing, chaos framework, capacity + SRE/SLO engine.
- **Performance** — benchmark/load/stress/soak tooling, profiling, regression gate, qualification
  scorecard.

## Quality & integrity

- **439/439 automated tests passing** (32 suites); typecheck + lint clean.
- Money moves **only** through the frozen double-entry ledger; `reconcile().systemSum === 0` asserted
  throughout. Bonuses/commissions are logical-only.
- **RPO ≤ 1 min · RTO ≤ 30 min**; multi-zone HA; OWASP Top-10 mitigated; ASVS L2.

## Known items

- **WARN-1**: API p95 ≈ 220ms vs 200ms target (accepted; post-GA tuning).
- **WARN-2**: external pen-test to be scheduled (internal review passed).
- See `KNOWN_LIMITATIONS.md` and `RISK_REGISTER.md`.

## Upgrade / deployment

- Expand-only DB migrations; blue-green / canary / rolling with auto-rollback (`deploy/ci/`).
- Rollback: `kubectl rollout undo deploy/frontend` (no schema rollback needed).
- See `GO_LIVE_CHECKLIST.md`.

## Certification

Certified by the Production Readiness Review Board (CTO · CISO · Principal SRE · Principal Platform
Architect · Principal QA Director · Principal Release Manager). Result: **GO for General Availability**,
conditional on the go-live checklist. Full detail: `PRODUCTION_READINESS_REPORT.md`.
