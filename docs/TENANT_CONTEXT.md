# Tenant Context (Phase 3.1, STEP 3–5)

`TenantContext` is the immutable, per-request projection of a tenant that **every** downstream module
consumes — **without knowing how it was resolved**. Modules: `resolver.ts`, `context.ts`, `middleware.ts`.

## Resolution (STEP 3) — before business logic

`TenantResolver.resolve(input)` maps any transport to a tenant, trying strategies most-specific first:

| Order | Source | Input |
|--:|---|---|
| 1 | Internal context / CLI / background job | `internalTenantId` (+ `source`) |
| 2 | API key | `apiKey` or `x-api-key` header |
| 3 | JWT claim | `jwtClaims[tid]` |
| 4 | Header | `x-tenant-id` |
| 5 | Hostname | `hostname` / `host` → mapped domain |
| 6 | Subdomain | `sub.casino.app` → tenant code |

External transports are gated to **Active** tenants; internal/CLI/background callers may target any tenant
(so jobs can run for suspended/archived tenants). Resolution **always** happens before the handler runs.

## The context object (STEP 4)

```ts
interface TenantContext {
  tenantId; tenantCode; operatorId;
  region; timezone; currency; locale; plan;
  brand;                     // resolved brand
  permissions; featureFlags; // resolved flags
  configuration;             // hierarchically resolved config
  resolvedVia;               // TenantResolutionSource
  requestId; issuedAt;       // correlation
}
```

It is **frozen** (`Object.freeze`) — a projection, never a live handle to the tenant record — so it is safe
to pass across module and async boundaries and cannot be mutated mid-request.

## Ambient scope (STEP 4)

`TenantScope` makes the context ambient so code reads it without being passed it:

```ts
await TenantScope.run(ctx, async () => {
  const t = TenantScope.require();   // throws if no active context
  // … frozen + additive code runs inside the tenant context …
});
TenantScope.current();               // null outside a run
```

Nested `run`s save/restore correctly. The holder is a stack for this isomorphic build; a production
deployment swaps in `AsyncLocalStorage` with **no API change**. `TenantScope.require()` before business
logic guarantees no request executes tenant-less.

## Middleware injection (STEP 5)

`TenantMiddleware` injects the context around every unit of work — **no change inside the wrapped modules**:

```ts
const mw = new TenantMiddleware(input => platform.buildContext(input), { onEnter, onExit });
await mw.rest({ apiKey }, ctx => handler(ctx));        // REST
await mw.graphql({ jwtClaims }, ctx => resolver(ctx)); // GraphQL
await mw.worker(tenantId, ctx => job(ctx));            // background worker
await mw.scheduled(tenantId, ctx => cron(ctx));        // scheduled job
await mw.cli(tenantId, ctx => command(ctx));           // CLI
const cont = mw.propagate(ctx => notify(ctx));         // detached continuation keeps the context
```

Runtime, Wallet, Ledger, CRM, Analytics, logging, audit and notifications all run inside the bound context;
additive wrappers (`tenantReference`, `tenantIdempotencyKey`, `contextualize`, namespaces, quotas,
observability) read the ambient context to scope shared resources — the frozen modules stay oblivious and
unchanged.
