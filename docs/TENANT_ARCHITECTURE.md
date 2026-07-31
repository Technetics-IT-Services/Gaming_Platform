# Tenant Architecture (Version 3.0, Phase 3.1 — Multi-Tenant Foundation)

> An **additive** Enterprise SaaS layer that turns the production-certified, permanently **FROZEN**
> Enterprise Casino Platform into a true multi-tenant platform. **One** shared platform serves unlimited
> tenants, isolated purely by `TenantContext`. Nothing here modifies, forks or duplicates Runtime, Wallet,
> Ledger, Treasury, Payments, Games, Poker, Lottery, CRM, Analytics, Security or Infrastructure — it
> **wraps** them. Module: `apps/frontend/src/lib/tenancy/`.

## Principle: wrap, never fork

```
            ┌──────────────────────────── Tenant Middleware ────────────────────────────┐
 request →  │  Resolver → TenantContext → TenantScope.run(ctx, handler)                  │
            └──────────────┬─────────────────────────────────────────────────────────────┘
                           │ ambient context (never passed into frozen code)
        ┌──────────────────┴───────────────────────────────────────────────┐
        ▼                                                                    ▼
  additive wrappers (namespacing, quotas, observability, ownership)    FROZEN platform
  t:{tenantId}:… keys · per-tenant counters · stamped telemetry        Runtime · Wallet · Ledger …
                                                                        (byte-for-byte unchanged)
```

There is exactly **one** Runtime, **one** Wallet, **one** Ledger. Tenancy adds context resolution,
namespacing and quotas around them. No per-tenant runtimes/wallets/ledgers are created.

## Module map

| File | Step | Responsibility |
|---|---|---|
| `types.ts` | 1 | Tenant domain model, context, config, brand, theme, limits, lifecycle |
| `registry.ts` | 2 | `TenantRegistry` — CRUD, search, list, health, resolution indexes |
| `resolver.ts` | 3 | `TenantResolver` — host/subdomain/JWT/api-key/header/internal/CLI/jobs |
| `context.ts` | 4 | `TenantContext` builder + ambient `TenantScope` |
| `middleware.ts` | 5 | inject context into REST/GraphQL/workers/scheduled jobs |
| `configuration.ts` | 6 | hierarchical config (Global→Region→Tenant→Env→Request) |
| `feature-flags.ts` | 7 | `FeatureFlagService` — global/tenant/plan/rollout/kill-switch |
| `brand.ts` | 8 | `BrandPlatform` — configuration only |
| `theme.ts` | 9 | `ThemePlatform` — configuration only |
| `isolation.ts` | 10 | resource namespaces + tenant-scoped stores/queues |
| `observability.ts` | 11 | stamp tenantId/operatorId/plan/region onto telemetry |
| `quotas.ts` | 12 | `QuotaService` — per-tenant `TenantLimits` |
| `ownership.ts` | 13 | `TenantRepository` — every row owns a `tenantId` |
| `lifecycle.ts` | 14 | `TenantLifecycleManager` — validated state machine |
| `ports.ts` | 5 | local structural interfaces for additive wrapping |
| `platform.ts` | — | `MultiTenantPlatform` facade wiring it all |

## Request lifecycle

1. **Resolve** the tenant from the transport (before any business logic).
2. **Build** an immutable `TenantContext` (flags + config + brand resolved through their hierarchies).
3. **Bind** the context ambiently via `TenantScope.run` for the unit of work.
4. Downstream code (frozen + additive wrappers) executes **within** the context.
5. **Enrich** all telemetry with tenant dimensions; **enforce** quotas; **isolate** data by namespace/owner.

## Guarantees

- **Zero** modifications to any frozen module (verified: the whole phase touches only `lib/tenancy/` + docs).
- Strong isolation: a tenant can never read/write another tenant's data (`TenantRepository`, `TenantScopedKV`).
- Deterministic + testable: every service takes an injected `clock`; no hidden globals.

See `TENANT_CONTEXT.md`, `TENANT_CONFIGURATION.md`, `TENANT_LIFECYCLE.md`, `FEATURE_FLAGS.md`,
`RESOURCE_ISOLATION.md`, `OBSERVABILITY.md` and the `MULTI_TENANT_GUIDE.md`.
