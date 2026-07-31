# High Availability & Scalability Architecture (Phase 10)

> Resilience built **around** the frozen platform — no business, financial or
> architectural logic changed. Wrappers/adapters in `src/lib/resilience/`; HA overlays
> in `deploy/ha/`.

## 1. High-availability architecture (STEP 1)

- **Multi-zone**: ≥3 replicas spread across ≥3 availability zones via
  `topologySpreadConstraints` (zone `DoNotSchedule`, host preferred) + pod anti-affinity
  (`deploy/ha/multi-zone.yaml`). One zone loss keeps quorum.
- **Active-passive** (default for singletons): lease-based **leader election**
  (`LeaderElection` + `LeaseStore`, bind Redis `SET NX PX` / etcd). The active node renews
  the lease; on crash the lease expires and a passive node takes over on its next tick.
- **Active-active** (stateless web/API): all replicas serve concurrently behind the LB;
  state lives in the frozen ledger/DB/Redis, so any replica handles any request. Money
  correctness is preserved by the frozen ledger's idempotency + double-entry — HA adds no
  new consistency requirement.
- **Failover orchestration**: health-based routing + regional failover (below) + DB/Redis
  automatic failover (Sentinel / managed replica promotion).
- **Health-based routing**: `HealthBasedRouter` routes only to `Healthy` endpoints, prefers
  the caller's region with cross-region failover, and excludes `Draining` endpoints
  (connection draining) — plugs into the Phase-7 readiness probes.

## 2. Scalability platform (STEP 2)

- **Horizontal scaling**: HPA on CPU/memory (frontend) + queue depth (worker) — Phase-7
  `40-autoscaling.yaml`. `sizeReplicas()` gives the target from RPS × latency (Little's Law).
- **Worker autoscaling**: `sizeWorkers()` from queue arrival vs service rate (keep ρ < target).
- **Queue autoscaling**: KEDA/external-metric on `redis_queue_depth`.
- **Connection scaling**: `sizeConnectionPool()` bounds pods × per-pod pool under the DB max
  (PgBouncer transaction pooling front-ends the primary).
- **Stateless deployment**: no local session state; sessions in Redis (Phase 8), so any
  replica is interchangeable and rollouts/scale-in are safe.
- **Session affinity**: none required (stateless); if sticky routing is ever needed, use
  cookie-based affinity at the ingress — never for money paths.
- **Capacity planning**: `docs/CAPACITY_PLANNING.md` + the `capacity` module.

## 3. Traffic management (STEP 4)

- **Global LB / geo routing**: DNS/anycast global LB routes users to the nearest healthy
  region; `HealthBasedRouter.route(region)` models the in-cluster equivalent.
- **CDN**: static assets + cacheable responses served from the edge; the app sets cache
  headers (dynamic + money paths are `no-store`).
- **Regional failover**: `regionFailed(region)` detects a region with no healthy endpoints →
  shift traffic to the standby region (backed by geo-replicated DB backups / read replicas).
- **Ingress failover**: multiple ingress replicas across zones; `PodDisruptionBudget` keeps
  ≥N available during drains.
- **Traffic shaping**: `AdaptiveRateLimiter` (AIMD) + ingress rate-limits shape inbound load.
- **Connection draining**: `preStop` sleep + `HealthBasedRouter.drain()` finish in-flight
  requests before a pod exits (zero-downtime rollouts).

## 4. Database & Redis HA (STEP 5 & 6)

**PostgreSQL** — primary + streaming **read replicas** (Phase-7 tuning: `wal_level=replica`,
`hot_standby=on`). Split read/write: writes → primary (ledger authoritative), reads
(reporting/analytics) → replicas. **Automatic failover**: managed service or Patroni promotes a
standby; app repoints `DATABASE_URL` via the secret manager. **Replication monitoring**:
`pg_stat_replication` lag alerts. **Consistency**: `synchronous_commit=on` for the ledger
(no committed entry is lost); reporting reads tolerate replica lag (eventual, read-only).

**Redis** — **Sentinel** (`deploy/ha/redis-sentinel.yaml`: 1 primary + 2 replicas + 3 Sentinels,
quorum 2) for automatic primary failover, or **Redis Cluster** for sharded scale-out. **Persistence
validated**: AOF `everysec` + RDB. **Split cache/queue**: separate instances so cache eviction
never drops queue state; queues use no-TTL keys, cache/rate-limit keys always carry a TTL.
**Recovery**: restore AOF/RDB from object storage; queues resume, cache warms on demand.
