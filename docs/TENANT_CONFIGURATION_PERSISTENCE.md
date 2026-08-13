# Tenant Configuration Persistence (Phase 3.2, STEP 5)

Modules: `persistence/repositories.ts` (`ConfigurationRepository`) + `control-plane/configuration-service.ts`
(`ConfigurationService`). Configuration is stored as **immutable, monotonically-increasing versions** with
a single active pointer per tenant. History is **never destroyed** — a rollback re-points the active
version.

## Model

```
tenant_configurations            tenant_configuration_versions (immutable)
  tenant_id → active_version         {tenantId}:v1  config v1
                                      {tenantId}:v2  config v2
                                      {tenantId}:v3  config v3
  active = v3  ── rollback ──►  active = v2   (v1, v2, v3 all still readable)
```

## API

```ts
const svc = new ConfigurationService(configRepo, hierarchyPlatform, cache);
const v = svc.createVersion(tenantId, config, { reason, actor }); // validated; first version auto-activates
svc.activate(tenantId, v.version, actor);       // roll forward
svc.rollback(tenantId, 2, actor);               // roll back (history preserved)
svc.getActive(tenantId);                        // active snapshot
svc.effective(tenantId, { region, environment, requestOverride }); // hierarchical, cached by version
svc.diff(tenantId, 1, 2);                        // [{ path, before, after }]
svc.listVersions(tenantId);                      // full history
```

## Effective configuration

`effective()` composes the persisted active version through the Phase 3.1 hierarchy —
**Global → Region → Tenant → Environment → Request Override** — reusing `ConfigurationPlatform`. The
pure-tenant resolution is cached under a **version-aware** key (`tenant:{id}:config:{version}`), so
activating or rolling back a version naturally invalidates the cache. Persistence is always the source of
truth; the cache is dropped on any write.

## Validation

`validate()` runs before any version is created: deposit/withdrawal `min ≤ max`, at least one currency.
Invalid configuration cannot be persisted (`VALIDATION` error).

## Immutability guarantee

`ConfigurationRepository.createVersion` only ever **inserts** a new version row; version rows are never
updated or deleted. `setActiveVersion` mutates only the pointer (with optimistic concurrency). Result: a
complete, auditable configuration history for every tenant, with instant rollback and diff.
