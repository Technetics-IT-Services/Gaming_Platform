# Tenant Recovery & Restart (Phase 3.2, STEP 20)

The control plane's durable state survives process/worker restart, cache loss, and partial failures.
Persistence is always the **source of truth**; caches are derived and rebuilt lazily.

## Restart

```ts
const snapshot = cp.snapshot();                 // serialize durable state (a real DB persists it)
// ── process restart ──
const recovered = TenantControlPlane.recover(snapshot);  // rebuild from the snapshot ONLY
```

`recover()` builds a fresh driver via `InMemoryPersistenceDriver.fromSnapshot(snapshot, TABLE_INDEXES)`,
replaying every row and **rebuilding all indexes**, then constructs a new control plane with **empty
caches**. Reads (`getTenant`, `effectiveConfig`, `isFlagEnabled`) work immediately, repopulating caches
from persistence on demand. In production the SQL/Prisma driver makes this automatic — the snapshot step is
the database itself.

Verified in `control-plane.test.ts`: after recovery a tenant's status, plan, feature-flag overrides and
active configuration version are all intact.

## Cache loss

```ts
cp.cache.clear();               // lose the entire cache
cp.effectiveConfig(auth, id);   // still correct — rebuilt from persistence
```

Cache keys are version-aware and tenant-namespaced (`tenant:{id}:config:{version}`, `tenant:{id}:flags`),
so a cleared cache never yields stale or cross-tenant data — it simply re-reads the source of truth.

## Partial failure recovery

| Failure | Behavior |
|---|---|
| **Provisioning fails mid-way** | `state: 'failed'` recorded; tenant left `Provisioned` (not Active); retry with the same idempotency key **resumes** and completes |
| **Failed configuration update** | version create/activate is transactional; a failure rolls back, history intact |
| **Concurrent update conflict** | optimistic `version` check throws `CONFLICT`; the caller re-reads and retries — no corruption |
| **Worker restart** | background workers re-resolve the tenant context and read current persisted state |

## Guarantees

- No state is held **only** in memory — every durable fact lives in a persisted table.
- Indexes are reconstructed on load, preserving O(1) lookups after recovery.
- Caches are pure accelerators: dropping them changes performance, never correctness.
