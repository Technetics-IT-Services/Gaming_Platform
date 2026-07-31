# Resource Isolation (Phase 3.1, STEP 10, 12, 13)

Modules: `isolation.ts` (namespaces + scoped stores), `ownership.ts` (data ownership), `quotas.ts`
(resource quotas). Every tenant owns isolated resources over the **shared** backing infrastructure — there
is **no shared mutable state** across tenants.

## Namespacing (STEP 10)

Every resource key is prefixed with the tenant: `t:{tenantId}:{kind}:{key}`.

```ts
namespaceKey('t1', 'cache', 'user:42');  // → 't:t1:cache:user:42'
const ns = new ResourceNamespace('t1');
ns.storageKey('avatar.png'); ns.mediaKey('promo.mp4'); ns.cacheKey('cfg');
ns.queueName('emails');      ns.jobName('nightly');    ns.auditStream();
ns.metricPrefix();           ns.tracePrefix();
```

Isolated kinds: **storage, media, uploads, cache, queue, notifications, jobs, audit, metrics, tracing**.

## Scoped stores (STEP 10)

`TenantScopedKV` and `TenantQueues` are views over a shared map whose operations are confined to the
caller's tenant prefix — cross-tenant reads/writes are **structurally impossible**:

```ts
const kv = new TenantScopedKV<number>();
kv.set('t1', 'balance', 100); kv.set('t2', 'balance', 999);
kv.get('t2', 'balance');   // 999
kv.keys('t1');             // ['balance']  — never sees t2's keys
kv.clear('t1');            // leaves t2 untouched
```

## Data ownership (STEP 13)

**No data may exist without a `tenantId`.** `TenantRepository<T>` stamps `tenantId` on every row and
enforces it on every operation:

```ts
const wallets = new TenantRepository<{ id: string; amount: number }>('wallet');
wallets.put('t1', { id: 'w1', amount: 50 });
wallets.get('t2', 'w1');            // null — t2 cannot read t1's row
wallets.delete('t2', 'w1');         // false — cannot delete another tenant's row
wallets.put('t2', { id: 'w1', … }); // throws — cannot hijack another tenant's id
wallets.put('', { id: 'x' });       // throws — no data without tenant ownership
```

Illustrative owned kinds: players, wallets, transactions, deposits, withdrawals, bonuses, game-sessions,
poker-tables, lottery-tickets, notifications, VIP, affiliates, CRM, audit. The **frozen** platform's own
entities are untouched — new multi-tenant data uses this wrapper to guarantee isolation additively.

## Resource quotas (STEP 12)

`QuotaService` enforces per-tenant `TenantLimits`. Gauges (concurrent players/sessions, storage, media,
jobs, queue, workers) use `acquire`/`release`; rate resources (API requests/min, notifications/day) use a
rolling window.

```ts
q.acquire(tenantId, 'concurrentSessions', limits);  // throws QuotaExceededError at the ceiling
q.release(tenantId, 'concurrentSessions');
q.check(tenantId, 'apiRequestsPerMinute', limits);  // non-mutating decision
q.snapshot(tenantId, limits);                        // all resources at a glance
```

Limits derive from the tenant's plan (`PLAN_LIMITS`) and are fully overridable per tenant. Counters are
per-tenant and reset on suspend/delete by the lifecycle hooks.
