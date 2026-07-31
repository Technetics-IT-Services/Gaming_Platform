# Production Infrastructure Architecture (Phase 7)

> This phase is **not** feature work. It packages the frozen Enterprise Platform for
> production deployment and operation. No Runtime / Ledger / Treasury / Payments /
> Compliance / Operations / CRM / Partner / Analytics code was modified.

## Topology

```
                       Internet
                          │  TLS (cert-manager) + HSTS + WAF/rate-limit
                   ┌──────▼──────┐
                   │  Ingress    │  app.* + *.brands.* (white-label host routing)
                   └──────┬──────┘
             ┌────────────┼─────────────┐
        ┌────▼────┐                ┌────▼────┐
        │ frontend│  (HPA 3–20)    │ worker  │  (HPA 2–12, queue-depth scaled)
        │ Next.js │  PDB minAvail 2│ jobs    │  PDB minAvail 1
        └────┬────┘                └────┬────┘
             │        ┌──────────────────┤
        ┌────▼────┐   │             ┌────▼────┐
        │PgBouncer│───┼────────────▶│  Redis  │ cache / sessions / rate-limit / queues
        └────┬────┘   │             └─────────┘  (AOF everysec + RDB, LRU eviction)
        ┌────▼─────────▼─┐
        │  PostgreSQL     │  primary + hot standby replica(s)
        │  (ledger = SoT) │  WAL archiving → object storage (PITR)
        └─────────────────┘
```

## Layers (this phase)

| Concern | Artifact | Notes |
|---|---|---|
| Containerization | `docker/Dockerfile.frontend` (existing), `deploy/docker/Dockerfile.worker` | multi-stage, non-root (uid 1001), tini PID 1, healthcheck, standalone Next output |
| Orchestration | `deploy/k8s/*.yaml` | namespace + quota + PSA `restricted`, deployments, service, ingress, HPA, PDB, PVCs, NetworkPolicy |
| Configuration | `src/lib/infra/config.ts` | validated schema, secret injection + masking, env profiles, feature flags (env/tenant), tenant config |
| Secrets | `deploy/k8s/10-config-secrets.yaml` | template only; real values via External Secrets / Vault (never committed) |
| Database | `deploy/postgres/postgresql.tuning.conf`, PgBouncer, migration Job | strict durability, replicas, PITR, pooling, expand-only migrations |
| Redis | `deploy/redis/redis.conf` | cache/session/rate-limit/queue roles, AOF durability |
| Background jobs | `src/lib/infra/{queue,jobs}.ts` | queue abstraction + DLQ + retry/backoff + scheduler + worker lifecycle |
| Health | `src/lib/infra/health.ts` | liveness (`/api/health/live`) + readiness (`/api/health/ready`) aggregation |
| Deployment | `deploy/ci/deploy-pipeline.yml` | rolling / blue-green / canary + SLO gate + auto-rollback + image scan |
| Version | `src/lib/infra/version.ts` | `/version` build metadata for release traceability |
| Backup / DR | `docs/DISASTER_RECOVERY.md` | RPO ≤ 1 min (ledger), RTO ≤ 30 min; PITR + failover |
| Runbooks | `docs/RUNBOOKS.md` | release checklist, rollback, scaling, incident response |

## Configuration platform (`src/lib/infra/config.ts`)

`loadConfig(raw, schema, { env, secrets })` validates + coerces every field (number/boolean/
url/enum with min/max/required/default), **aggregates all issues** before throwing, injects
secret fields from the secret provider and **masks** them in `masked()` (safe to log).
`FeatureFlags` resolves most-specific scope (tenant+env > tenant > env > base).
`TenantConfigRegistry` resolves per-tenant config with default fallback. `profileDefaults(env)`
supplies safe per-environment baselines.

## Background processing (`src/lib/infra/{queue,jobs}.ts`)

`IQueue` is transport-agnostic (in-memory reference impl ships; production binds Redis behind the
same contract). `Worker` consumes a queue, applies a `RetryPolicy` (exponential backoff, capped),
routes exhausted jobs to a **dead-letter queue**, and exposes `onSuccess/onRetry/onDeadLetter`
monitoring hooks with `WorkerStats`. `Scheduler` runs recurring jobs deterministically (tick-driven).

## Health model (`src/lib/infra/health.ts`)

- **Liveness** — cheap, always-healthy unless the process is wedged (restarts the pod).
- **Readiness** — runs component probes (DB `SELECT 1`, Redis `PING`, queue depth). A **critical**
  probe failure ⇒ `Unhealthy` (pod removed from the LB); a non-critical failure ⇒ `Degraded`.

## Security posture (STEP 10)

Non-root containers, read-only root filesystem, all Linux capabilities dropped, `seccomp:
RuntimeDefault`, `allowPrivilegeEscalation: false`; namespace Pod Security `restricted`; default-deny
ingress NetworkPolicy; secrets isolated in an external manager and masked in logs; image scanning
gates every deploy (fail on HIGH/CRITICAL); TLS + HSTS + security headers at the ingress.

## What this phase did NOT change

The frozen business platform (Runtime, Games, Wallet, Ledger, Treasury, Payments, Compliance,
Operations, CRM, Partner, Analytics, Settlement) is byte-for-byte unchanged. This phase is packaging,
configuration and operations only.
