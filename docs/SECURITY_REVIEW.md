# Security Review — Threat Model & Readiness (Phase 8, STEP 12)

A pen-test-readiness review of the platform with its Phase 8 security shell applied. Produced by the
security engineering role; no code was changed to write it.

## 1. Threat model (STRIDE)

**Assets:** the ledger (money), player PII, payment/webhook secrets, admin/partner/analytics access,
tenant isolation, session tokens.

| Threat | Vector | Mitigation (module) |
|---|---|---|
| **S**poofing | credential stuffing, session hijack | MFA (TOTP/WebAuthn), lockout, `__Host-` cookies, session rotation + reuse detection |
| **T**ampering | request forgery, param tampering | CSRF double-submit, input validation, output encoding, signed webhooks (Phase 5B) |
| **R**epudiation | "I didn't do it" | append-only security audit + operations/compliance/partner audits, correlation ids |
| **I**nfo disclosure | secret leakage, verbose errors, XSS | KMS/Vault secrets + masking, context encoders, strict CSP, PII masking |
| **D**oS | volumetric / app-layer | ingress rate-limit, WAF, HPA autoscaling, per-player velocity (Phase 5D) |
| **E**levation | authz bypass, IDOR | deny-by-default RBAC everywhere, tenant isolation (`assertTenant`), least privilege |

**Trust boundaries:** Internet↔Edge (TLS/WAF/headers), Edge↔App (authz + validation), App↔Data
(pooled, secret-injected), App↔external gateways (SSRF guard + signature verification).

## 2. Attack surface review

| Surface | Exposure | Controls |
|---|---|---|
| Public web / API | high | TLS+HSTS, CSP, CSRF, validation, rate-limit |
| Payment webhooks | high (money) | HMAC signature + replay window + idempotency (frozen Phase 5B) |
| Admin/partner/analytics/security APIs | medium | RBAC + MFA + audit, tenant isolation |
| Outbound integrations | medium | SSRF allow-list guard, https-only |
| Container/cluster | medium | non-root, read-only rootfs, PSA restricted, NetworkPolicy, signed images |
| Secrets | high | KMS/Vault, rotation, no-commit, secret scanning |
| CI/CD supply chain | medium | SAST/DAST/SCA/secret-scan gates, SBOM, cosign |

## 3. OWASP Top 10 (2021) review

| # | Risk | Status | Notes |
|---|---|---|---|
| A01 | Broken Access Control | ✅ | deny-by-default RBAC + tenant isolation + audit across all facades |
| A02 | Cryptographic Failures | ✅ | TLS/HSTS, KMS/Vault secrets, Web Crypto HMAC, no PAN storage |
| A03 | Injection | ✅ | validation framework + context-aware output encoding; parameterized DB (Prisma) |
| A04 | Insecure Design | ✅ | frozen double-entry ledger, exactly-once, threat model, defense-in-depth |
| A05 | Security Misconfiguration | ✅ | strict CSP/headers, PSA restricted, admission policy, config validation |
| A06 | Vulnerable Components | ✅ | SCA/Dependabot, SBOM+Grype, `--frozen-lockfile`, image scan gate |
| A07 | Auth Failures | ✅ | MFA, lockout, session rotation + reuse detection, jti blacklist |
| A08 | Integrity Failures | ✅ | signed images (cosign), SBOM attestation, admission verification |
| A09 | Logging/Monitoring Failures | ✅ | security event stream + SIEM + SOC export + threat indicators |
| A10 | SSRF | ✅ | `assertOutboundUrlSafe` https + allow-list + private-range block |

## 4. ASVS L2 checklist (summary)

V1 Architecture ✅ · V2 Authentication ✅ (MFA, lockout, password policy) · V3 Session ✅ (rotation,
reuse detection, revocation, secure cookies) · V4 Access Control ✅ (RBAC, tenant isolation) ·
V5 Validation/Encoding ✅ · V6 Cryptography ✅ (Web Crypto, KMS) · V7 Logging ✅ · V9 Communications ✅
(TLS/HSTS) · V12 Files/Resources ✅ (SSRF guard) · V14 Configuration ✅ (headers, CSP, config validation).

## 5. Production hardening checklist

See `docs/HARDENING_GUIDE.md` — network/transport, application, identity, secrets, platform,
monitoring sections. All items map to an implemented control or a documented operational gate.

## 6. Pen-test readiness checklist

- [x] Threat model + attack-surface documented.
- [x] Security headers, CSRF, validation, SSRF guard in place and tested.
- [x] MFA + session security + lockout in place and tested (incl. RFC 6238 vector).
- [x] Secret management with rotation + audit; no secrets in Git (secret-scan gate).
- [x] RBAC + tenant isolation on every admin surface, audited.
- [x] SAST/DAST/SCA/secret-scan CI hooks defined; image signing + SBOM.
- [x] Security event stream + SIEM export; incident response plan + escalation.
- [x] Compliance evidence matrix (ASVS/PCI/ISO/SOC2) with 100% control-implemented coverage.
- [ ] External pen-test engagement scheduled (owner: security-lead) — the one open item before GA.

**Verdict:** the platform is **pen-test ready**. The single outstanding action is scheduling the
external engagement; all in-scope controls are implemented, tested, and evidenced.
