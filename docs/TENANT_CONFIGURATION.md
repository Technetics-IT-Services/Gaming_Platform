# Tenant Configuration (Phase 3.1, STEP 6)

Module: `configuration.ts`. Configuration resolves through a **five-layer hierarchy**, each layer
contributing a partial `TenantConfiguration`; `resolve` deep-merges them in precedence order (later wins).

## Hierarchy

```
Global  →  Region  →  Tenant  →  Environment  →  Request Override
(lowest precedence)                                    (highest)
```

```ts
const cfg = new ConfigurationPlatform();
cfg.setGlobal({ depositLimits: { min: 5, max: 1_000 }, currencies: ['USD'] });
cfg.setRegion('eu-west', { currencies: ['EUR'], depositLimits: { max: 2_000 } });
cfg.setTenant(tenantId, { depositLimits: { max: 5_000 } });
cfg.setEnvironment('staging', { responsibleGaming: { depositLimitEnabled: false } });

const resolved = cfg.resolve({
  region: 'eu-west', tenantId, environment: 'staging',
  tenantConfig: tenant.configuration,       // the tenant's own stored config
  requestOverride: { depositLimits: { min: 50 } },
});
// currencies: ['EUR']  (region beat global)
// depositLimits.max: 5_000  (tenant beat region)
// depositLimits.min: 50  (request override wins)
// responsibleGaming.depositLimitEnabled: false  (environment layer)
```

Objects deep-merge; arrays replace. `describe()` reports which layers contributed (for audit/debugging).

## What is configurable

| Group | Keys |
|---|---|
| Limits | `depositLimits`, `withdrawalLimits` (`min`/`max`/`daily`/`monthly`) |
| Localization | `currencies[]`, `languages[]` |
| Responsible gaming | deposit/loss limits, self-exclusion, reality-check + session reminders (values only) |
| Payments | `paymentProviders[]` |
| Games | `gameAvailability` (gameId → available) |
| Notifications | `notificationSettings` (email/sms/push) |
| Extension | `extra` (free-form keys resolved through the hierarchy) |

## Precedence note (per-tenant authority)

A tenant's **stored** `configuration` is a complete snapshot (seeded from its plan defaults at
provisioning). Because it sits at the Tenant layer, it is authoritative over Global/Region for any field it
sets — the platform-wide Global/Region layers act as defaults a new tenant inherits, and the
**Environment** and **Request Override** layers still compose on top for the fields they touch. Values
only — enforcement (actual deposit/withdrawal/RG rules) remains entirely in the **FROZEN** financial and
compliance platforms; this layer never moves money or changes a financial calculation.
