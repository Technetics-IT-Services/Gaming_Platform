# Tenant Security (Phase 3.2, STEP 16 & 17)

Modules: `control-plane/rbac.ts`, `control-plane/control-plane.ts`, `control-plane/crypto.ts`,
`control-plane/secret-namespace-service.ts`. Security rule:

```
tenant context  +  authorization  +  resource ownership
must ALL agree before a tenant resource is accessed.
```

## RBAC (STEP 16) — deny by default

Roles: **Platform Super Admin**, **Tenant Admin**, **Tenant Operator**, **Tenant Finance**, **Tenant
Support**, **Tenant Auditor**, **Read Only**. Each maps to an explicit permission set; anything not granted
is denied.

```ts
authorize(auth, permission, resourceTenantId): { allowed, reason }
```

- Missing permission → denied.
- Tenant-scoped actor + `resourceTenantId ≠ auth.tenantId` → **cross-tenant access denied**.
- Platform Super Admin (or `tenantId: '*'`) → may act on any tenant.
- Every denied operation is **audited** (`result: 'deny'`).

## Threats mitigated (STEP 17)

| Threat | Mitigation |
|---|---|
| **IDOR / tenant breakout** | `authorize` requires ownership; a Tenant Admin of A cannot touch B (tested) |
| **Domain takeover** | globally-unique non-removed hostname; verification required before Active |
| **API key leakage** | hash-only storage; plaintext shown once; audit redaction; never logged |
| **Privilege escalation** | deny-by-default RBAC; role→permission map is explicit and minimal |
| **Configuration tampering** | optimistic concurrency + immutable versions + full audit |
| **Replayed lifecycle transitions** | validated transitions; same-state transition is an idempotent no-op |
| **Concurrent update corruption** | version checks → `CONFLICT`; never a silent overwrite |
| **Secret leakage** | only opaque references persisted; values live in an external SecretManager |
| **Audit tampering** | audit table is append-only/immutable (insert-only), secrets redacted |

## Secret handling (STEP 11)

`SecretNamespaceService` persists only **references** (`tenant/{id}/{namespace}/*` → opaque handle); the
secret VALUE is stored out-of-band via a `SecretManagerPort` (adapter over the existing SecretManager — the
frozen security platform is **not** modified). Rotation links the previous reference; cross-tenant secret
access throws `FORBIDDEN`. The persisted secret-ref row never contains plaintext (tested).

## Cryptography

API keys and domain tokens use Node `crypto` (`randomBytes`), hashed with `sha-256`; key verification uses
`timingSafeEqual`. No secret material is stored in plaintext anywhere in the control plane.
