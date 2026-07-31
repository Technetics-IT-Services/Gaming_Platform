# Tenant Lifecycle (Phase 3.1, STEP 1 & 14)

Modules: `registry.ts`, `lifecycle.ts`. A tenant moves through a validated state machine; every transition
is a method call (**no manual database changes**) that updates the registry and fans out to isolation /
quota / observability side-effects via hooks.

## States & transitions

```
                 provision
                    │
                    ▼
             ┌─ Provisioned ─┐
             │               │
        activate         archive / delete
             ▼               │
          Active ──suspend──► Suspended ──restore──► Active
             │  ◄──restore──                          │
        archive / delete                         archive / delete
             ▼                                        ▼
          Archived ──restore──► Active            Deleted (terminal → purge)
             │
          delete
             ▼
          Deleted
```

| From \ To | Active | Suspended | Archived | Deleted |
|---|:--:|:--:|:--:|:--:|
| **Provisioned** | ✓ | ✗ | ✓ | ✓ |
| **Active** | — | ✓ | ✓ | ✓ |
| **Suspended** | ✓ | — | ✓ | ✓ |
| **Archived** | ✓ | ✗ | — | ✓ |
| **Deleted** | ✗ | ✗ | ✗ | — (purge only) |

`canTransition(from, to)` is the single authority; illegal moves throw `TenantLifecycleError`.

## API

```ts
const mgr = new TenantLifecycleManager(registry, hooks);
const t = mgr.provision({ code, name, operatorId, plan });  // → Provisioned
mgr.activate(t.id);   // → Active
mgr.suspend(t.id);    // → Suspended  (hooks reset live quota counters)
mgr.restore(t.id);    // Suspended/Archived → Active
mgr.archive(t.id);    // → Archived
mgr.delete(t.id);     // → Deleted    (frees resolution indexes; clears storage/cache)
mgr.purge(t.id);      // permanently remove a Deleted tenant (frees the code)
```

## Hooks (side-effects, no frozen module)

`onProvision / onActivate / onSuspend / onArchive / onRestore / onDelete / onPurge`. The
`MultiTenantPlatform` wires: **suspend** → reset the tenant's live quota gauges; **delete** → reset quotas
and clear the tenant's namespaced storage/cache. Soft-delete retains the record for a grace window; `purge`
is the irreversible final step.

## Registry lifecycle support (STEP 2)

`create` (starts Provisioned), `update` (re-baselines limits on a plan change while preserving explicit
overrides), `setStatus`, `archive`, `restore`, `delete`, `purge`, plus `get`/`getByCode`/`getByDomain`/
`getByApiKey`, `search`/`list` and per-tenant `health`. Uniqueness is enforced on code, domain and api key.
