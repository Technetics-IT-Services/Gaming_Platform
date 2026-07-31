# Operational Runbooks (Phase 7)

Concise, copy-pasteable procedures for on-call. All commands target the
`gaming-platform` namespace. Nothing here changes business logic.

## Release checklist (production)
- [ ] CI green on the release commit (lint + typecheck + unit + e2e).
- [ ] Image built from an immutable digest and **scanned** (no HIGH/CRITICAL).
- [ ] DB migration is **expand-only** (backward compatible with the running version).
- [ ] Feature flags for the release default **off** (dark launch).
- [ ] Deploy strategy chosen (rolling / blue-green / canary) and approver assigned.
- [ ] Rollback target SHA recorded.
- [ ] Post-deploy: `/version` matches, readiness Healthy, error-rate + p95 within SLO.

## Deploy a new version
```
# Rolling (default):
kubectl -n gaming-platform set image deploy/frontend frontend=ghcr.io/gaming-platform/frontend:<sha>
kubectl -n gaming-platform rollout status deploy/frontend --timeout=300s
```

## Roll back
```
kubectl -n gaming-platform rollout undo deploy/frontend          # previous revision
kubectl -n gaming-platform rollout undo deploy/frontend --to-revision=<n>
kubectl -n gaming-platform rollout history deploy/frontend       # list revisions
```
> Migrations are expand-only, so rolling the app back never requires a schema rollback.
> A destructive "contract" migration is only applied a release AFTER its expand is fully live.

## Scale
```
kubectl -n gaming-platform scale deploy/frontend --replicas=6     # manual override
kubectl -n gaming-platform get hpa                                # autoscaler state
```

## Investigate high latency / errors
```
kubectl -n gaming-platform get pods -l app.kubernetes.io/name=frontend
kubectl -n gaming-platform logs -l app.kubernetes.io/name=frontend --tail=200 --since=15m
# Check the in-app observability: latency p95, dependency graph, error rate
# (src/lib/analytics Observability + Monitoring dashboards).
```

## Drain the job backlog / inspect the DLQ
```
kubectl -n gaming-platform scale deploy/worker --replicas=8       # burst capacity
# DLQ inspection: messages that exhausted retries land in the *.dlq queue
# (src/lib/infra Worker → onDeadLetter). Requeue after fixing the handler.
```

## Rotate a secret
```
# Update the value in the external secret manager; External Secrets syncs it.
kubectl -n gaming-platform rollout restart deploy/frontend deploy/worker   # pick up new env
```

## Database maintenance (safe window)
```
# Manual VACUUM/ANALYZE on a hot table (autovacuum handles this normally):
psql "$DATABASE_URL" -c "VACUUM (ANALYZE, VERBOSE) ledger_entries;"
# Check slow queries:
psql "$DATABASE_URL" -c "SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 20;"
```

## Emergency: put the site in maintenance
```
# Point the ingress at a static maintenance backend (planned windows only).
kubectl -n gaming-platform annotate ingress frontend nginx.ingress.kubernetes.io/default-backend=maintenance --overwrite
```

## Incident severities
| Sev | Definition | Response |
|---|---|---|
| SEV1 | Money movement impaired / ledger drift / full outage | Page on-call + finance; freeze deploys; DR playbook |
| SEV2 | Degraded (elevated errors/latency, one AZ) | On-call investigates; consider rollback |
| SEV3 | Minor / cosmetic / single-tenant | Ticket, next business day |
