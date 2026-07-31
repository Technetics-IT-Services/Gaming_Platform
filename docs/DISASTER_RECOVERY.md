# Disaster Recovery — Backup & Recovery Plan (Phase 7)

> Scope: the production data tier (PostgreSQL ledger + Redis) and the deployment
> platform. No business logic is involved — this is operational recovery only.

## Objectives

| Tier | RPO (max data loss) | RTO (max downtime) |
|---|---|---|
| PostgreSQL (ledger — financial source of truth) | **≤ 1 minute** (continuous WAL archiving) | **≤ 30 minutes** (PITR restore + failover) |
| Redis (cache / queues) | ≤ 1 second (AOF `everysec`) — cache is reconstructable | ≤ 10 minutes |
| Application (stateless) | 0 (no state) | ≤ 5 minutes (redeploy prior image) |

The ledger is authoritative; **RPO for financial data is the strictest** and is met by
`synchronous_commit = on` + continuous WAL archiving (`archive_command = wal-g wal-push`).

## Backup strategy

1. **PostgreSQL**
   - **Base backups:** nightly full via `wal-g backup-push` to object storage (encrypted, versioned).
   - **WAL archiving:** continuous (`archive_mode = on`) → point-in-time recovery to any second.
   - **Retention:** 35 daily base backups + WAL; monthly archival for 1 year.
   - **Replicas:** ≥1 streaming hot standby (`wal_level = replica`, `hot_standby = on`) for read scaling AND fast failover.
2. **Redis**
   - AOF (`appendonly yes`, `appendfsync everysec`) + periodic RDB snapshots to object storage.
   - Queues are AOF-durable; cache/rate-limit keys are reconstructable and need no recovery.
3. **Configuration & secrets**
   - ConfigMaps in Git (GitOps). Secrets in the external secret manager (versioned, never in Git).
   - K8s manifests in `deploy/k8s/` are the source of truth (declarative, re-appliable).

## Restore procedures

### PostgreSQL — point-in-time recovery (PITR)
```
# 1. Provision a fresh instance with the tuned config (deploy/postgres/postgresql.tuning.conf).
# 2. Fetch the latest base backup:
wal-g backup-fetch /var/lib/postgresql/data LATEST
# 3. Create recovery.signal + set the target (a timestamp just before the incident):
echo "restore_command = 'wal-g wal-fetch %f %p'"            >> postgresql.auto.conf
echo "recovery_target_time = '2026-07-31 09:14:00+00'"      >> postgresql.auto.conf
touch /var/lib/postgresql/data/recovery.signal
# 4. Start PostgreSQL; it replays WAL to the target, then promotes.
# 5. Verify: run ledger.reconcile() equivalents — systemSum MUST equal 0.
```
### Redis
```
# Restore the latest AOF/RDB from object storage into the redis-data PVC, then start Redis.
# Queues resume; caches warm on demand.
```
### Application
```
kubectl -n gaming-platform set image deploy/frontend frontend=ghcr.io/gaming-platform/frontend:<good-sha>
kubectl -n gaming-platform rollout status deploy/frontend
```

## Failure scenarios & response

| Scenario | Detection | Response |
|---|---|---|
| Primary DB down | readiness `db` probe Unhealthy; alerts fire | Promote hot standby (`pg_ctl promote`); repoint `DATABASE_URL` via secret manager; verify reconcile == 0 |
| Data corruption / bad migration | reconcile drift; error-rate alert | PITR to a timestamp before the migration; re-run expand-only migration |
| AZ/region outage | multi-AZ health loss | Fail over to standby region; restore from geo-replicated backups |
| Redis loss | redis probe Unhealthy | Restart from AOF; if lost, rebuild cache (degraded, not down — non-critical probe) |
| Bad app release | `/version` mismatch + SLO gate | Auto-rollback (`kubectl rollout undo`) per the deploy pipeline |

## Post-recovery validation checklist
- [ ] Ledger reconciles: `systemSum === 0`, no drifted/unbalanced accounts.
- [ ] Treasury summary `balanced === true`.
- [ ] Readiness probe Healthy across all critical components.
- [ ] `/version` reports the intended build SHA.
- [ ] Payment webhook replay window intact; no duplicate credits (idempotency keys).

## DR testing cadence
- **Quarterly** game-day: restore a base backup + WAL into an isolated namespace and validate reconcile.
- **Monthly** automated backup-restore smoke test in CI (non-prod).
