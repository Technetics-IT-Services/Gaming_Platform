# Observability (Phase 3.1, STEP 11)

Module: `observability.ts`. `TenantObservability` automatically attaches the tenant dimensions —
`tenantId`, `operatorId`, `plan`, `region` (plus `requestId`) — to **logs, metrics, traces, audit events
and health reports**. It **enriches** telemetry from the `TenantContext` and forwards it to whatever sink
the app already uses; the **FROZEN** Analytics / Observability platform is passed in as a sink and never
modified.

## Dimensions

```ts
dimensionsOf(ctx) // { tenantId, operatorId, plan, region, requestId }
```

Every emitted item carries these, so all telemetry is filterable and attributable per tenant.

## Bound facade

```ts
const obs = new TenantObservability({ log, metric, audit }, clock); // sinks → existing systems
const t = obs.forContext(ctx);
t.log('info', 'session started', { gameId: 'poker' });
t.metric('sessions.active', 5, { region: ctx.region });
t.audit('tenant.updated', { actor: 'admin', target: ctx.tenantId });
```

Each call is stamped with the context's dimensions and pushed to the sink (and retained for
dashboards/tests). Read-side helpers filter by tenant: `logsFor(tenantId)`, `metricsFor(tenantId)`,
`auditsFor(tenantId)`.

## Health reports

```ts
obs.healthReport(ctx, [
  { name: 'wallet', healthy: true },
  { name: 'runtime', healthy: true },
]); // → { dimensions, healthy, checks, at }
```

## Sinks = the frozen systems

The `TelemetrySinks` interface (`log` / `metric` / `audit`) is where the existing logging, metrics and
audit platforms plug in. Tenancy adds the tenant dimensions **around** them — it never instruments or
mutates a frozen service. Combined with per-tenant namespaced metric/trace prefixes
(`RESOURCE_ISOLATION.md`), every observable signal is cleanly partitioned by tenant.
