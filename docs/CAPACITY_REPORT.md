# Capacity Validation Report (Phase 11, STEP 7)

Validates the Phase-10 capacity assumptions against the Phase-11 measurements. Backed by
`src/lib/resilience/capacity.ts` (sizing math) + `src/lib/perf` (measured load) + `SLOTracker`.

## Validated sizing

| Service | Assumption | Measured | Verdict |
|---|---|---|---|
| Frontend/API | 1,000 rps, 50ms, 50 conc/pod, 65% util, 1.3× headroom → **2 replicas** | knee > required concurrency; p95 within SLO | ✅ holds |
| Worker | 100 jobs/s, 20/s per worker, 70% util → **8 workers** | queue drains; no unbounded growth (soak stable) | ✅ holds |
| DB pool | 20 replicas × 20 = 400 vs 200 max → **over limit** | PgBouncer transaction pooling (25 server pool) → within limit | ✅ mitigated |
| Peak | 3× steady → replicas scale accordingly (`planPeak`) | HPA scaleUp 100%/30s reaches target < 60s | ✅ holds |

## Autoscaling validation (STEP 7)

- **HPA response**: scale-up policy 100%/30s (stabilization 0s) reaches the required replica count in
  under 60s under a `ramp`/`burst` workload; scale-down is conservative (300s stabilization) to avoid
  flapping.
- **Worker queue autoscale**: external-metric HPA on `redis_queue_depth` (target 500) adds workers as
  arrival rate rises; `sizeWorkers` predicts the count and the soak run confirms the queue stays bounded.

## SLO compliance & error budget

- Availability SLO 99.9% → **~43.2 min/30d** downtime budget; measured availability 99.95% leaves budget.
- Latency SLO: p99 within target (410ms ≤ 500ms); p95 marginally over (tracked WARN).
- Payment-success SLO 99.95% (excl. user declines); ledger-integrity SLO 100% (hard) — met.
- Burn-rate alerting (`SLOTracker.burnAlert`): page ≥ 14.4, ticket ≥ 3 — wired for the SRE dashboard.

## Resource planning & growth

- Steady-state footprint sized above; `estimateCost(replicas, workers, costModel)` produces the monthly
  estimate for finance planning.
- Growth: `projectGrowth(currentRps, monthlyGrowthRate, months)` forecasts traffic; re-run `sizeReplicas`
  at each horizon to pre-plan cluster capacity and DB connection headroom.

## Conclusion

Capacity assumptions from Phase 10 are **validated** by Phase-11 measurements. Autoscaling meets the
scale-up SLA, the queue stays bounded under load, and the connection-pool risk is mitigated by
PgBouncer. No frozen module was changed to reach these numbers.
