# Security Architecture (Phase 8)

> Security that **wraps** the frozen Enterprise Platform. No business, financial or
> infrastructure logic was modified. Module: `apps/frontend/src/lib/security/`.

## Principle

Defense-in-depth as an outer shell. Every layer is a framework-agnostic, testable
building block the app/edge composes around the frozen platform — it observes, gates
and coordinates, but never rewrites the platform.

```
        Client
          │  TLS + HSTS
   ┌──────▼───────────────────────────────────────────────┐
   │ Edge / App middleware                                  │
   │  security headers (CSP/HSTS/frame/referrer/permissions)│
   │  secure cookies · CSRF (double-submit) · rate-limit    │
   │  input validation · output encoding · SSRF guard       │
   ├───────────────────────────────────────────────────────┤
   │ Identity: MFA (TOTP/WebAuthn) · password + lockout      │
   │           policy · sessions (rotation + reuse-detect)   │
   ├───────────────────────────────────────────────────────┤
   │ Secrets: KMS/Vault-backed, versioned, rotated, audited  │
   ├───────────────────────────────────────────────────────┤
   │ Monitoring: security events → SIEM · threat indicators  │
   │ Evidence: control registry (ASVS/PCI/ISO/SOC2)          │
   │ Incident: model · severity · escalation · forensics     │
   └───────────────────────┬───────────────────────────────┘
                           │  reads only
                 FROZEN Enterprise Platform (unchanged)
```

## 1. Application security (`headers.ts`, `validation.ts`)

- **CSP** — strict, nonce-based (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`).
- **Headers** — HSTS (2y, preload), `X-Content-Type-Options`, `X-Frame-Options: DENY`, Referrer-Policy,
  COOP/CORP, Permissions-Policy (deny geolocation/camera/mic/usb, opt out of Topics).
- **Cookies** — `secureCookie()` emits `HttpOnly; Secure; SameSite` with the `__Host-` prefix option.
- **CSRF** — double-submit token with constant-time compare.
- **XSS** — context-aware output encoders (`encode.html/htmlAttr/js/url`).
- **Input validation** — declarative schema validator that aggregates all errors.
- **SSRF** — `assertOutboundUrlSafe` enforces https + host allow-list + rejects private/loopback IPs.

## 2. Identity security (`identity.ts`)

- **MFA** — RFC 6238 TOTP over Web Crypto (SHA-1), drift window, provisioning URI; WebAuthn provider
  interface for passkeys.
- **Passwords** — configurable policy (length + char classes + breached denylist).
- **Lockout** — N failures / window → timed lock.
- **Sessions** — refresh-token **rotation** with **reuse detection** (a replayed token = theft → whole
  session revoked), `revokeAllForUser`, and an access-token (jti) **blacklist**.

## 3. Secret management (`secrets.ts`)

`SecretManager` fronts any `ISecretProvider` (in-memory reference; production binds KMS/Vault/cloud).
Key **versioning** + **rotation** (old versions readable for grace-period decryption) + an access
**audit** by reference (raw values are never logged). `IKMSProvider` / `IVaultProvider` interfaces
define envelope encryption + dynamic secrets.

## 4. Security monitoring (`monitoring.ts`)

Append-only **security event** stream (auth, authz, CSRF, SSRF, secret access, anomalies), **threat
indicators** (IOC registry), **anomaly** contracts, an `ISIEMForwarder` (auto-forwards High/Critical),
and a **SOC export** with severity rollup.

## 5. Compliance evidence (`compliance-evidence.ts`)

A control registry with **framework mappings** (OWASP ASVS, PCI DSS, ISO 27001, SOC2), an evidence
registry, a policy registry, coverage metrics and an auditor-ready export matrix. See
`docs/COMPLIANCE_MAPPING.md`.

## 6. Incident response (`incident.ts`)

An incident model with severity classification, a validated lifecycle, an **escalation matrix**, and a
**forensic checklist** that gates closing a SEV1/SEV2. See `docs/INCIDENT_RESPONSE.md`.

## 7. Read-only API surface (`security-platform.ts`)

`SecurityPlatform` is the RBAC-enforced facade (5 roles) exposing security events, SOC/evidence
exports, policies, incidents and the production header set — every call permission-checked and
audited (allow AND deny). All read-only; it never mutates the platform.
