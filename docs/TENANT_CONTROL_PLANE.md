# Tenant Control Plane (Phase 3.2, STEP 15 & 18)

`TenantControlPlane` (`control-plane/control-plane.ts`) is the single facade for all administrative tenant
operations. It composes every service and enforces the security triad — **tenant context + authorization
+ resource ownership** — on every mutating call, auditing denials and timing each operation.

## Composition

```
TenantControlPlane
├─ PersistentTenantRegistry   (hydrates a full Phase 3.1 Tenant from normalized tables)
├─ ConfigurationService       (versioning, activate, rollback, diff, effective, validate)
├─ FeatureFlagService         (persistent flags, precedence, deterministic rollout, kill switch)
├─ DomainService              (create/verify/activate/suspend/remove/resolve)
├─ ApiKeyService              (issue/verify/revoke — hash-only)
├─ SecretNamespaceService     (references only, rotation, SecretManager port)
├─ ProvisioningService        (idempotent, retry-safe workflow)
├─ LifecycleService           (atomic, audited transitions)
├─ QuotaRepository            (per-tenant limits)
└─ AuditService               (append-only, immutable, secret-redacting)
    + ControlPlaneCache, ControlPlaneObservability, PersistenceDriver
```

## Framework-agnostic service contracts (STEP 18)

The facade exposes plain methods — Tenant CRUD, lifecycle, domains, API keys, configuration, feature
flags, quotas, provisioning, audit, health — each taking a `ControlPlaneAuth` first. HTTP/GraphQL layers
are thin adapters over these; **no existing API is redesigned**.

```ts
const cp = new TenantControlPlane({ environment: 'production' });
const { tenant } = cp.provisionTenant(auth, { code: 'acme', name: 'Acme', operatorId: 'op', idempotencyKey: 'k1' });
cp.updateTenant(auth, tenant.id, { plan: TenantPlan.Enterprise }, tenant.version /* optimistic */);
cp.createConfigVersion(auth, tenant.id, config, 'reason');
cp.rollbackConfig(auth, tenant.id, 2);
cp.setTenantFlag(auth, tenant.id, 'poker.enabled', true);
const { plaintext, key } = cp.issueApiKey(auth, tenant.id, { name: 'server', scopes: ['read'] });
const d = cp.addDomain(auth, tenant.id, 'play.acme.com'); await cp.verifyDomain(auth, tenant.id, d.id);
cp.suspendTenant(auth, tenant.id); cp.restoreTenant(auth, tenant.id);
```

## The authorization gate

`guarded(auth, permission, resourceTenantId, operation, fn)` runs before every mutation:

1. `authorize()` — permission AND ownership must both hold (deny by default).
2. On deny → write a `result: 'deny'` audit entry and throw `FORBIDDEN`.
3. On allow → time the operation, record it (success/failure + duration), bump conflict counters.

## Resolution & context

`cp.resolve(input)` maps a request to a tenant via persistent, O(1) indexed lookups (internal / api-key /
JWT / header / hostname / subdomain), gating external transports to Active tenants (internal/CLI/jobs
bypass). `cp.buildContext(input)` returns a frozen Phase 3.1 `TenantContext` with resolved flags,
hierarchical effective configuration and brand — the same object every downstream (frozen) module already
consumes.

## Recovery

`cp.snapshot()` serializes durable state; `TenantControlPlane.recover(snapshot)` rebuilds a fresh control
plane (new driver from the snapshot, empty caches rebuilt lazily) — exactly what a process restart does.
See `TENANT_RECOVERY.md`.
