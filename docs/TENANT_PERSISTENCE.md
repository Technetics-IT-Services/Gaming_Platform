# Tenant Persistence (Version 3.0, Phase 3.2)

> Phase 3.2 turns the Phase 3.1 in-memory Multi-Tenant Foundation into a **production-grade persistent
> Control Plane**, entirely additively. The permanently FROZEN Enterprise Platform (Runtime, Wallet,
> Ledger, Treasury, Payments, Games, CRM, Analytics, Security…) is never modified, forked or duplicated —
> the control plane sits ABOVE it. Modules: `apps/frontend/src/lib/tenancy/persistence/` and
> `apps/frontend/src/lib/tenancy/control-plane/`.

## Layering

```
                     TENANT CONTROL PLANE  (control-plane/)
   registry · config · flags · domains · api-keys · secrets · provisioning · lifecycle · audit
        │  RBAC + audit + observability on every mutating call
        ▼
                     REPOSITORIES  (persistence/repositories.ts, tenant-repository.ts)
        │  transactional · optimistic version · O(1) indexes · deterministic errors
        ▼
                     PERSISTENCE DRIVER  (persistence/driver.ts)   ← the DB seam
        InMemoryPersistenceDriver (tests/dev)  ‖  SQL/Prisma driver (production)
        ▼
                     TenantContext  →  FROZEN platform (UNCHANGED)
```

## The driver seam (STEP 23)

`PersistenceDriver` is a framework-agnostic, transactional table store. Two implementations behind one
interface:

- **`InMemoryPersistenceDriver`** — default for unit tests, local dev and isolated engine tests. Durable
  across handle instances; supports `snapshot()` / `fromSnapshot()` for restart-recovery simulation.
- **Production SQL/Prisma driver** — implements the same interface over Postgres (mapping in
  `TENANT_DATABASE.md`). No control-plane or repository code changes when swapping drivers.

The in-memory implementation is intentionally **retained** (STEP 23) — the migration strategy keeps both.

## Guarantees

| Property | Mechanism |
|---|---|
| Transactional writes | `driver.transaction(fn)` snapshots tables, rolls back on throw |
| Optimistic concurrency | every mutable row has `version`; writes assert the expected version → `CONFLICT` |
| Unique constraints | driver-maintained unique indexes (code, hostname, api-key prefix/hash, …) |
| O(1) lookups | named secondary indexes — never a full scan for id/code/domain/api-key |
| Deterministic errors | `ControlPlaneError` codes (`NOT_FOUND`, `CONFLICT`, `UNIQUE_VIOLATION`, …) |
| No raw DB leakage | repositories return typed rows/views; callers never see driver internals |
| Restart recovery | `snapshot()` → `fromSnapshot()` rebuilds rows + indexes; caches rebuild lazily |

## What is persisted

10 tables (STEP 1): `tenants`, `tenant_domains`, `tenant_api_keys`, `tenant_configurations`,
`tenant_configuration_versions`, `tenant_feature_flags`, `tenant_quotas`, `tenant_lifecycle_events`,
`tenant_audit_events`, `tenant_provisioning` (+ `tenant_secret_refs`). Every mutable row carries
`tenant_id`/ownership + `created_at`, `updated_at`, `created_by`, `updated_by`, `version`. See
`TENANT_DATABASE.md`.

## Financial safety (STEP 27)

The persistence + control-plane layers import **no** financial module (verified: zero imports of
ledger/treasury/payments/wallet). A full provisioning + configuration + domain + api-key + secret +
lifecycle session leaves wallet/ledger/treasury/payment impact at **zero** — asserted in
`control-plane.test.ts`.
