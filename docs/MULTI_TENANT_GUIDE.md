# Multi-Tenant Guide (Phase 3.1)

A practical guide to running the FROZEN Enterprise Casino Platform as an Enterprise SaaS with unlimited
tenants. Entry point: `MultiTenantPlatform` (`apps/frontend/src/lib/tenancy/`).

## 1. Stand up the platform

```ts
import { MultiTenantPlatform, TenantPlan } from '@/lib/tenancy';

const platform = new MultiTenantPlatform({
  environment: 'production',
  resolver: { rootDomains: ['casino.app'], requireActive: true },
  telemetry: { log: existingLogger, metric: existingMetrics, audit: existingAudit }, // frozen sinks
});
```

## 2. Provision & activate a tenant

```ts
const t = platform.lifecycle.provision({
  code: 'acme', name: 'Acme Casino', operatorId: 'op-1', plan: TenantPlan.Growth,
  domains: ['acme.com'], apiKeys: ['sk-acme'],
  currency: 'EUR', locale: 'en-GB', region: 'eu-west',
});
platform.lifecycle.activate(t.id);   // Provisioned → Active
```

Plan defaults (`PLAN_LIMITS`, `PLAN_FEATURES`) apply automatically; override per tenant as needed.

## 3. Configure (optional layers)

```ts
platform.config.setGlobal({ currencies: ['USD', 'EUR'] });
platform.config.setRegion('eu-west', { paymentProviders: ['adyen'] });
platform.flags.define('sportsbook.enabled', { plans: { [TenantPlan.Enterprise]: true }, rolloutPercentage: 10 });
platform.brand.setOperatorBrand('op-1', { primaryColor: '#0af', support: { email: 'help@acme.com' } });
platform.theme.setTenantTheme(t.id, { baseThemeId: 'dark', tokens: { '--color-primary': '#0af' } });
```

## 4. Serve a request (context injected automatically)

```ts
const result = await platform.run({ apiKey: 'sk-acme' }, (ctx) => {
  // ctx.tenantId / currency / featureFlags / configuration / brand are all resolved.
  // Frozen Runtime/Wallet/Ledger/CRM run INSIDE this context (TenantScope) — unchanged.
  if (!ctx.featureFlags['poker.enabled']) throw new Error('poker not enabled for this tenant');
  platform.storage.set(ctx.tenantId, 'lastSeen', Date.now()); // isolated per tenant
  return { casino: ctx.brand.casinoName, currency: ctx.currency };
});
```

Other transports: `platform.middleware.rest / graphql / worker / scheduled / cli`.

## 5. Enforce quotas & isolate data

```ts
platform.quotas.acquire(ctx.tenantId, 'concurrentSessions', tenant.limits); // throws at the ceiling
const wallets = new TenantRepository('wallet');
wallets.put(ctx.tenantId, { id: playerWalletId, amount });   // stamped with tenantId
```

## 6. Lifecycle operations (no manual DB work)

```ts
platform.lifecycle.suspend(t.id);  // billing/compliance hold — quotas reset
platform.lifecycle.restore(t.id);  // back to Active
platform.lifecycle.archive(t.id);  // retire (restorable)
platform.lifecycle.delete(t.id);   // soft-delete (indexes freed, storage cleared)
platform.lifecycle.purge(t.id);    // permanent
```

## Golden rules

1. **Never** modify a frozen module — wrap it. One Runtime, one Wallet, one Ledger; unlimited tenants.
2. **Every** request runs inside a `TenantContext` (resolve before business logic).
3. **No** data without a `tenantId`; **no** shared mutable state across tenants.
4. Configuration/flags/brand/theme are **values only** — financial rules, settlement and game math stay in
   the frozen platform, unchanged.

## What was NOT built (and why)

Per-tenant runtimes/wallets/ledgers, business-logic forks, and API redesigns are **explicitly avoided** —
they violate the "one shared platform, isolated by context" principle. See `TENANT_ARCHITECTURE.md`.
