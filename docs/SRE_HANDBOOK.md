# SRE Handbook & Capacity Planning (Phase 10, STEP 8 & 9)

Backed by `src/lib/resilience/{sre,capacity}.ts`. Measurement + planning only — no behavior change.

## SLOs & error budgets (STEP 9)

| SLO | SLI | Target | Window | Downtime budget |
|---|---|---|---|---|
| API availability | successful / total requests | **99.9%** | 30d | ~43.2 min |
| API latency | requests < 300ms p95 | 99.0% | 30d | — |
| Payment success | non-error deposits/withdrawals (excl. user decline) | **99.95%** | 30d | ~21.6 min |
| Ledger integrity | reconcile `systemSum == 0` checks passing | **100%** | 30d | 0 (hard) |

`SLOTracker.status()` returns SLI, budget total/consumed/remaining and **burn rate**
(actual error ratio ÷ allowed error ratio). Multi-window **burn alerts**: burn ≥ 14.4 → **page**
(~2% budget/hour), ≥ 3 → **ticket**. `SREPlatform.dashboard()` rolls all SLOs up.

### Error-budget policy
- Budget remaining > 50%: ship features freely.
- 10–50%: ship with extra caution; prioritize reliability fixes.
- < 10% or a fast burn: **freeze feature deploys**; only reliability work until recovered.
- Ledger-integrity SLO is a hard 100% — any breach is a SEV1 (see `docs/INCIDENT_RESPONSE.md`).

## Capacity engineering (STEP 8)

- **Replicas**: `sizeReplicas({rps, latencyMs, perPodConcurrency, headroom})` — Little's Law
  (`concurrency = rps × latency`) ÷ per-pod effective capacity × headroom.
- **Workers**: `sizeWorkers({arrivalRatePerSec, serviceRatePerWorker, targetUtilization})` — keep
  utilization ρ below target so the queue stays stable.
- **Connection pool**: `sizeConnectionPool({replicas, workers, perInstancePool, serverMaxConnections})`
  — flags when pods × pool would exceed the DB max; PgBouncer transaction pooling multiplies headroom.
- **Peak**: `planPeak(profile, peakMultiplier)` sizes for the expected spike (e.g. 3× on event nights).
- **Cost**: `estimateCost(replicas, workers, costModel)` for a monthly estimate.
- **Growth**: `projectGrowth(currentRps, monthlyGrowthRate, months)` compounds the traffic forecast.

### Worked example
1,000 RPS, 50ms latency, 50 conc/pod, 65% target, 1.3× headroom → concurrency 50, **2 replicas**.
Queue: 100 jobs/s arrival, 20/s per worker, 70% target → **8 workers**. 20 replicas × 20 pool = 400
connections vs 200 server max → **over limit** → front with PgBouncer (25 server-side pool).

## Operational readiness

- Dashboards: SLO burn, latency percentiles (Phase-6D observability), queue depth, error rates,
  circuit/bulkhead stats, replication lag, budget remaining.
- On-call: `docs/RUNBOOKS.md` (Phase 7) + `docs/INCIDENT_RESPONSE.md` (Phase 8).
- Game-days: run chaos experiments (`docs/CHAOS_ENGINEERING.md`) quarterly; verify the failure +
  recovery matrices in `docs/RESILIENCE_GUIDE.md`.

## Availability verification (STEP 10)

| Requirement | Verified by |
|---|---|
| Zone loss survivable | multi-zone spread + PDB (`deploy/ha/multi-zone.yaml`) |
| Singleton failover | `LeaderElection` lease-expiry takeover (tested) |
| Dependency isolation | circuit breaker + bulkhead (tested) |
| Load shedding keeps money paths | `BackpressureMonitor.admit(...,'critical')` (tested) |
| Regional failover | `HealthBasedRouter.regionFailed` (tested) |
| Fault tolerance | `ChaosExperiment` steady-state before/after (tested) |
| Capacity sized | `capacity` module (tested) |
| Error budget tracked | `SLOTracker` burn rate + alerts (tested) |
